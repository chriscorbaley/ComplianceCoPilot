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
  lease_url: string | null;
  invoice_url: string | null;
  invoice_paid: boolean | null;
}

// augusta_rentals has no total_amount column — derive it from the daily rate ×
// the number of rental days (a business meeting is one day; longer events round
// up per 24h), matching services/augustaDocuments.
const augustaRentalDays = (h: number | null): number =>
  h == null || !Number.isFinite(Number(h)) || Number(h) <= 0
    ? 1
    : Math.max(1, Math.ceil(Number(h) / 24));

const augustaRentalTotal = (r: AugustaRentalRow): number | null =>
  r.rental_rate != null && Number.isFinite(Number(r.rental_rate))
    ? Number(r.rental_rate) * augustaRentalDays(r.duration_hours)
    : null;

export async function generateAugustaReport(params: ReportParams): Promise<void> {
  const year = params.taxYear ?? new Date().getFullYear();
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  let rentalsQ = supabase
    .from('augusta_rentals')
    .select('property_name, rental_date, duration_hours, rental_rate, lease_url, invoice_url, invoice_paid')
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
  const totalIncome = rentals.reduce((s, r) => s + (augustaRentalTotal(r) ?? 0), 0);

  const eventRows = rentals.length
    ? rentals
        .map((r) => {
          const rowTotal = augustaRentalTotal(r);
          return `<tr>
        <td>${fmtDate(r.rental_date)}</td>
        <td>${escapeHtml(r.property_name ?? '—')}</td>
        <td>${r.duration_hours != null ? `${r.duration_hours} hrs` : '—'}</td>
        <td class="amount">${r.rental_rate != null ? money(Number(r.rental_rate)) : '—'}</td>
        <td class="amount">${rowTotal != null ? money(rowTotal) : '—'}</td>
      </tr>`;
        })
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
  const closingRow = rows.find((r) => r.document_key === 'closing_disclosure' && r.file_url);
  const leaseRow = rows.find((r) => r.document_key === 'lease_agreement' && r.file_url);
  const renovationRows = rows.filter((r) => r.document_key === 'renovation_receipt');
  const utilityDataRow = rows.find((r) => r.document_key === 'utility_expenses');

  // Diagnostics: confirm the report reads the SAME metadata keys the Home Office
  // calculator writes. Square footage lives on the 'square_footage' row
  // (total_sqft / office_sqft); the utility totals live on the 'utility_expenses'
  // row (categories / office_percentage). A key-name mismatch here is what
  // produced the $0.00 deduction bug.
  const sqftMetadata = sqftRow?.metadata ?? null;
  const utilityMetadata = utilityDataRow?.metadata ?? null;
  console.log('[HomeOffice Report] metadata:', JSON.stringify(sqftMetadata));
  console.log('[HomeOffice Report] keys:', Object.keys(sqftMetadata || {}));
  console.log('[HomeOffice Report] utility metadata:', JSON.stringify(utilityMetadata));
  console.log('[HomeOffice Report] utility keys:', Object.keys(utilityMetadata || {}));

  // Office percentage as a DECIMAL (e.g. 0.125 for 12.5%). Per Fix 3 the ONLY
  // source is the square-footage calculator (office_sqft / total_sqft) stored on
  // the 'square_footage' metadata row. It is deliberately independent of whether
  // ANY document has been uploaded — the calculator persists these two values on
  // blur even with no supporting file, so the deduction percentage calculates
  // and displays as soon as both dimensions are present.
  const totalSqft = numMeta(sqftRow, 'total_sqft');
  const officeSqft = numMeta(sqftRow, 'office_sqft');
  const officePercentage: number | null =
    totalSqft != null && officeSqft != null && totalSqft > 0 && officeSqft > 0
      ? officeSqft / totalSqft
      : null;
  const hasPercentage = officePercentage != null && officePercentage > 0;
  const pctLabel = hasPercentage ? `${(officePercentage! * 100).toFixed(1)}%` : '—';

  // Exact copy for the two "can't fully calculate" states (Fix 3 items 5 & 6).
  const SQFT_MISSING_MSG =
    'Deduction percentage: Not calculated — please enter your square footage in ' +
    'the Home Office screen to calculate your deduction estimate.';
  const UTILITY_MISSING_MSG =
    'Utility deduction estimate: No utility expenses entered yet. Add your ' +
    'expenses in the Home Office screen to calculate your estimated deduction.';

  const renovationTotal = renovationRows.reduce((s, r) => {
    const amt = r.metadata?.amount;
    return s + (typeof amt === 'number' ? amt : 0);
  }, 0);
  const deductibleRenovation = hasPercentage ? renovationTotal * officePercentage! : 0;

  const residenceUploaded = Boolean(closingRow || leaseRow);

  // ── Utility expense analysis by category (Fix 4) ───────────────────────────
  // Each category stores its own method + monthly/annual values. Annual-method
  // categories show their total in the Annual Total column with the month
  // columns left blank and an "(annual)" tag — this avoids fabricating monthly
  // figures the user never entered.
  const utilityCategories = (utilityDataRow?.metadata?.categories ?? {}) as Record<
    string,
    {
      method?: string;
      monthly_entries?: Record<string, unknown>;
      annual_total?: unknown;
    }
  >;
  const UTIL_MONTH_KEYS = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ];
  const CATEGORY_LABELS: Record<string, string> = {
    mortgage_interest: 'Mortgage Interest',
    property_taxes: 'Property Taxes',
    rent: 'Rent',
    hoa_condo_fees: 'HOA / Condo Fees',
    homeowners_renters_insurance: "Homeowner's / Renter's Insurance",
    electricity: 'Electricity',
    gas: 'Gas',
    water_sewage: 'Water & Sewage',
    trash: 'Trash',
    internet: 'Internet',
    heating_cooling: 'Heating and Cooling',
    general_repairs: 'General Repairs',
    cleaning: 'Cleaning',
    pest_control: 'Pest Control',
    landscaping: 'Landscaping',
    other: 'Other',
  };

  // Normalize each entered category into { label, isAnnual, months[12], annual }.
  const utilRowsData = Object.entries(utilityCategories)
    .map(([key, raw]) => {
      const isAnnual = raw?.method === 'annual';
      const months = UTIL_MONTH_KEYS.map((mk) => {
        const v = raw?.monthly_entries?.[mk];
        return typeof v === 'number' ? v : 0;
      });
      const monthlySum = months.reduce((s, n) => s + n, 0);
      const annualEntry = typeof raw?.annual_total === 'number' ? raw.annual_total : 0;
      const annual = isAnnual ? annualEntry : monthlySum;
      return {
        label: CATEGORY_LABELS[key] ?? key,
        isAnnual,
        months,
        annual,
      };
    })
    .filter((c) => c.annual > 0)
    .sort((a, b) => a.label.localeCompare(b.label));

  const hasUtilityData = utilRowsData.length > 0;

  const utilGrandTotal = utilRowsData.reduce((s, c) => s + c.annual, 0);
  const monthColumnTotals = UTIL_MONTH_KEYS.map((_, i) =>
    utilRowsData.reduce((s, c) => s + (c.isAnnual ? 0 : c.months[i]), 0),
  );
  const utilDeduction = hasPercentage ? utilGrandTotal * officePercentage! : 0;

  console.log(
    '[HomeOffice Report] officesqft:', officeSqft,
    'totalSqft:', totalSqft,
    'percentage:', officePercentage,
    'utilities:', utilGrandTotal,
    'deductible:', utilDeduction,
  );

  // 14-column table: Category + 12 months + Annual Total. Compact font so it
  // fits the page width.
  const monthHeaders = MONTHS.map((m) => `<th class="amount">${m}</th>`).join('');
  const cell = (n: number, blank: boolean): string =>
    blank ? '<td class="amount"></td>' : `<td class="amount">${money(n)}</td>`;

  const utilCategoryRows = utilRowsData
    .map((c) => {
      const monthCells = c.months.map((n) => cell(n, c.isAnnual)).join('');
      const name = c.isAnnual ? `${escapeHtml(c.label)} <em>(annual)</em>` : escapeHtml(c.label);
      return `<tr><td>${name}</td>${monthCells}<td class="amount">${money(c.annual)}</td></tr>`;
    })
    .join('\n');

  const grandRowCells = monthColumnTotals.map((n) => `<td class="amount">${money(n)}</td>`).join('');

  // The utility table renders only when categories have data. The deduction
  // percentage + estimate live in their own always-visible section below, so the
  // percentage is NEVER gated on utility (or any document) completion.
  const utilitySection = hasUtilityData
    ? [
        sectionHeader('Utility Expense Report'),
        `<table style="font-size:9px">
          <thead><tr><th>Category</th>${monthHeaders}<th class="amount">Annual Total</th></tr></thead>
          <tbody>
            ${utilCategoryRows}
            <tr class="total-row"><td>GRAND TOTAL</td>${grandRowCells}<td class="amount">${money(utilGrandTotal)}</td></tr>
          </tbody>
        </table>`,
      ].join('\n')
    : '';

  // Fix 3: deduction percentage depends SOLELY on the square-footage calculator
  // and always displays. Three states:
  //   • no square footage      → "Not calculated" prompt (item 5)
  //   • sqft but no utilities   → percentage + "add expenses" prompt (item 6)
  //   • sqft + utilities        → percentage + deductible utility amount
  const deductionSection = [
    sectionHeader('Home Office Deduction'),
    !hasPercentage
      ? `<p class="clause" style="background:#FBEED9;color:#8A5A00;font-weight:700;padding:12px;border-radius:8px">${SQFT_MISSING_MSG}</p>`
      : [
          `<p class="clause"><strong>Deduction percentage:</strong> ${pctLabel}</p>`,
          hasUtilityData
            ? `<p class="clause" style="background:#E1F5EE;color:#0F6E56;font-weight:700;padding:12px;border-radius:8px">Total deductible utility amount: ${money(
                utilDeduction,
              )} &nbsp;(${money(utilGrandTotal)} in home expenses × ${pctLabel})</p>`
            : `<p class="clause" style="background:#FBEED9;color:#8A5A00;font-weight:700;padding:12px;border-radius:8px">${UTILITY_MISSING_MSG}</p>`,
        ].join('\n'),
  ].join('\n');

  const bodyHtml = [
    sectionHeader('Square Footage Summary'),
    `<table><tbody>
      <tr><td>Total sq ft</td><td class="amount">${totalSqft ?? '—'}</td></tr>
      <tr><td>Office sq ft</td><td class="amount">${officeSqft ?? '—'}</td></tr>
      <tr><td>Deduction percentage</td><td class="amount">${pctLabel}</td></tr>
    </tbody></table>`,
    deductionSection,
    sectionHeader('Document Checklist'),
    `<table><thead><tr><th>Document</th><th>Status</th></tr></thead><tbody>
      <tr><td>Square footage documentation</td><td>${sqftRow?.file_url ? ok('Uploaded') : missing('Not uploaded')}</td></tr>
      <tr><td>Utility expenses tracked</td><td>${hasUtilityData ? ok(`${utilRowsData.length} categor${utilRowsData.length === 1 ? 'y' : 'ies'}`) : missing('Not entered')}</td></tr>
      <tr><td>Residence documentation</td><td>${residenceUploaded ? ok('Uploaded') : missing('Not uploaded')}</td></tr>
      <tr><td>Renovation receipts</td><td>${renovationRows.length} receipt(s), ${money(renovationTotal)} total</td></tr>
      <tr><td>Deductible renovation amount</td><td class="amount">${money(deductibleRenovation)}</td></tr>
    </tbody></table>`,
    utilitySection,
    sectionHeader('Estimated Annual Deduction for Home Renovations'),
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
