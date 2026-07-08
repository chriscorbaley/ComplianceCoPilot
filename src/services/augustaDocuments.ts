// Augusta Rule (IRC §280A(g)) generated documents: the short-term rental lease
// agreement and the rental invoice, plus the per-property "rate comparables"
// uploads. Builds branded HTML matching the Real Estate report style, persists
// the rental in augusta_rentals, and mirrors the lease + invoice into the
// documents table so they appear in the Documents vault.

import { File } from 'expo-file-system';
import { decode as decodeBase64 } from 'base64-arraybuffer';
import { supabase, requireUserId } from './supabase';
import {
  buildBrandedDocHtml,
  sectionHeader,
  signatureBlock,
  escapeHtml,
  saveGeneratedDocument,
  LOGO_PLACEHOLDER,
} from './pdfDocuments';
import { formatLongDate } from './scorpDocuments';

export const COMPARABLES_BUCKET = 'augusta-comparables';

// ── Date / money helpers ────────────────────────────────────────────────────

// 'YYYY-MM-DD' -> Date at local noon (avoids TZ day-shift).
function isoToDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return new Date(iso);
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

const money = (n: number | null): string =>
  n != null && Number.isFinite(n)
    ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '$—';

// Days the property was rented, derived from the logged duration (hours). A
// single business meeting is one rental day; longer events round up.
function rentalDays(durationHours: number | null): number {
  if (durationHours == null || !Number.isFinite(durationHours) || durationHours <= 0) return 1;
  return Math.max(1, Math.ceil(durationHours / 24));
}

// ── Rental context ──────────────────────────────────────────────────────────

export interface AugustaRentalContext {
  businessId: string | null;
  ownerName: string; // client full name (property owner)
  businessEntityName: string; // tenant
  location: string; // property address
  rentalDate: string; // 'YYYY-MM-DD'
  durationHours: number | null;
  rentalRate: number | null; // per day
  meetingPurpose: string;
}

export interface AugustaSignatures {
  ownerSignature: string | null; // data URL
  tenantSignature: string | null; // data URL
  tenantRepName: string;
  tenantRepTitle: string;
}

// Next sequential invoice number for the year: AR-YYYY-NNNN.
async function nextInvoiceNumber(userId: string, year: number): Promise<string> {
  const start = `${year}-01-01`;
  const end = `${year + 1}-01-01`;
  const { count } = await supabase
    .from('augusta_rentals')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('rental_date', start)
    .lt('rental_date', end);
  const seq = (count ?? 0) + 1;
  return `AR-${year}-${String(seq).padStart(4, '0')}`;
}

// ── Lease agreement HTML ────────────────────────────────────────────────────

function buildLeaseHtml(
  ctx: AugustaRentalContext,
  sigs: AugustaSignatures,
  total: number | null,
): string {
  const date = formatLongDate(isoToDate(ctx.rentalDate));
  const days = rentalDays(ctx.durationHours);
  const durationLabel =
    ctx.durationHours != null && Number.isFinite(ctx.durationHours)
      ? `${ctx.durationHours} hours / ${days} day(s)`
      : `${days} day(s)`;

  const body = `
<p class="clause">This Short-Term Rental Agreement ("Agreement") is entered into as of ${escapeHtml(date)} between:</p>

<div class="meta-card">
  <div class="meta-row"><span class="meta-label">Property Owner</span><span class="meta-value">${escapeHtml(ctx.ownerName || '—')} ("Owner")</span></div>
  <div class="meta-row"><span class="meta-label">Business Entity</span><span class="meta-value">${escapeHtml(ctx.businessEntityName || '—')} ("Tenant")</span></div>
  <div class="meta-row"><span class="meta-label">Property Address</span><span class="meta-value">${escapeHtml(ctx.location || '—')}</span></div>
  <div class="meta-row"><span class="meta-label">Rental Period</span><span class="meta-value">${escapeHtml(date)} · ${escapeHtml(durationLabel)}</span></div>
  <div class="meta-row"><span class="meta-label">Rental Rate</span><span class="meta-value">${money(ctx.rentalRate)} per day</span></div>
  <div class="meta-row"><span class="meta-label">Total Amount Due</span><span class="meta-value">${money(total)}</span></div>
</div>

${sectionHeader('Purpose of Rental')}
<p class="clause">The Property is rented exclusively for the following business purpose: ${escapeHtml(ctx.meetingPurpose || '—')}</p>

${sectionHeader('Terms and Conditions')}
<ol class="reqs">
  <li>The Property shall be used solely for legitimate business purposes as described above.</li>
  <li>This rental rate has been established based on comparable rental rates for similar properties and venues in the area.</li>
  <li>This Agreement is entered into at arm's length and reflects fair market value.</li>
  <li>Payment shall be made by the Tenant to the Owner within 30 days of the rental date.</li>
</ol>
<p class="clause">This Agreement is made pursuant to IRC Section 280A(g), which allows homeowners to exclude rental income from up to 14 days of home rental per year from gross income when the home is rented for legitimate business purposes.</p>

${signatureBlock({
    label: 'Property Owner Signature',
    signatureDataUrl: sigs.ownerSignature,
    name: ctx.ownerName || '—',
    date,
  })}
${signatureBlock({
    label: 'Tenant Representative Signature',
    signatureDataUrl: sigs.tenantSignature,
    name: sigs.tenantRepName || '—',
    title: sigs.tenantRepTitle || 'Authorized Representative',
    date,
  })}
`;

  return buildBrandedDocHtml({
    title: 'SHORT-TERM RENTAL AGREEMENT',
    headerLines: [
      'Augusta Rule — IRC Section 280A(g)',
      date,
      'Generated by Compliance Co-Pilot',
    ],
    bodyHtml: body,
  });
}

