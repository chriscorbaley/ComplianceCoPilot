// Exportable PDF compliance reports for Augusta Rule, S-Corp, Home Office, and
// Family Management. Each mirrors the Real Estate report (services/
// realEstateReport.ts): navy header + brand logo via the shared pdfDocuments
// infrastructure, expo-print to render, expo-sharing to export.
//
// All data comes from existing Supabase tables — no new schema.

import { supabase } from './supabase';
import {
  buildBrandedDocHtml,
  sectionHeader,
  escapeHtml,
  shareHtmlAsPdf,
} from './pdfDocuments';
import {
  listStrategyDocuments,
  type StrategyDocumentRow,
} from './strategyDocuments';
import { listChecklistItems } from './complianceChecklist';
import { STRATEGY_COMPLIANCE_SLOTS } from './strategyComplianceSlots';

export interface ReportParams {
  businessId: string | null;
  clientName: string;
  taxYear?: number;
}

// ── Shared formatting helpers ───────────────────────────────────────────────

const ok = (label = 'Uploaded'): string =>
  `<span style="color:#0F6E56;font-weight:700">${label}</span>`;
const missing = (label = 'Missing'): string =>
  `<span style="color:#A32D2D;font-weight:700">${label}</span>`;

const money = (n: number): string =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};

const headerLinesFor = (clientName: string, year: number): string[] => [
  clientName || 'Client',
  `Tax Year: ${year}`,
  `Generated: ${fmtDate(new Date().toISOString())}`,
];

const scoreBlock = (label: string, pct: number): string =>
  `<p class="clause"><strong>${escapeHtml(label)}:</strong> ${pct}%</p>`;

// ── Augusta Rule ────────────────────────────────────────────────────────────

interface AugustaRentalRow {
  property_name: string | null;
  rental_date: string | null;
  duration_hours: number | null;
  rental_rate: number | null;
  total_amount: number | null;
  lease_url: string | null;
  invoice_url: string | null;
  invoice_paid: boolean | null;
}

