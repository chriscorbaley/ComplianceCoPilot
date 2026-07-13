// Business Travel trip compliance documents.
//
// After a trip is saved on the Business Travel screen (Log Trip tab), we
// generate a formatted "BUSINESS TRIP COMPLIANCE RECORD" and mirror it into the
// documents table (file_type 'trip_report', strategy_category 'business_travel')
// so it shows up in the Documents vault with a Business Travel badge and opens
// in the in-app text viewer.
//
// The same content is also available as a branded PDF ("Export Trip Report")
// from each Trip History row — same navy header + logo as every other report.
//
// All IRS thresholds come from compliance_rules via the shared deductibility
// engine (evaluateFromCounts) — nothing here is hard-coded.

import { supabase, requireUserId, type BusinessTripRow } from './supabase';
import type { ComplianceRules } from './complianceRules';
import {
  evaluateFromCounts,
  type DeductibilityResult,
  type TripType,
} from './deductibilityEngine';
import {
  buildBrandedDocHtml,
  sectionHeader,
  escapeHtml,
  shareHtmlAsPdf,
} from './pdfDocuments';

export interface TripDocExpenses {
  transport: number;
  lodging: number;
  meals: number;
  other: number;
}

export interface TripDocInput {
  businessId: string | null;
  trip_type: TripType;
  destination: string;
  departure_date: string | null; // 'YYYY-MM-DD'
  return_date: string | null; // 'YYYY-MM-DD'
  total_days: number;
  business_days: number;
  personal_days: number;
  purpose: string;
  countries?: string[];
  expenses: TripDocExpenses;
}

// ── Formatting helpers ───────────────────────────────────────────────────────