// ── Invoice HTML ────────────────────────────────────────────────────────────

export interface InvoicePaidInfo {
  paid: boolean;
  paidDate: string | null; // 'YYYY-MM-DD'
}

// Standalone invoice stylesheet — mirrors the lease's brand palette (navy
// #042C53 header, #185FA5 accents, Arial) but lays the invoice out as a proper
// invoice: From/To party boxes, a big invoice number, an itemized line-item
// table, a totals block, the diagonal PAID stamp, and a payment-info panel.
const INVOICE_CSS = `
  body { font-family: Arial, sans-serif; padding: 40px; color: #1A1A2E; position: relative; }
  .header { background: #042C53; color: white; padding: 20px 24px; border-radius: 8px; margin-bottom: 24px; display: flex; align-items: center; gap: 16px; }
  .brandLogo { width: 54px; height: 54px; object-fit: contain; background: #FFFFFF; border-radius: 8px; padding: 5px; box-sizing: border-box; flex-shrink: 0; }
  .header h1 { font-size: 20px; margin: 0 0 4px 0; }
  .header p { font-size: 12px; margin: 2px 0; opacity: 0.85; }
  .invoice-meta { display: flex; justify-content: space-between; margin-bottom: 24px; }
  .invoice-meta .label { font-size: 13px; color: #888; margin: 0 0 2px 0; }
  .invoice-number { font-size: 22px; font-weight: bold; color: #042C53; margin: 0; }
  .meta-box { text-align: right; }
  .meta-box p { font-size: 12px; color: #555555; margin: 2px 0; }
  .from-to { display: flex; justify-content: space-between; margin-bottom: 24px; gap: 20px; }
  .party-box { flex: 1; background: #F2F4F6; border-radius: 6px; padding: 14px; }
  .party-box h3 { color: #185FA5; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 8px 0; }
  .party-box p { font-size: 12px; margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th { background: #185FA5; color: white; padding: 10px 12px; text-align: left; font-size: 12px; }
  td { padding: 12px; font-size: 12px; border-bottom: 0.5px solid #CCCCCC; vertical-align: top; }
  tr:nth-child(even) td { background: #F2F4F6; }
  td.amount, th.amount { text-align: right; white-space: nowrap; }
  .total-section { margin-top: 8px; }
  .total-row { display: flex; justify-content: flex-end; gap: 40px; padding: 6px 0; font-size: 13px; border-top: 0.5px solid #CCCCCC; }
  .total-row.grand { font-weight: bold; font-size: 16px; color: #042C53; border-top: 2px solid #042C53; padding-top: 10px; margin-top: 4px; }
  .paid-stamp { position: fixed; top: 45%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 72px; font-weight: bold; color: rgba(15, 110, 86, 0.15); border: 8px solid rgba(15, 110, 86, 0.15); border-radius: 8px; padding: 10px 20px; pointer-events: none; }
  .payment-info { background: #E6F1FB; border-radius: 6px; padding: 14px; margin-top: 20px; font-size: 12px; line-height: 1.5; }
  .footer { margin-top: 32px; font-size: 10px; color: #888888; border-top: 0.5px solid #CCCCCC; padding-top: 10px; line-height: 1.5; }
`;