export async function generateAugustaReport(params: ReportParams): Promise<void> {
  const year = params.taxYear ?? new Date().getFullYear();
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  let rentalsQ = supabase
    .from('augusta_rentals')
    .select('property_name, rental_date, duration_hours, rental_rate, total_amount, lease_url, invoice_url, invoice_paid')
    .gte('rental_date', start)
    .lte('rental_date', end)
    .order('rental_date', { ascending: true });
  if (params.businessId) rentalsQ = rentalsQ.eq('business_id', params.businessId);

  let minutesQ = supabase
    .from('meeting_minutes')
    .select('id', { count: 'exact', head: true })
    .ilike('meeting_type', 'Augusta%')
    .eq('status', 'complete')
    .gte('meeting_date', start)
    .lte('meeting_date', end);
  if (params.businessId) minutesQ = minutesQ.eq('business_id', params.businessId);

  let comparablesQ = supabase
    .from('augusta_comparables')
    .select('comparable_1_url, comparable_2_url, comparable_3_url');
  if (params.businessId) comparablesQ = comparablesQ.eq('business_id', params.businessId);

  const [rentalsRes, minutesRes, comparablesRes] = await Promise.all([
    rentalsQ,
    minutesQ,
    comparablesQ,
  ]);

  const rentals = (rentalsRes.data ?? []) as AugustaRentalRow[];
  const minutesCount = minutesRes.count ?? 0;
  const comparables = (comparablesRes.data ?? []) as Array<{
    comparable_1_url: string | null;
    comparable_2_url: string | null;
    comparable_3_url: string | null;
  }>;

  const MAX_DAYS = 14;
  const daysUsed = rentals.length;
  const remaining = Math.max(0, MAX_DAYS - daysUsed);
  const leaseCount = rentals.filter((r) => r.lease_url).length;
  const invoiceCount = rentals.filter((r) => r.invoice_url).length;
  const paidCount = rentals.filter((r) => r.invoice_paid).length;
  const comparablesUploaded = comparables.some(
    (c) => c.comparable_1_url || c.comparable_2_url || c.comparable_3_url,
  );
  const totalIncome = rentals.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);

  const eventRows = rentals.length
    ? rentals
        .map(
          (r) => `<tr>
        <td>${fmtDate(r.rental_date)}</td>
        <td>${escapeHtml(r.property_name ?? '—')}</td>
        <td>${r.duration_hours != null ? `${r.duration_hours} hrs` : '—'}</td>
        <td class="amount">${r.rental_rate != null ? money(Number(r.rental_rate)) : '—'}</td>
        <td class="amount">${r.total_amount != null ? money(Number(r.total_amount)) : '—'}</td>
      </tr>`,
        )
        .join('\n')
    : `<tr><td colspan="5">No Augusta Rule events logged this year.</td></tr>`;

  const bodyHtml = [
    sectionHeader('Days Summary'),
    `<p class="clause"><strong>Days used this year:</strong> ${daysUsed} of ${MAX_DAYS}</p>`,
    `<p class="clause"><strong>Remaining days:</strong> ${remaining}</p>`,
    `<p class="clause"><strong>Status:</strong> ${
      daysUsed <= MAX_DAYS ? ok('On Track') : missing('Limit Reached')
    }</p>`,
    sectionHeader('Logged Events'),
    `<table>
      <thead><tr><th>Date</th><th>Location</th><th>Duration</th><th class="amount">Rate</th><th class="amount">Amount</th></tr></thead>
      <tbody>${eventRows}</tbody>
    </table>`,
    sectionHeader('Documents Checklist'),
    `<table>
      <thead><tr><th>Requirement</th><th>Status</th></tr></thead>
      <tbody>
        <tr><td>Meeting minutes</td><td>${minutesCount} event(s) have minutes</td></tr>
        <tr><td>Lease agreements</td><td>${leaseCount} of ${daysUsed} event(s)</td></tr>
        <tr><td>Invoices</td><td>${invoiceCount} of ${daysUsed} event(s)</td></tr>
        <tr><td>Paid invoices</td><td>${paidCount} of ${invoiceCount} paid</td></tr>
        <tr><td>Rate comparables</td><td>${comparablesUploaded ? ok('Uploaded') : missing('Not uploaded')}</td></tr>
      </tbody>
    </table>`,
    sectionHeader('Rental Income Documented'),
    `<table>
      <tbody>
        <tr class="total-row"><td>Total rental income documented (${year})</td><td class="amount">${money(totalIncome)}</td></tr>
      </tbody>
    </table>`,
  ].join('\n');

  const html = buildBrandedDocHtml({
    title: 'Augusta Rule Compliance Summary',
    headerLines: headerLinesFor(params.clientName, year),
    bodyHtml,
  });
  await shareHtmlAsPdf(html, 'Augusta Rule Compliance Report');
}

// ── S-Corp ──────────────────────────────────────────────────────────────────

interface SignatureRow {
  document_type: string | null;
  signer_name: string | null;
  signed_at: string | null;
}