const parseISO = (iso: string | null): Date | null => {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

const fmtMMDDYYYY = (iso: string | null): string => {
  const d = parseISO(iso);
  if (!d) return '—';
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${mo}/${day}/${d.getFullYear()}`;
};

const money = (n: number): string =>
  `$${(Number.isFinite(n) ? n : 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// ── Deductibility math (derived from the shared engine) ──────────────────────

interface TripComputed {
  result: DeductibilityResult;
  countedBusinessDays: number;
  transportPct: number;
  mealsPct: number; // integer, e.g. 50
  transportDeductible: number;
  lodgingDeductible: number;
  mealsDeductible: number;
  totalDeductible: number;
  expenseTotal: number;
  primaryPurpose: 'Business' | 'Personal';
}

function computeTrip(input: TripDocInput, rules: ComplianceRules): TripComputed {
  const result = evaluateFromCounts({
    trip_type: input.trip_type,
    destination: input.destination || 'Trip',
    purpose: input.purpose,
    total_days: input.total_days,
    business_days: input.business_days,
    countries: input.countries,
    rules,
  });

  const total = input.total_days > 0 ? input.total_days : 0;
  // Days that count toward business (business + travel days) — lodging and
  // meals are deductible on these days only.
  const countedBusinessDays = result.counted_business_days;
  const businessFraction = total > 0 ? countedBusinessDays / total : 0;

  const transportPct = result.breakdown.transportation_pct;
  const mealsPct = Math.round(rules.mealsDeductionPct * 100);

  const transportDeductible = (input.expenses.transport * transportPct) / 100;
  const lodgingDeductible = input.expenses.lodging * businessFraction;
  const mealsDeductible = input.expenses.meals * businessFraction * rules.mealsDeductionPct;
  const totalDeductible = transportDeductible + lodgingDeductible + mealsDeductible;

  const expenseTotal =
    input.expenses.transport +
    input.expenses.lodging +
    input.expenses.meals +
    input.expenses.other;

  const primaryPurpose: 'Business' | 'Personal' =
    result.verdict === 'not_deductible' ? 'Personal' : 'Business';

  return {
    result,
    countedBusinessDays,
    transportPct,
    mealsPct,
    transportDeductible,
    lodgingDeductible,
    mealsDeductible,
    totalDeductible,
    expenseTotal,
    primaryPurpose,
  };
}

// ── Plain-text compliance record (stored in documents.file_url) ──────────────

export function buildTripRecordText(input: TripDocInput, rules: ComplianceRules): string {
  const c = computeTrip(input, rules);
  const rule = '═══════════════════════════════';
  const tripTypeLabel = input.trip_type === 'international' ? 'International' : 'Domestic';

  return [
    'BUSINESS TRIP COMPLIANCE RECORD',
    rule,
    `Trip Type: ${tripTypeLabel}`,
    `Destination: ${input.destination || '—'}`,
    `Departure: ${fmtMMDDYYYY(input.departure_date)}`,
    `Return: ${fmtMMDDYYYY(input.return_date)}`,
    `Total Days: ${input.total_days}`,
    `Business Days: ${c.result.business_days}`,
    `Personal Days: ${c.result.personal_days}`,
    '',
    'BUSINESS PURPOSE:',
    input.purpose || '—',
    '',
    'DEDUCTIBILITY ANALYSIS:',
    `Primary Purpose: ${c.primaryPurpose}`,
    `Business Day Percentage: ${c.result.business_day_pct}%`,
    `Transportation: ${c.transportPct}% deductible`,
    `Lodging: ${c.countedBusinessDays} of ${input.total_days} nights deductible`,
    `Meals: ${c.mealsPct}% on ${c.countedBusinessDays} business days`,
    '',
    'EXPENSES:',
    `Transportation: ${money(input.expenses.transport)}`,
    `Lodging: ${money(input.expenses.lodging)}`,
    `Meals: ${money(input.expenses.meals)}`,
    `Other: ${money(input.expenses.other)}`,
    `Total: ${money(c.expenseTotal)}`,
    '',
    'Estimated Deductible Amount:',
    `Transportation: ${money(c.transportDeductible)}`,
    `Lodging: ${money(c.lodgingDeductible)}`,
    `Meals: ${money(c.mealsDeductible)}`,
    `Total Estimated Deduction: ${money(c.totalDeductible)}`,
    '',
    'This record was generated from',
    'contemporaneous records maintained',
    'in Compliance Co-Pilot.',
    rule,
  ].join('\n');
}

// ── Branded PDF (Export Trip Report) ─────────────────────────────────────────

export function buildTripReportHtml(input: TripDocInput, rules: ComplianceRules): string {
  const c = computeTrip(input, rules);
  const tripTypeLabel = input.trip_type === 'international' ? 'International' : 'Domestic';

  const transportRule =
    input.trip_type === 'international'
      ? c.result.rule_applied
      : c.primaryPurpose === 'Business'
        ? 'Primary purpose business — 100% deductible'
        : 'Primary purpose personal — not deductible';

  const body = `
<div class="meta-card">
  <div class="meta-row"><span class="meta-label">Trip Type</span><span class="meta-value">${escapeHtml(tripTypeLabel)}</span></div>
  <div class="meta-row"><span class="meta-label">Destination</span><span class="meta-value">${escapeHtml(input.destination || '—')}</span></div>
  <div class="meta-row"><span class="meta-label">Departure</span><span class="meta-value">${escapeHtml(fmtMMDDYYYY(input.departure_date))}</span></div>
  <div class="meta-row"><span class="meta-label">Return</span><span class="meta-value">${escapeHtml(fmtMMDDYYYY(input.return_date))}</span></div>
  <div class="meta-row"><span class="meta-label">Total Days</span><span class="meta-value">${input.total_days}</span></div>
  <div class="meta-row"><span class="meta-label">Business Days</span><span class="meta-value">${c.result.business_days}</span></div>
  <div class="meta-row"><span class="meta-label">Personal Days</span><span class="meta-value">${c.result.personal_days}</span></div>
</div>

${sectionHeader('Business Purpose')}
<p class="clause">${escapeHtml(input.purpose || '—')}</p>

${sectionHeader('Deductibility Analysis')}
<p class="clause"><strong>Primary Purpose:</strong> ${c.primaryPurpose} · <strong>Business Day Percentage:</strong> ${c.result.business_day_pct}%</p>
<table>
  <thead>
    <tr><th>Expense</th><th>Rule Applied</th><th class="amount">Deductible</th></tr>
  </thead>
  <tbody>
    <tr>
      <td>Transportation</td>
      <td>${escapeHtml(transportRule)}</td>
      <td class="amount">${c.transportPct}%</td>
    </tr>
    <tr>
      <td>Lodging</td>
      <td>Business days only</td>
      <td class="amount">${c.countedBusinessDays} of ${input.total_days} nights</td>
    </tr>
    <tr>
      <td>Meals</td>
      <td>50% on business days</td>
      <td class="amount">${c.mealsPct}%</td>
    </tr>
  </tbody>
</table>

${sectionHeader('Expenses & Estimated Deduction')}
<table>
  <thead>
    <tr><th>Expense</th><th class="amount">Amount</th><th class="amount">Estimated Deductible</th></tr>
  </thead>
  <tbody>
    <tr><td>Transportation</td><td class="amount">${money(input.expenses.transport)}</td><td class="amount">${money(c.transportDeductible)}</td></tr>
    <tr><td>Lodging</td><td class="amount">${money(input.expenses.lodging)}</td><td class="amount">${money(c.lodgingDeductible)}</td></tr>
    <tr><td>Meals</td><td class="amount">${money(input.expenses.meals)}</td><td class="amount">${money(c.mealsDeductible)}</td></tr>
    <tr><td>Other</td><td class="amount">${money(input.expenses.other)}</td><td class="amount">—</td></tr>
    <tr class="total-row"><td>Total</td><td class="amount">${money(c.expenseTotal)}</td><td class="amount">${money(c.totalDeductible)}</td></tr>
  </tbody>
</table>
`;

  return buildBrandedDocHtml({
    title: 'BUSINESS TRIP COMPLIANCE RECORD',
    headerLines: [
      `${tripTypeLabel} trip — ${input.destination || 'Trip'}`,
      `${fmtMMDDYYYY(input.departure_date)} – ${fmtMMDDYYYY(input.return_date)}`,
      'Generated by Compliance Co-Pilot',
    ],
    bodyHtml: body,
  });
}

// ── Document name + persistence ──────────────────────────────────────────────

function tripDocName(input: TripDocInput): string {
  const dep = input.departure_date ? fmtMMDDYYYY(input.departure_date) : '';
  const parts = ['Business Trip', input.destination || 'Trip'];
  if (dep && dep !== '—') parts.push(dep);
  return parts.join(' — ');
}

// Save the trip compliance record into the documents table so it appears in the
// Documents screen. Called right after a trip row is saved.
export async function saveTripDocument(
  input: TripDocInput,
  rules: ComplianceRules,
): Promise<void> {
  const userId = await requireUserId();
  const text = buildTripRecordText(input, rules);
  const { error } = await supabase.from('documents').insert({
    user_id: userId,
    business_id: input.businessId,
    name: tripDocName(input),
    strategy_category: 'business_travel',
    file_type: 'trip_report',
    file_url: text,
  });
  if (error) throw new Error(error.message);
}

// Map a stored business_trips row into the doc input shape.
export function tripRowToDocInput(row: BusinessTripRow): TripDocInput {
  return {
    businessId: row.business_id ?? null,
    trip_type: (row.trip_type ?? 'domestic') as TripType,
    destination: row.destination ?? '',
    departure_date: row.departure_date ?? null,
    return_date: row.return_date ?? null,
    total_days: row.total_days ?? 0,
    business_days: row.business_days ?? 0,
    personal_days: row.personal_days ?? 0,
    purpose: row.purpose ?? '',
    countries: row.countries_visited ?? undefined,
    expenses: {
      transport: row.expenses_transport ?? 0,
      lodging: row.expenses_lodging ?? 0,
      meals: row.expenses_meals ?? 0,
      other: row.expenses_other ?? 0,
    },
  };
}

// Build + share the branded PDF for a saved trip (Trip History → Export).
export async function exportTripReportPdf(
  row: BusinessTripRow,
  rules: ComplianceRules,
): Promise<void> {
  const input = tripRowToDocInput(row);
  const html = buildTripReportHtml(input, rules);
  await shareHtmlAsPdf(html, tripDocName(input));
}
