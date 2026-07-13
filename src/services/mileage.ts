// Mileage Tracker service: IRS standard-rate lookup and the mileage-log PDF
// report. Rates come from compliance_rules (strategy_name = 'mileage',
// rule_key = 'business_rate_[year]' / 'medical_rate_[year]'); if a row is
// missing the app falls back to the published IRS defaults below. The report
// reuses the shared branded-PDF infrastructure in pdfDocuments so it matches
// every other report (navy header, brand logo, #185FA5 tables).

import {
  supabase,
  type MileageLogRow,
  type MileageTripType,
  type VehicleRow,
} from './supabase';
import { loadComplianceRules, ruleNumber, type ComplianceRules } from './complianceRules';
import {
  buildBrandedDocHtml,
  escapeHtml,
  sectionHeader,
  shareHtmlAsPdf,
} from './pdfDocuments';

// Published IRS standard mileage rates ($/mile), used when compliance_rules has
// no override for the requested year.
const BUSINESS_RATE_FALLBACK: Record<number, number> = {
  2023: 0.655,
  2024: 0.67,
  2025: 0.7,
  2026: 0.7,
};
const MEDICAL_RATE_FALLBACK: Record<number, number> = {
  2023: 0.22,
  2024: 0.21,
  2025: 0.21,
  2026: 0.21,
};

const DEFAULT_BUSINESS_RATE = 0.7;
const DEFAULT_MEDICAL_RATE = 0.21;

// Resolves the $/mile rate for a trip type in a given tax year. Reads the live
// compliance_rules snapshot first, then the fallback table.
export function mileageRate(
  rules: ComplianceRules | null,
  year: number,
  type: MileageTripType,
): number {
  const key = `${type}_rate_${year}`;
  const fallback =
    type === 'business'
      ? BUSINESS_RATE_FALLBACK[year] ?? DEFAULT_BUSINESS_RATE
      : MEDICAL_RATE_FALLBACK[year] ?? DEFAULT_MEDICAL_RATE;
  return ruleNumber(rules, 'mileage', key, fallback);
}

// ── Data helpers ─────────────────────────────────────────────────────────

