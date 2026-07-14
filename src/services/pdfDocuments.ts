// Shared PDF/document infrastructure for the generated S-Corp and Augusta Rule
// templates. Everything here matches the Real Estate compliance report style
// (services/realEstateReport.ts): navy #042C53 header, Arial body, #185FA5
// section/table headers, the same status/teal accents — so every generated
// document reads as part of the same family.
//
// Logo handling: generated HTML is stored in documents.file_url with the literal
// placeholder __LOGO_SRC__ in the <img> tag so the stored row stays small. The
// 1MB brand logo is only inlined (as a base64 data URI) at print/preview time
// via hydrateLogo(). Re-exporting a saved document re-hydrates the same way.

import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { supabase, requireUserId } from './supabase';
import { getCurrentUserLogoBase64 } from '../utils/logoUtils';

// ── Shared escaping ─────────────────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Logo ────────────────────────────────────────────────────────────────────

export const LOGO_PLACEHOLDER = '__LOGO_SRC__';

let cachedLogoDataUri: string | null = null;

// Loads assets/logo.png once and caches it as a base64 data URI. Returns null if
// the asset can't be read (the document still renders, just without the mark).
async function getLogoDataUri(): Promise<string | null> {
  if (cachedLogoDataUri) return cachedLogoDataUri;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const asset = Asset.fromModule(require('../../assets/logo.png'));
    await asset.downloadAsync();
    const uri = asset.localUri ?? asset.uri;
    const base64 = await new File(uri).base64();
    cachedLogoDataUri = `data:image/png;base64,${base64}`;
    return cachedLogoDataUri;
  } catch (e) {
    console.warn('[pdf] could not load brand logo', e);
    return null;
  }
}

// Replaces the __LOGO_SRC__ placeholder with a real base64 data URI just before
// the HTML is rendered. Prefers the user's OWN business logo (so exported PDFs
// carry their branding), falling back to the bundled Compliance Co-Pilot brand
// mark, then stripping the <img> entirely if neither can load — so a PDF never
// shows a broken-image icon. Both logos are inlined as base64 because expo-print
// has no network stack at render time and cannot fetch a remote/signed URL.
export async function hydrateLogo(html: string): Promise<string> {
  // Fast path: nothing to hydrate.
  if (!html.includes(LOGO_PLACEHOLDER)) return html;
  const businessLogo = await getCurrentUserLogoBase64();
  const logo = businessLogo ?? (await getLogoDataUri());
  if (logo) return html.split(LOGO_PLACEHOLDER).join(logo);
  return html.replace(/<img class="brandLogo"[^>]*>/g, '');
}

// ── Shared stylesheet ───────────────────────────────────────────────────────

// Mirrors the Real Estate report CSS, with extra classes for clauses, numbered
// requirement lists, signature blocks, invoices and the PAID watermark.
export const DOC_CSS = `
  body {
    font-family: Arial, sans-serif;
    padding: 40px;
    color: #1A1A2E;
    position: relative;
  }
  .header {
    background: #042C53;
    color: white;
    padding: 20px 24px;
    border-radius: 8px;
    margin-bottom: 24px;
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .brandLogo {
    width: 54px;
    height: 54px;
    object-fit: contain;
    background: #FFFFFF;
    border-radius: 8px;
    padding: 5px;
    box-sizing: border-box;
    flex-shrink: 0;
  }
  .headerText h1 { font-size: 22px; margin: 0 0 6px 0; letter-spacing: 0.5px; }
  .headerText p { font-size: 13px; margin: 2px 0; opacity: 0.85; }
  .section-header {
    background: #185FA5;
    color: white;
    padding: 10px 14px;
    border-radius: 4px;
    font-size: 14px;
    font-weight: bold;
    margin-top: 22px;
    margin-bottom: 10px;
  }
  .clause { font-size: 13px; line-height: 1.65; color: #1A1A2E; margin: 8px 0; }
  .clause strong { color: #042C53; }
  ol.reqs, ul.reqs { font-size: 13px; line-height: 1.6; color: #1A1A2E; margin: 8px 0 8px 4px; padding-left: 22px; }
  ol.reqs li, ul.reqs li { margin: 5px 0; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0;
  }
  th {
    background: #185FA5;
    color: white;
    padding: 10px 12px;
    text-align: left;
    font-size: 12px;
  }
  td {
    padding: 9px 12px;
    font-size: 12px;
    border-bottom: 0.5px solid #CCCCCC;
    word-wrap: break-word;
    vertical-align: top;
  }
  tr:nth-child(even) td { background: #F2F4F6; }
  td.amount, th.amount { text-align: right; white-space: nowrap; }
  .total-row td { background: #042C53; color: white; font-weight: bold; }
  .meta-card {
    background: #E6F1FB;
    border: 1px solid #185FA5;
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 16px;
  }
  .meta-row { display: flex; justify-content: space-between; font-size: 13px; padding: 4px 0; border-bottom: 0.5px solid #CCCCCC; }
  .meta-row:last-child { border-bottom: none; }
  .meta-label { color: #555555; }
  .meta-value { color: #1A1A2E; font-weight: 600; }
  .sig-block { margin-top: 26px; page-break-inside: avoid; }
  .sig-block .sig-label { font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; color: #185FA5; margin-bottom: 6px; }
  .sig-img { height: 90px; max-width: 320px; border-bottom: 1.5px solid #042C53; margin-bottom: 6px; object-fit: contain; }
  .sig-line { width: 320px; border-bottom: 1.5px solid #042C53; height: 70px; margin-bottom: 6px; }
  .sig-meta { font-size: 12px; color: #1A1A2E; margin: 2px 0; }
  .sig-meta .k { color: #6B7280; }
  .paid-stamp { color: #0F6E56; font-weight: bold; font-size: 14px; margin-top: 8px; }
  .footer {
    margin-top: 34px;
    font-size: 11px;
    color: #888888;
    border-top: 0.5px solid #CCCCCC;
    padding-top: 12px;
    line-height: 1.5;
  }
  .watermark {
    position: fixed;
    top: 42%;
    left: 0;
    right: 0;
    text-align: center;
    transform: rotate(-32deg);
    font-size: 130px;
    font-weight: 800;
    letter-spacing: 12px;
    color: rgba(15, 110, 86, 0.16);
    z-index: 0;
    pointer-events: none;
  }
`;