function buildInvoiceHtml(
  ctx: AugustaRentalContext,
  invoiceNumber: string,
  total: number | null,
  paid: InvoicePaidInfo,
): string {
  const date = formatLongDate(isoToDate(ctx.rentalDate));
  const dueDate = formatLongDate(addDays(isoToDate(ctx.rentalDate), 30));
  const purposeBrief = (ctx.meetingPurpose || 'business meeting').slice(0, 100);
  const today = formatLongDate(new Date());

  const paidStampMark = paid.paid ? '<div class="paid-stamp">PAID</div>' : '';
  const paidMetaLine =
    paid.paid && paid.paidDate
      ? `<p style="color:#0F6E56; font-weight:bold;">PAID — ${escapeHtml(
          formatLongDate(isoToDate(paid.paidDate)),
        )}</p>`
      : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>${INVOICE_CSS}</style>
</head>
<body>
${paidStampMark}
<div class="header">
  <img class="brandLogo" src="${LOGO_PLACEHOLDER}" />
  <div>
    <h1>INVOICE</h1>
    <p>Augusta Rule Rental — IRC §280A(g)</p>
    <p>Generated by Compliance Co-Pilot</p>
  </div>
</div>

<div class="invoice-meta">
  <div>
    <p class="label">Invoice Number</p>
    <p class="invoice-number">${escapeHtml(invoiceNumber)}</p>
  </div>
  <div class="meta-box">
    <p>Invoice Date: ${escapeHtml(date)}</p>
    <p>Due Date: ${escapeHtml(dueDate)}</p>
    ${paidMetaLine}
  </div>
</div>

<div class="from-to">
  <div class="party-box">
    <h3>From (Property Owner)</h3>
    <p><strong>${escapeHtml(ctx.ownerName || '—')}</strong></p>
  </div>
  <div class="party-box">
    <h3>To (Business Entity)</h3>
    <p><strong>${escapeHtml(ctx.businessEntityName || '—')}</strong></p>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th style="width:50%">Description</th>
      <th style="width:20%">Date</th>
      <th class="amount" style="width:15%">Rate</th>
      <th class="amount" style="width:15%">Amount</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Short-term rental of property located at ${escapeHtml(
        ctx.location || '—',
      )} for business meeting: ${escapeHtml(purposeBrief)}</td>
      <td>${escapeHtml(date)}</td>
      <td class="amount">${money(ctx.rentalRate)}/day</td>
      <td class="amount">${money(total)}</td>
    </tr>
  </tbody>
</table>

<div class="total-section">
  <div class="total-row"><span>Subtotal</span><span>${money(total)}</span></div>
  <div class="total-row grand"><span>TOTAL DUE</span><span>${money(total)}</span></div>
</div>

<div class="payment-info">
  <strong>Payment Instructions</strong><br>
  Please remit payment to ${escapeHtml(
    ctx.ownerName || 'the Property Owner',
  )} within 30 days of the invoice date. This invoice is issued pursuant to the
  Rental Agreement dated ${escapeHtml(date)} between ${escapeHtml(
    ctx.ownerName || 'the Property Owner',
  )} (Owner) and ${escapeHtml(ctx.businessEntityName || 'the Business Entity')} (Tenant).
</div>

<div class="footer">
  This invoice is maintained as part of Augusta Rule (IRC §280A(g)) compliance
  records. Invoice ${escapeHtml(invoiceNumber)} | Generated by Compliance Co-Pilot | ${escapeHtml(today)}
</div>

</body>
</html>`;
}

// ── Generate lease + invoice ────────────────────────────────────────────────

export interface GeneratedAugustaDocs {
  rentalId: string;
  invoiceNumber: string;
  total: number | null;
  leaseDocId: string;
  invoiceDocId: string;
  // Un-hydrated HTML so the caller can open the share sheet for each PDF.
  leaseHtml: string;
  invoiceHtml: string;
}

// Creates the augusta_rentals record, generates + saves the lease and the
// invoice, and links both document ids back onto the rental row. Each step is
// wrapped so a failure reports exactly which step failed rather than a generic
// error.
export async function generateAugustaDocuments(
  ctx: AugustaRentalContext,
  sigs: AugustaSignatures,
  onProgress?: (message: string) => void,
): Promise<GeneratedAugustaDocs> {
  const userId = await requireUserId();
  const year = isoToDate(ctx.rentalDate).getFullYear();
  const days = rentalDays(ctx.durationHours);
  const total =
    ctx.rentalRate != null && Number.isFinite(ctx.rentalRate)
      ? ctx.rentalRate * days
      : null;

  let invoiceNumber: string;
  try {
    invoiceNumber = await nextInvoiceNumber(userId, year);
  } catch (e) {
    throw new Error(`Could not assign an invoice number: ${e instanceof Error ? e.message : String(e)}`);
  }

  const { data: rental, error: rentalErr } = await supabase
    .from('augusta_rentals')
    .insert({
      user_id: userId,
      business_id: ctx.businessId,
      property_name: ctx.location || null,
      business_entity_name: ctx.businessEntityName || null,
      rental_date: ctx.rentalDate,
      duration_hours: ctx.durationHours,
      rental_rate: ctx.rentalRate,
      invoice_number: invoiceNumber,
      invoice_paid: false,
    })
    .select('id')
    .single();
  if (rentalErr || !rental) {
    throw new Error(
      `Could not save the rental record: ${rentalErr?.message ?? 'unknown error'}`,
    );
  }
  const rentalId = rental.id as string;

  const dateLabel = formatLongDate(isoToDate(ctx.rentalDate));

  onProgress?.('Generating lease agreement…');
  let leaseDocId: string;
  const leaseHtml = buildLeaseHtml(ctx, sigs, total);
  try {
    leaseDocId = await saveGeneratedDocument({
      businessId: ctx.businessId,
      name: `Augusta Lease — ${dateLabel}`,
      strategyCategory: 'augusta_rule',
      fileType: 'signed_document',
      html: leaseHtml,
    });
  } catch (e) {
    throw new Error(`Could not generate the lease agreement: ${e instanceof Error ? e.message : String(e)}`);
  }

  onProgress?.('Generating invoice…');
  let invoiceDocId: string;
  const invoiceHtml = buildInvoiceHtml(ctx, invoiceNumber, total, {
    paid: false,
    paidDate: null,
  });
  try {
    invoiceDocId = await saveGeneratedDocument({
      businessId: ctx.businessId,
      name: `Augusta Invoice — ${dateLabel}`,
      strategyCategory: 'augusta_rule',
      fileType: 'invoice',
      html: invoiceHtml,
    });
  } catch (e) {
    throw new Error(`Could not generate the invoice: ${e instanceof Error ? e.message : String(e)}`);
  }

  const { error: linkErr } = await supabase
    .from('augusta_rentals')
    .update({ lease_url: leaseDocId, invoice_url: invoiceDocId })
    .eq('id', rentalId);
  if (linkErr) {
    throw new Error(`Could not link the documents to the rental: ${linkErr.message}`);
  }

  return { rentalId, invoiceNumber, total, leaseDocId, invoiceDocId, leaseHtml, invoiceHtml };
}

// ── Mark invoice paid / unpaid ──────────────────────────────────────────────

// Regenerates the invoice document with (or without) the PAID watermark and
// updates the augusta_rentals paid status. Returns the regenerated HTML so the
// caller can refresh an open viewer.
export async function setInvoicePaid(
  invoiceDocId: string,
  paid: boolean,
  paidDate: string | null,
): Promise<string> {
  const userId = await requireUserId();

  // Find the rental that owns this invoice so we can rebuild the document.
  const { data: rental, error } = await supabase
    .from('augusta_rentals')
    .select('*')
    .eq('invoice_url', invoiceDocId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!rental) throw new Error('Rental record not found for this invoice.');

  const ctx: AugustaRentalContext = {
    businessId: rental.business_id ?? null,
    ownerName: '', // owner name isn't stored separately; the stored HTML keeps it
    businessEntityName: rental.business_entity_name ?? '',
    location: rental.property_name ?? '',
    rentalDate: rental.rental_date ?? '',
    durationHours: rental.duration_hours ?? null,
    rentalRate: rental.rental_rate ?? null,
    meetingPurpose: rental.meeting_purpose ?? '',
  };

  // Preserve the owner name from the previously stored invoice HTML if present.
  const { data: docRow } = await supabase
    .from('documents')
    .select('file_url')
    .eq('id', invoiceDocId)
    .maybeSingle();
  if (docRow?.file_url) {
    const m = /From \(Property Owner\)<\/h3>\s*<p><strong>([^<]*)<\/strong>/.exec(
      docRow.file_url as string,
    );
    if (m) ctx.ownerName = m[1].trim();
  }

  // total_amount is not a stored column — recompute it from rate × rental days
  // exactly the way generateAugustaDocuments derived it at creation time.
  const paidDays = rentalDays(rental.duration_hours ?? null);
  const paidTotal =
    rental.rental_rate != null && Number.isFinite(rental.rental_rate)
      ? rental.rental_rate * paidDays
      : null;

  const html = buildInvoiceHtml(ctx, rental.invoice_number ?? '', paidTotal, {
    paid,
    paidDate,
  });

  const { error: upDocErr } = await supabase
    .from('documents')
    .update({ file_url: html })
    .eq('id', invoiceDocId)
    .eq('user_id', userId);
  if (upDocErr) throw new Error(upDocErr.message);

  const { error: upRentalErr } = await supabase
    .from('augusta_rentals')
    .update({
      invoice_paid: paid,
      invoice_paid_at: paid ? paidDate : null,
    })
    .eq('id', rental.id)
    .eq('user_id', userId);
  if (upRentalErr) throw new Error(upRentalErr.message);

  return html;
}

// ── Comparable rate uploads ─────────────────────────────────────────────────

export interface AugustaComparableRow {
  id: string;
  user_id: string;
  business_id: string | null;
  property_name: string | null;
  tax_year: number | null;
  comparable_1_url: string | null;
  comparable_2_url: string | null;
  comparable_3_url: string | null;
  rental_rate_justified: number | null;
  created_at: string;
  updated_at: string;
}

export interface AugustaPropertyForYear {
  propertyName: string;
  rate: number | null;
  taxYear: number;
}

// Distinct properties that have had an Augusta rental in the given tax year,
// with the most recent rate used — the basis for the comparables cards.
export async function listAugustaProperties(
  businessId: string | null,
  taxYear: number,
): Promise<AugustaPropertyForYear[]> {
  const userId = await requireUserId();
  let q = supabase
    .from('augusta_rentals')
    .select('property_name, rental_rate, rental_date')
    .eq('user_id', userId)
    .gte('rental_date', `${taxYear}-01-01`)
    .lt('rental_date', `${taxYear + 1}-01-01`)
    .order('rental_date', { ascending: false });
  if (businessId) q = q.eq('business_id', businessId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const byProp = new Map<string, AugustaPropertyForYear>();
  for (const r of (data ?? []) as Array<{ property_name: string | null; rental_rate: number | null }>) {
    const name = (r.property_name ?? '').trim();
    if (!name) continue;
    if (!byProp.has(name)) {
      byProp.set(name, { propertyName: name, rate: r.rental_rate ?? null, taxYear });
    }
  }
  return Array.from(byProp.values());
}

export async function listComparables(
  businessId: string | null,
  taxYear: number,
): Promise<AugustaComparableRow[]> {
  const userId = await requireUserId();
  let q = supabase
    .from('augusta_comparables')
    .select('*')
    .eq('user_id', userId)
    .eq('tax_year', taxYear);
  if (businessId) q = q.eq('business_id', businessId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as AugustaComparableRow[];
}

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'property';

// Uploads one comparable screenshot/PDF and upserts the augusta_comparables row,
// setting the comparable_<slot>_url column (slot is 1-3).
export async function uploadComparable(input: {
  businessId: string | null;
  propertyName: string;
  taxYear: number;
  slot: 1 | 2 | 3;
  localUri: string;
  fileName: string;
  mimeType: string | null;
  rate: number | null;
}): Promise<AugustaComparableRow> {
  const userId = await requireUserId();
  const base64 = await new File(input.localUri).base64();
  const bytes = decodeBase64(base64);
  const ext = (input.fileName.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `${userId}/${slug(input.propertyName)}/${input.taxYear}/comp${input.slot}_${Date.now()}.${ext}`;
  const contentType = input.mimeType ?? 'application/octet-stream';

  const { error: upErr } = await supabase.storage
    .from(COMPARABLES_BUCKET)
    .upload(path, bytes, { contentType, upsert: false });
  if (upErr) throw upErr;

  const column = `comparable_${input.slot}_url` as const;
  const { data, error } = await supabase
    .from('augusta_comparables')
    .upsert(
      {
        user_id: userId,
        business_id: input.businessId,
        property_name: input.propertyName,
        tax_year: input.taxYear,
        [column]: path,
        rental_rate_justified: input.rate,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,business_id,property_name,tax_year' },
    )
    .select('*')
    .single();
  if (error || !data) throw error ?? new Error('Could not save comparable');
  return data as AugustaComparableRow;
}

export async function getComparableSignedUrl(
  storagePath: string,
  expiresInSeconds = 60 * 10,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(COMPARABLES_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data?.signedUrl) throw error ?? new Error('Could not sign comparable URL');
  return data.signedUrl;
}