export async function listVehicles(businessId: string | null): Promise<VehicleRow[]> {
  let q = supabase.from('vehicles').select('*').order('created_at', { ascending: true });
  if (businessId) q = q.eq('business_id', businessId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as VehicleRow[];
}

export async function listMileageForYear(
  businessId: string | null,
  year: number,
): Promise<MileageLogRow[]> {
  let q = supabase
    .from('mileage_log')
    .select('*')
    .eq('tax_year', year)
    .order('trip_date', { ascending: false, nullsFirst: false });
  if (businessId) q = q.eq('business_id', businessId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as MileageLogRow[];
}

// Human label for a vehicle: nickname if set, else "Year Make Model".
export function vehicleLabel(v: VehicleRow | undefined | null): string {
  if (!v) return 'Unassigned vehicle';
  const ymm = [v.year, v.make, v.model].filter(Boolean).join(' ').trim();
  return v.nickname && v.nickname.trim() ? v.nickname.trim() : ymm || 'Vehicle';
}

export function vehicleYmm(v: VehicleRow | undefined | null): string {
  if (!v) return 'Unassigned vehicle';
  const ymm = [v.year, v.make, v.model].filter(Boolean).join(' ').trim();
  return ymm || (v.nickname ?? 'Vehicle');
}

// ── Report ─────────────────────────────────────────────────────────────────

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const formatTripDate = (iso: string | null): string => {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const month = MONTH_SHORT[Number(m[2]) - 1] ?? m[2];
  return `${month} ${m[3]}, ${m[1]}`;
};

const money = (n: number): string =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const miles = (n: number): string =>
  n.toLocaleString('en-US', { maximumFractionDigits: 0 });

export interface MileageReportParams {
  clientName: string;
  businessId: string | null;
  year: number;
  now?: Date;
}

interface TripLine {
  date: string;
  vehicle: string;
  purpose: string;
  miles: number;
  deduction: number;
}

// Builds the trip-log table rows for one category + a subtotal row.
function tripTable(
  title: string,
  lines: TripLine[],
  totalMiles: number,
  totalDeduction: number,
): string {
  const body =
    lines.length > 0
      ? lines
          .map(
            (l) => `
    <tr>
      <td>${escapeHtml(l.date)}</td>
      <td>${escapeHtml(l.vehicle)}</td>
      <td>${escapeHtml(l.purpose)}</td>
      <td class="amount">${miles(l.miles)}</td>
      <td class="amount">${money(l.deduction)}</td>
    </tr>`,
          )
          .join('')
      : `
    <tr><td colspan="5" style="color:#888888; font-style:italic;">No ${title.toLowerCase()} logged for this year.</td></tr>`;
  return `${sectionHeader(title)}
<table>
  <thead>
    <tr>
      <th>Date</th><th>Vehicle</th><th>Purpose</th>
      <th class="amount">Miles</th><th class="amount">Deduction</th>
    </tr>
  </thead>
  <tbody>${body}
    <tr class="total-row">
      <td colspan="3">Subtotal — ${escapeHtml(title)}</td>
      <td class="amount">${miles(totalMiles)}</td>
      <td class="amount">${money(totalDeduction)}</td>
    </tr>
  </tbody>
</table>`;
}

// Gathers the year's mileage, computes deductions from live IRS rates, and
// shares a branded PDF via the system share sheet.
export async function generateMileageReport(params: MileageReportParams): Promise<void> {
  const now = params.now ?? new Date();
  const [rules, vehicles, rows] = await Promise.all([
    loadComplianceRules().catch(() => null),
    listVehicles(params.businessId),
    listMileageForYear(params.businessId, params.year),
  ]);

  const vehicleById = new Map(vehicles.map((v) => [v.id, v]));
  const businessRate = mileageRate(rules, params.year, 'business');
  const medicalRate = mileageRate(rules, params.year, 'medical');

  const toLine = (r: MileageLogRow): TripLine => {
    const m = r.total_miles != null ? Number(r.total_miles) : 0;
    const rate = r.trip_type === 'medical' ? medicalRate : businessRate;
    const deduction =
      r.deduction_amount != null ? Number(r.deduction_amount) : m * rate;
    return {
      date: formatTripDate(r.trip_date),
      vehicle: vehicleLabel(r.vehicle_id ? vehicleById.get(r.vehicle_id) : null),
      purpose: r.purpose ?? '',
      miles: m,
      deduction,
    };
  };

  const businessRows = rows.filter((r) => r.trip_type !== 'medical');
  const medicalRows = rows.filter((r) => r.trip_type === 'medical');
  const businessLines = businessRows.map(toLine);
  const medicalLines = medicalRows.map(toLine);

  const sum = (ls: TripLine[], k: 'miles' | 'deduction'): number =>
    ls.reduce((s, l) => s + l[k], 0);

  const businessMiles = sum(businessLines, 'miles');
  const businessDeduction = sum(businessLines, 'deduction');
  const medicalMiles = sum(medicalLines, 'miles');
  const medicalDeduction = sum(medicalLines, 'deduction');
  const totalMiles = businessMiles + medicalMiles;
  const totalDeduction = businessDeduction + medicalDeduction;

  const summary = `${sectionHeader('Annual Mileage Summary')}
<table>
  <thead>
    <tr>
      <th>Category</th>
      <th class="amount">Miles</th>
      <th class="amount">IRS Rate</th>
      <th class="amount">Deduction</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Business Miles</td>
      <td class="amount">${miles(businessMiles)}</td>
      <td class="amount">$${businessRate.toFixed(3)}</td>
      <td class="amount">${money(businessDeduction)}</td>
    </tr>
    <tr>
      <td>Medical Miles</td>
      <td class="amount">${miles(medicalMiles)}</td>
      <td class="amount">$${medicalRate.toFixed(3)}</td>
      <td class="amount">${money(medicalDeduction)}</td>
    </tr>
    <tr class="total-row">
      <td>TOTAL</td>
      <td class="amount">${miles(totalMiles)}</td>
      <td class="amount"></td>
      <td class="amount">${money(totalDeduction)}</td>
    </tr>
  </tbody>
</table>`;

  // Per-vehicle breakdown, only when more than one vehicle exists.
  let vehicleBreakdown = '';
  if (vehicles.length > 1) {
    vehicleBreakdown = sectionHeader('Vehicle Breakdown');
    for (const v of vehicles) {
      const vRows = rows.filter((r) => r.vehicle_id === v.id);
      const vMiles = vRows.reduce((s, r) => s + (Number(r.total_miles) || 0), 0);
      const vDeduction = vRows.reduce(
        (s, r) =>
          s +
          (r.deduction_amount != null
            ? Number(r.deduction_amount)
            : (Number(r.total_miles) || 0) *
              (r.trip_type === 'medical' ? medicalRate : businessRate)),
        0,
      );
      const nick = v.nickname && v.nickname.trim() ? ` (${escapeHtml(v.nickname.trim())})` : '';
      vehicleBreakdown += `
<div class="meta-card">
  <div class="meta-row"><span class="meta-label">Vehicle</span><span class="meta-value">${escapeHtml(
    vehicleYmm(v),
  )}${nick}</span></div>
  <div class="meta-row"><span class="meta-label">Miles logged</span><span class="meta-value">${miles(
    vMiles,
  )}</span></div>
  <div class="meta-row"><span class="meta-label">Estimated deduction</span><span class="meta-value">${money(
    vDeduction,
  )}</span></div>
</div>`;
    }
  }

  const grandTotal = `
<div class="section-header" style="background:#042C53;">
  Total Estimated Deduction — ${params.year}: ${money(totalDeduction)}
</div>`;

  const disclaimer = `
<p style="font-size:11px; color:#888888; margin-top:20px; line-height:1.5;">
  Mileage deductions calculated using IRS standard mileage rates for ${params.year}.
  Business rate: $${businessRate.toFixed(3)}/mile. Medical rate: $${medicalRate.toFixed(3)}/mile.
  Consult your tax professional to confirm deductibility of specific trips.
</p>`;

  const generatedDate = `${MONTH_SHORT[now.getMonth()]} ${String(now.getDate()).padStart(
    2,
    '0',
  )}, ${now.getFullYear()}`;

  const bodyHtml = `${summary}${vehicleBreakdown}${tripTable(
    'Business Trips',
    businessLines,
    businessMiles,
    businessDeduction,
  )}${tripTable(
    'Medical Trips',
    medicalLines,
    medicalMiles,
    medicalDeduction,
  )}${grandTotal}${disclaimer}`;

  const html = buildBrandedDocHtml({
    title: 'MILEAGE LOG REPORT',
    headerLines: [
      params.clientName || 'Client',
      `Tax Year: ${params.year}`,
      `Generated: ${generatedDate}`,
    ],
    bodyHtml,
    footer: `Mileage Log Report · ${params.clientName || 'Client'} · Tax Year ${params.year} · Generated ${generatedDate}`,
  });

  await shareHtmlAsPdf(html, `Mileage Log Report — ${params.year}`);
}