// ── Branded HTML wrapper ────────────────────────────────────────────────────

export interface BrandedDocOptions {
  // Big white H1 inside the navy header bar (e.g. "ACCOUNTABLE PLAN").
  title: string;
  // The smaller subtitle <p> lines under the title.
  headerLines: string[];
  // The inner document content (already valid HTML).
  bodyHtml: string;
  // Optional footer line; falls back to the standard Compliance Co-Pilot note.
  footer?: string;
  // Optional diagonal watermark text (e.g. "PAID").
  watermark?: string | null;
}

const DEFAULT_FOOTER =
  'This document was generated from records maintained in Compliance Co-Pilot ' +
  'and is intended as supporting documentation for tax preparation and IRS ' +
  'examination purposes.';

// Builds a complete, standalone HTML document with the __LOGO_SRC__ placeholder
// still in place (call hydrateLogo before printing/previewing).
export function buildBrandedDocHtml(opts: BrandedDocOptions): string {
  const lines = opts.headerLines
    .filter((l) => l != null && l !== '')
    .map((l) => `  <p>${escapeHtml(l)}</p>`)
    .join('\n');
  const watermark = opts.watermark
    ? `<div class="watermark">${escapeHtml(opts.watermark)}</div>`
    : '';
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>${DOC_CSS}</style>
</head>
<body>
${watermark}
<div class="header">
  <img class="brandLogo" src="${LOGO_PLACEHOLDER}" />
  <div class="headerText">
    <h1>${escapeHtml(opts.title)}</h1>
${lines}
  </div>
</div>
${opts.bodyHtml}
<div class="footer">${escapeHtml(opts.footer ?? DEFAULT_FOOTER)}</div>
</body>
</html>`;
}

// ── Small HTML builders shared by the templates ─────────────────────────────

export const sectionHeader = (text: string): string =>
  `<div class="section-header">${escapeHtml(text)}</div>`;

export const clause = (text: string): string =>
  `<p class="clause">${escapeHtml(text)}</p>`;

// A signature block: either the captured PNG (data URL) or a blank line, plus
// name / title / date meta rows.
export function signatureBlock(opts: {
  label: string;
  signatureDataUrl?: string | null;
  name: string;
  title?: string;
  date: string;
}): string {
  const img = opts.signatureDataUrl
    ? `<img class="sig-img" src="${opts.signatureDataUrl}" />`
    : `<div class="sig-line"></div>`;
  const titleRow = opts.title
    ? `<p class="sig-meta"><span class="k">Title:</span> ${escapeHtml(opts.title)}</p>`
    : '';
  return `<div class="sig-block">
  <div class="sig-label">${escapeHtml(opts.label)}</div>
  ${img}
  <p class="sig-meta"><span class="k">Name:</span> ${escapeHtml(opts.name)}</p>
  ${titleRow}
  <p class="sig-meta"><span class="k">Date:</span> ${escapeHtml(opts.date)}</p>
</div>`;
}

// ── Print / share / persist ─────────────────────────────────────────────────

// Renders HTML (which may still contain __LOGO_SRC__) to a PDF and opens the
// system share sheet.
export async function shareHtmlAsPdf(
  html: string,
  dialogTitle: string,
): Promise<void> {
  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error('Sharing is not available on this device.');
  const hydrated = await hydrateLogo(html);
  const { uri } = await Print.printToFileAsync({ html: hydrated, base64: false });
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle,
    UTI: 'com.adobe.pdf',
  });
}

// Renders HTML (which may still contain __LOGO_SRC__) to a local PDF file and
// returns its file:// URI. Used when a generated document also needs to be
// stored as a file (e.g. uploaded to a strategy_documents slot) rather than
// only shared.
export async function renderHtmlToPdfUri(html: string): Promise<string> {
  const hydrated = await hydrateLogo(html);
  const { uri } = await Print.printToFileAsync({ html: hydrated, base64: false });
  return uri;
}

export interface SaveGeneratedDocumentInput {
  businessId: string | null;
  name: string;
  strategyCategory: string; // 's_corp' | 'augusta_rule'
  fileType: string; // 'signed_document' | 'invoice'
  html: string; // un-hydrated HTML (keeps __LOGO_SRC__)
}

// Inserts the generated document into the documents table so it appears in the
// Documents screen. Returns the new row id. file_url stores the HTML itself
// (same inline-text convention minutes use) so it can be re-previewed/exported.
export async function saveGeneratedDocument(
  input: SaveGeneratedDocumentInput,
): Promise<string> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('documents')
    .insert({
      user_id: userId,
      business_id: input.businessId,
      name: input.name,
      strategy_category: input.strategyCategory,
      file_type: input.fileType,
      file_url: input.html,
    })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('Could not save document');
  return data.id as string;
}
