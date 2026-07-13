// S-Corp generated documents: Accountable Plan and Board of Directors Resolution.
// Builds the branded HTML (matching the Real Estate report style via
// pdfDocuments), captures the finger signature into the scorp-signatures bucket,
// records it in scorp_signatures, saves the document into the documents table,
// and opens the share sheet.

import { decode as decodeBase64 } from 'base64-arraybuffer';
import { supabase, requireUserId } from './supabase';
import {
  buildBrandedDocHtml,
  sectionHeader,
  clause,
  signatureBlock,
  escapeHtml,
  saveGeneratedDocument,
  shareHtmlAsPdf,
  renderHtmlToPdfUri,
} from './pdfDocuments';
import { uploadStrategyDocument } from './strategyDocuments';

const SIGNATURE_BUCKET = 'scorp-signatures';

// Renders the generated document to a PDF file and files it into the S-Corp
// compliance slot (strategy_documents) so the corresponding upload slot on the
// S-Corp Compliance screen shows as completed automatically — the client does
// not need to re-upload the document they just generated.
//
// documentKey MUST match a slot key from strategyComplianceSlots.STRATEGY_
// COMPLIANCE_SLOTS.s_corp — 'accountable_plan' for the Accountable Plan and
// 'annual_board_minutes' for the Annual Board Meeting Minutes slot.
async function fileToSCorpSlot(opts: {
  businessId: string | null;
  documentKey: string;
  documentName: string;
  html: string;
}): Promise<void> {
  const pdfUri = await renderHtmlToPdfUri(opts.html);
  await uploadStrategyDocument({
    strategyKey: 's_corp',
    documentKey: opts.documentKey,
    businessId: opts.businessId,
    localUri: pdfUri,
    fileName: `${opts.documentName}.pdf`,
    mimeType: 'application/pdf',
  });
}

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// "June 14, 2026" from a Date.
export function formatLongDate(d: Date): string {
  return `${MONTHS_LONG[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// "2026-06-14" for filenames (local date, no TZ shift).
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

// Uploads the captured signature PNG to the private 'scorp-signatures' bucket
// and returns the storage path. The stored object lives at
// scorp-signatures/<user_id>/<filename>, matching the bucket + RLS policy.
async function uploadSignature(
  userId: string,
  documentType: string,
  signatureDataUrl: string,
): Promise<string> {
  const base64 = signatureDataUrl.replace(/^data:image\/\w+;base64,/, '');
  const bytes = decodeBase64(base64);
  const path = `${userId}/${documentType}_${toIsoDate(new Date())}_${Date.now()}.png`;
  const { error } = await supabase.storage
    .from(SIGNATURE_BUCKET)
    .upload(path, bytes, { contentType: 'image/png', upsert: false });
  // Surface a clear, user-facing message for any storage failure (bucket
  // missing, RLS denial, network) instead of the raw "bucket not found" error.
  if (error) {
    console.warn('[scorp] signature upload failed', error);
    throw new Error('Could not save signature. Please try again or contact support.');
  }
  return path;
}

// ── Accountable Plan ────────────────────────────────────────────────────────

const ELIGIBLE_EXPENSES: Array<[string, string]> = [
  ['Business travel and transportation', 'Airfare, lodging, rideshare, and related travel costs incurred for business'],
  ['Business meals', 'Meals with a business purpose, subject to applicable deduction limits'],
  ['Home office expenses', 'The allocable portion of home expenses used regularly and exclusively for business'],
  ['Business equipment and supplies', 'Computers, software, office supplies, and similar items used for business'],
  ['Professional development and education', 'Courses, certifications, conferences, and publications that maintain or improve business skills'],
  ['Client entertainment', 'Ordinary and necessary client-related costs, where applicable'],
  ['Vehicle mileage', 'Business miles reimbursed at the IRS standard mileage rate'],
];

export interface AccountablePlanInput {
  businessId: string | null;
  businessName: string;
  signatureDataUrl: string;
  signerName: string;
  signerTitle: string;
  signedDate: Date;
}

function buildAccountablePlanHtml(input: AccountablePlanInput): string {
  const co = escapeHtml(input.businessName);
  const adopted = formatLongDate(input.signedDate);

  const expenseRows = ELIGIBLE_EXPENSES.map(
    ([type, desc]) =>
      `<tr><td><strong>${escapeHtml(type)}</strong></td><td>${escapeHtml(desc)}</td></tr>`,
  ).join('');

  const body = `
${sectionHeader('Section 1 — Purpose')}
<p class="clause">This Accountable Plan is adopted by <strong>${co}</strong> (the "Company") pursuant to Treasury Regulation Section 1.62-2 to allow for the reimbursement of ordinary and necessary business expenses incurred by employees and shareholders.</p>

${sectionHeader('Section 2 — Eligible Expenses')}
<table>
  <thead><tr><th>Expense Type</th><th>Description</th></tr></thead>
  <tbody>${expenseRows}</tbody>
</table>

${sectionHeader('Section 3 — Requirements for Reimbursement')}
<p class="clause">To receive reimbursement under this plan employees must:</p>
<ol class="reqs">
  <li>Submit an expense report within 60 days of incurring the expense.</li>
  <li>Provide receipts for all expenses over $75.</li>
  <li>Document the business purpose of each expense.</li>
  <li>Return any excess reimbursement within 120 days.</li>
</ol>

${sectionHeader('Section 4 — Administration')}
<p class="clause">This plan is administered by the officers of <strong>${co}</strong>. All reimbursements under this plan are excluded from the employee's gross income provided the above requirements are satisfied.</p>

${sectionHeader('Section 5 — Adoption')}
<p class="clause">This Accountable Plan is hereby adopted by <strong>${co}</strong> effective ${escapeHtml(adopted)}.</p>

${signatureBlock({
    label: 'Authorized Signature',
    signatureDataUrl: input.signatureDataUrl,
    name: input.signerName,
    title: input.signerTitle,
    date: adopted,
  })}
`;

  return buildBrandedDocHtml({
    title: 'ACCOUNTABLE PLAN',
    headerLines: [
      `${input.businessName} — S-Corporation`,
      `Adopted: ${adopted}`,
      'Generated by Compliance Co-Pilot',
    ],
    bodyHtml: body,
  });
}

// Full Accountable Plan flow: upload signature → record → build → save → share.
export async function generateAccountablePlan(
  input: AccountablePlanInput,
): Promise<void> {
  const userId = await requireUserId();
  const sigPath = await uploadSignature(userId, 'accountable_plan', input.signatureDataUrl);

  const { error: sigErr } = await supabase.from('scorp_signatures').insert({
    user_id: userId,
    business_id: input.businessId,
    document_type: 'accountable_plan',
    signature_url: sigPath,
    signer_name: input.signerName,
    signed_at: new Date().toISOString(),
  });
  if (sigErr) throw new Error(sigErr.message);

  const html = buildAccountablePlanHtml(input);
  const name = `Accountable Plan — ${formatLongDate(input.signedDate)}`;
  await saveGeneratedDocument({
    businessId: input.businessId,
    name,
    strategyCategory: 's_corp',
    fileType: 'signed_document',
    html,
  });
  // Auto-fill the "Accountable Plan Adoption Document" compliance slot.
  await fileToSCorpSlot({
    businessId: input.businessId,
    documentKey: 'accountable_plan',
    documentName: name,
    html,
  });
  await shareHtmlAsPdf(html, name);
}

// ── Board of Directors Resolution ───────────────────────────────────────────

export const RESOLUTION_SUBJECTS = [
  'Officer Compensation',
  'Accountable Plan Adoption',
  'Major Business Decision',
  'Annual Meeting Resolution',
  'Other',
] as const;

export type ResolutionSubject = (typeof RESOLUTION_SUBJECTS)[number];

// Default resolution body language seeded into the editable field per subject.
export function defaultResolutionText(
  subject: string,
  businessName: string,
): string {
  switch (subject) {
    case 'Officer Compensation':
      return `the reasonable compensation payable to the officer(s) of ${businessName} for services rendered is hereby approved and ratified at the amount(s) determined by the Board, consistent with comparable compensation for similar services in the industry.`;
    case 'Accountable Plan Adoption':
      return `${businessName} hereby adopts an Accountable Plan under Treasury Regulation Section 1.62-2 for the reimbursement of ordinary and necessary business expenses incurred by employees and shareholders, effective as of the date of this resolution.`;
    case 'Major Business Decision':
      return `the Board of Directors hereby authorizes and approves the business decision described herein, and directs the officers of ${businessName} to take all actions reasonably necessary to carry it out.`;
    case 'Annual Meeting Resolution':
      return `the Board of Directors of ${businessName} hereby ratifies and approves the acts of the officers and directors taken on behalf of the Company since the last annual meeting, and confirms the continuation of the Company's business for the ensuing year.`;
    default:
      return `the Board of Directors of ${businessName} hereby approves the matter set forth above and authorizes the officers to take all actions reasonably necessary to give it effect.`;
  }
}