const docChecklistTable = (
  slots: { key: string; label: string }[],
  uploaded: Set<string>,
): string => {
  const rows = slots
    .map(
      (s) =>
        `<tr><td>${escapeHtml(s.label)}</td><td>${
          uploaded.has(s.key) ? ok('Uploaded') : missing('Missing')
        }</td></tr>`,
    )
    .join('\n');
  return `<table><thead><tr><th>Document</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
};

export async function generateSCorpReport(params: ReportParams): Promise<void> {
  const year = params.taxYear ?? new Date().getFullYear();
  const slots = STRATEGY_COMPLIANCE_SLOTS['s_corp'] ?? [];

  const [docRows, sigRes] = await Promise.all([
    listStrategyDocuments('s_corp', params.businessId),
    supabase
      .from('scorp_signatures')
      .select('document_type, signer_name, signed_at')
      .order('signed_at', { ascending: false }),
  ]);

  const uploaded = new Set(
    docRows.filter((r) => r.file_url).map((r) => r.document_key),
  );
  const completed = slots.reduce((n, s) => n + (uploaded.has(s.key) ? 1 : 0), 0);
  const pct = slots.length ? Math.round((completed / slots.length) * 100) : 0;

  const sigs = (sigRes.data ?? []) as SignatureRow[];
  const planSig = sigs.find((s) => s.document_type === 'accountable_plan');
  const resolutionSig = sigs.find((s) => s.document_type === 'board_resolution');

  const signedRow = (label: string, sig: SignatureRow | undefined): string =>
    `<tr><td>${escapeHtml(label)}</td><td>${
      sig ? ok('Signed') : missing('Not signed')
    }</td><td>${sig ? fmtDate(sig.signed_at) : '—'}</td></tr>`;

  const bodyHtml = [
    sectionHeader('Document Checklist'),
    docChecklistTable(slots, uploaded),
    `<p class="clause"><strong>Overall:</strong> ${completed} of ${slots.length} documents complete</p>`,
    sectionHeader('Signed Documents'),
    `<table>
      <thead><tr><th>Document</th><th>Status</th><th>Signature Date</th></tr></thead>
      <tbody>
        ${signedRow('Accountable Plan', planSig)}
        ${signedRow('Board Resolution', resolutionSig)}
      </tbody>
    </table>`,
    sectionHeader('Compliance Score'),
    scoreBlock('Documents complete', pct),
  ].join('\n');

  const html = buildBrandedDocHtml({
    title: 'S-Corp Compliance Summary',
    headerLines: headerLinesFor(params.clientName, year),
    bodyHtml,
  });
  await shareHtmlAsPdf(html, 'S-Corp Compliance Report');
}

// ── Home Office ─────────────────────────────────────────────────────────────

const numMeta = (row: StrategyDocumentRow | undefined, key: string): number | null => {
  const v = row?.metadata?.[key];
  return typeof v === 'number' ? v : null;
};

export async function generateHomeOfficeReport(params: ReportParams): Promise<void> {
  const year = params.taxYear ?? new Date().getFullYear();
  const rows = await listStrategyDocuments('home_office', params.businessId);

  const sqftRow = rows.find((r) => r.document_key === 'square_footage');
  const utilitiesRow = rows.find((r) => r.document_key === 'utilities' && r.file_url);
  const closingRow = rows.find((r) => r.document_key === 'closing_disclosure' && r.file_url);
  const leaseRow = rows.find((r) => r.document_key === 'lease_agreement' && r.file_url);
  const renovationRows = rows.filter((r) => r.document_key === 'renovation_receipt');

  const totalSqft = numMeta(sqftRow, 'total_sqft');
  const officeSqft = numMeta(sqftRow, 'office_sqft');
  const pct =
    totalSqft && officeSqft && totalSqft > 0
      ? (officeSqft / totalSqft) * 100
      : null;
  const pctLabel = pct != null ? `${pct.toFixed(1)}%` : '—';

  const renovationTotal = renovationRows.reduce((s, r) => {
    const amt = r.metadata?.amount;
    return s + (typeof amt === 'number' ? amt : 0);
  }, 0);
  const deductibleRenovation = pct != null ? renovationTotal * (pct / 100) : 0;

  const residenceUploaded = Boolean(closingRow || leaseRow);

  const bodyHtml = [
    sectionHeader('Square Footage Summary'),
    `<table><tbody>
      <tr><td>Total sq ft</td><td class="amount">${totalSqft ?? '—'}</td></tr>
      <tr><td>Office sq ft</td><td class="amount">${officeSqft ?? '—'}</td></tr>
      <tr><td>Deduction percentage</td><td class="amount">${pctLabel}</td></tr>
    </tbody></table>`,
    sectionHeader('Document Checklist'),
    `<table><thead><tr><th>Document</th><th>Status</th></tr></thead><tbody>
      <tr><td>Square footage documentation</td><td>${sqftRow?.file_url ? ok('Uploaded') : missing('Not uploaded')}</td></tr>
      <tr><td>Utilities records</td><td>${utilitiesRow ? ok('Uploaded') : missing('Not uploaded')}</td></tr>
      <tr><td>Residence documentation</td><td>${residenceUploaded ? ok('Uploaded') : missing('Not uploaded')}</td></tr>
      <tr><td>Renovation receipts</td><td>${renovationRows.length} receipt(s), ${money(renovationTotal)} total</td></tr>
      <tr><td>Deductible renovation amount</td><td class="amount">${money(deductibleRenovation)}</td></tr>
    </tbody></table>`,
    sectionHeader('Estimated Annual Deduction'),
    `<p class="clause">Based on the ${pctLabel} office percentage applied to documented renovation expenses, the estimated deductible renovation amount is <strong>${money(
      deductibleRenovation,
    )}</strong>. Apply the same ${pctLabel} to documented utilities and other eligible home expenses for your full deduction.</p>`,
  ].join('\n');

  const html = buildBrandedDocHtml({
    title: 'Home Office Compliance Report',
    headerLines: headerLinesFor(params.clientName, year),
    bodyHtml,
  });
  await shareHtmlAsPdf(html, 'Home Office Compliance Report');
}

// ── Family Management ───────────────────────────────────────────────────────

const FAMILY_CHECKLIST: { key: string; label: string }[] = [
  { key: 'mgmt_agreement_current', label: 'Management agreement still in effect and current' },
  { key: 'fee_benchmarking', label: 'Fee benchmarking reviewed against market rates' },
  { key: 'invoices_paid', label: 'All invoices issued and paid per agreement terms' },
  { key: 'time_logs', label: 'Time logs current and complete' },
  { key: 'payroll_filings', label: 'Payroll filings current' },
  { key: 'entity_tax_return', label: 'Entity tax return filed' },
  { key: 'meeting_minutes', label: 'Meeting minutes completed' },
  { key: 'no_commingling', label: 'No commingling of personal and business funds' },
];

export async function generateFamilyMgmtReport(params: ReportParams): Promise<void> {
  const year = params.taxYear ?? new Date().getFullYear();
  const slots = STRATEGY_COMPLIANCE_SLOTS['family_management'] ?? [];

  const [docRows, checklist] = await Promise.all([
    listStrategyDocuments('family_management', params.businessId),
    listChecklistItems('family_management'),
  ]);

  const uploaded = new Set(
    docRows.filter((r) => r.file_url).map((r) => r.document_key),
  );
  const docsComplete = slots.reduce((n, s) => n + (uploaded.has(s.key) ? 1 : 0), 0);

  const byItem = new Map(checklist.map((c) => [c.item_key, c]));
  const checklistComplete = FAMILY_CHECKLIST.reduce(
    (n, c) => n + (byItem.get(c.key)?.is_checked ? 1 : 0),
    0,
  );

  const checklistRows = FAMILY_CHECKLIST.map((c) => {
    const state = byItem.get(c.key);
    const confirmed = state?.is_checked ?? false;
    return `<tr>
      <td>${escapeHtml(c.label)}</td>
      <td>${confirmed ? ok('Confirmed') : missing('Pending')}</td>
      <td>${confirmed ? fmtDate(state?.last_confirmed_at ?? null) : '—'}</td>
    </tr>`;
  }).join('\n');

  const docsPct = slots.length ? Math.round((docsComplete / slots.length) * 100) : 0;
  const checklistPct = FAMILY_CHECKLIST.length
    ? Math.round((checklistComplete / FAMILY_CHECKLIST.length) * 100)
    : 0;
  const overallPct = Math.round(
    ((docsComplete + checklistComplete) /
      (slots.length + FAMILY_CHECKLIST.length)) *
      100,
  );

  const bodyHtml = [
    sectionHeader('Document Checklist'),
    docChecklistTable(slots, uploaded),
    `<p class="clause"><strong>Overall:</strong> ${docsComplete} of ${slots.length} documents complete</p>`,
    sectionHeader('Ongoing Compliance Checklist'),
    `<table>
      <thead><tr><th>Item</th><th>Status</th><th>Last Confirmed</th></tr></thead>
      <tbody>${checklistRows}</tbody>
    </table>`,
    `<p class="clause"><strong>Overall:</strong> ${checklistComplete} of ${FAMILY_CHECKLIST.length} items confirmed</p>`,
    sectionHeader('Combined Compliance Score'),
    `<p class="clause">Documents: ${docsPct}% &nbsp;|&nbsp; Checklist: ${checklistPct}% &nbsp;|&nbsp; <strong>Overall: ${overallPct}%</strong></p>`,
  ].join('\n');

  const html = buildBrandedDocHtml({
    title: 'Family Management Compliance Report',
    headerLines: headerLinesFor(params.clientName, year),
    bodyHtml,
  });
  await shareHtmlAsPdf(html, 'Family Management Compliance Report');
}