export interface BoardResolutionInput {
  businessId: string | null;
  businessName: string;
  meetingDate: Date;
  meetingTime: string; // free text, e.g. "10:00 AM"
  location: string;
  directorsPresent: string; // comma-separated
  subject: string;
  resolutionText: string;
  unanimous: boolean;
  signatureDataUrl: string;
  signerName: string;
}

function buildBoardResolutionHtml(input: BoardResolutionInput): string {
  const co = escapeHtml(input.businessName);
  const meetingDate = formatLongDate(input.meetingDate);
  const directors = input.directorsPresent.trim() || '—';
  const firstDirector =
    directors
      .split(/,|;|&|\band\b/i)
      .map((s) => s.trim())
      .filter(Boolean)[0] ?? 'the Chair';

  const unanimousClause = input.unanimous
    ? `<p class="clause">This resolution reflects the unanimous written consent of all directors of <strong>${co}</strong> and shall have the same effect as if adopted at a duly noticed meeting of the Board of Directors.</p>`
    : '';

  const body = `
<div class="meta-card">
  <div class="meta-row"><span class="meta-label">Date</span><span class="meta-value">${escapeHtml(meetingDate)}</span></div>
  <div class="meta-row"><span class="meta-label">Location</span><span class="meta-value">${escapeHtml(input.location || '—')}</span></div>
  <div class="meta-row"><span class="meta-label">Directors Present</span><span class="meta-value">${escapeHtml(directors)}</span></div>
</div>

${sectionHeader('Minutes of a Meeting of the Board of Directors')}
<p class="clause">The meeting was called to order by ${escapeHtml(firstDirector)} at ${escapeHtml(input.meetingTime || '—')}. A quorum of directors was present.</p>

${sectionHeader('Resolution')}
<p class="clause"><strong>WHEREAS,</strong> the Board of Directors of <strong>${co}</strong> has considered the matter of ${escapeHtml(input.subject)}; and</p>
<p class="clause"><strong>WHEREAS,</strong> it is in the best interests of the Company to take the following action;</p>
<p class="clause"><strong>NOW THEREFORE BE IT RESOLVED,</strong> that: ${escapeHtml(input.resolutionText)}</p>
<p class="clause">The foregoing resolution was duly adopted by the Board of Directors of <strong>${co}</strong> effective ${escapeHtml(meetingDate)}.</p>
${unanimousClause}

${signatureBlock({
    label: 'Director Signature',
    signatureDataUrl: input.signatureDataUrl,
    name: input.signerName,
    title: 'Director',
    date: meetingDate,
  })}
`;

  return buildBrandedDocHtml({
    title: 'BOARD OF DIRECTORS RESOLUTION',
    headerLines: [
      `${input.businessName} — S-Corporation`,
      meetingDate,
      'Generated by Compliance Co-Pilot',
    ],
    bodyHtml: body,
  });
}

export async function generateBoardResolution(
  input: BoardResolutionInput,
): Promise<void> {
  const userId = await requireUserId();
  const sigPath = await uploadSignature(userId, 'board_resolution', input.signatureDataUrl);

  const { error: sigErr } = await supabase.from('scorp_signatures').insert({
    user_id: userId,
    business_id: input.businessId,
    document_type: 'board_resolution',
    signature_url: sigPath,
    signer_name: input.signerName,
    signed_at: new Date().toISOString(),
  });
  if (sigErr) throw new Error(sigErr.message);

  const html = buildBoardResolutionHtml(input);
  const name = `Board Resolution — ${input.subject} — ${formatLongDate(input.meetingDate)}`;
  await saveGeneratedDocument({
    businessId: input.businessId,
    name,
    strategyCategory: 's_corp',
    fileType: 'signed_document',
    html,
  });
  // Auto-fill the "Annual Board Meeting Minutes" compliance slot. The slot key
  // registered for that slot is 'annual_board_minutes' (see
  // strategyComplianceSlots), so we file under that key for the checkmark to
  // appear on the S-Corp Compliance screen.
  await fileToSCorpSlot({
    businessId: input.businessId,
    documentKey: 'annual_board_minutes',
    documentName: name,
    html,
  });
  await shareHtmlAsPdf(html, name);
}
