// Real Estate Compliance Report: a comprehensive PDF a client can hand to their
// tax professional. It reuses the exact same query helpers and shared
// calculation (calculateEffectiveMinHours) the Hours screen and Dashboard use —
// listProperties, loadComplianceRules, aggregateHours, readThresholds,
// mpHourThreshold — so the report can never drift from what those screens show.

import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { supabase, type HoursLogRow, type PropertyRow } from './supabase';
import { listProperties, MP_TEST_FROM_INT, MP_TEST_SHORT_LABEL } from './properties';
import { loadComplianceRules } from './complianceRules';
import {
  aggregateHours,
  readThresholds,
  mpHourThreshold,
  paceFor,
} from './realEstate';
import {
  buildRepsRulesRecord,
  calculateEffectiveMinHours,
} from '../utils/repsCalculations';

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const formatDate = (d: Date): string =>
  `${MONTH_SHORT[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')} ${d.getFullYear()}`;

// Formats a stored 'YYYY-MM-DD' activity_date as 'MMM DD YYYY' without going
// through new Date(), which would shift the day across timezone boundaries.
const formatActivityDate = (iso: string | null): string => {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const month = MONTH_SHORT[Number(m[2]) - 1] ?? m[2];
  return `${month} ${m[3]} ${m[1]}`;
};

// Maps the stored participation bucket to the short label shown in the audit
// activity tables: reps_general → REPS General, material_participation → MP,
// str_participation → STR.
const formatHoursType = (t: string | null): string => {
  switch (t) {
    case 'reps_general':
      return 'REPS General';
    case 'material_participation':
      return 'MP';
    case 'str_participation':
      return 'STR';
    default:
      return t ?? '—';
  }
};

const formatDateTime = (d: Date): string => {
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${formatDate(d)} ${h12}:${m} ${ampm}`;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Status helpers — collapse the shared paceFor() into the report vocabulary ──

type RowStatus = 'Met' | 'In Progress' | 'At Risk';

function rowStatus(hours: number, threshold: number | null): RowStatus {
  if (threshold == null || threshold <= 0) return 'In Progress';
  if (hours >= threshold) return 'Met';
  return paceFor(hours / threshold).label === 'At Risk' ? 'At Risk' : 'In Progress';
}

function rowStatusClass(s: RowStatus): string {
  if (s === 'Met') return 'status-met';
  if (s === 'At Risk') return 'status-not-met';
  return 'status-in-progress';
}

type GateStatus = 'Met' | 'On Track' | 'Not Yet Met';

function gateStatus(reHours: number, effectiveMin: number): GateStatus {
  if (effectiveMin > 0 && reHours >= effectiveMin) return 'Met';
  return paceFor(effectiveMin > 0 ? reHours / effectiveMin : 0).label === 'At Risk'
    ? 'Not Yet Met'
    : 'On Track';
}

function gateStatusClass(s: GateStatus): string {
  if (s === 'Met') return 'status-met';
  if (s === 'Not Yet Met') return 'status-not-met';
  return 'status-in-progress';
}

type OverallStatus = 'Qualified' | 'On Track' | 'Behind';

function overallStatus(reHours: number, effectiveMin: number): OverallStatus {
  if (effectiveMin > 0 && reHours >= effectiveMin) return 'Qualified';
  return paceFor(effectiveMin > 0 ? reHours / effectiveMin : 0).label === 'At Risk'
    ? 'Behind'
    : 'On Track';
}

function overallStatusClass(s: OverallStatus): string {
  if (s === 'Qualified') return 'status-met';
  if (s === 'Behind') return 'status-not-met';
  return 'status-in-progress';
}

// ── Data model ───────────────────────────────────────────────────────────────

// One logged activity, ready to drop into the per-property detail table.
interface ActivityReportRow {
  date: string; // formatted MMM DD YYYY
  description: string;
  hoursTypeLabel: string;
  hours: number;
}

interface PropertyReportRow {
  name: string;
  testLabel: string;
  hoursLogged: number;
  threshold: number | null;
  remaining: number | null;
  status: RowStatus;
  avgRentalDays: number | null;
  // Individual activities logged against this property, ascending by date.
  activities: ActivityReportRow[];
}

export interface RealEstateReportData {
  clientName: string;
  year: number;
  generatedDate: string;
  generatedDateTime: string;
  strategyLabel: string;
  repsPursuitActive: boolean;
  totalREHours: number;
  totalWorkHours: number | null;
  effectiveMin: number;
  repsRemaining: number;
  repsPct: number;
  gate1Status: GateStatus;
  longTerm: PropertyReportRow[];
  shortTerm: PropertyReportRow[];
  totalLongTermHours: number;
  totalShortTermHours: number;
  grandTotalHours: number;
  metCount: number;
  totalCount: number;
  // Activities logged with no property attached (property_id is null).
  generalActivities: ActivityReportRow[];
}

export interface GatherReportParams {
  userId: string;
  businessId: string | null;
  clientName: string;
  now?: Date;
}

// Loads everything the report needs through the existing shared helpers and
// folds it into a flat RealEstateReportData. No bespoke calculations — the
// effective REPS minimum comes straight from calculateEffectiveMinHours.
export async function gatherRealEstateReportData(
  params: GatherReportParams,
): Promise<RealEstateReportData> {
  const now = params.now ?? new Date();
  const year = now.getFullYear();

  let hoursQ = supabase
    .from('hours_log')
    .select('*')
    .eq('user_id', params.userId)
    .gte('activity_date', `${year}-01-01`)
    .lte('activity_date', `${year}-12-31`);
  if (params.businessId) hoursQ = hoursQ.eq('business_id', params.businessId);

  const userQ = supabase
    .from('users')
    .select(
      'reps_pursuit_active, total_work_hours_this_year, re_property_type, re_grouping_election',
    )
    .eq('id', params.userId)
    .maybeSingle();

  const [rules, properties, hoursRes, userRes] = await Promise.all([
    loadComplianceRules(),
    listProperties(params.businessId),
    hoursQ,
    userQ,
  ]);

  const rows = (hoursRes.data ?? []) as HoursLogRow[];
  const userRow = (userRes.data ?? {}) as {
    reps_pursuit_active?: boolean | null;
    total_work_hours_this_year?: number | null;
    re_property_type?: string | null;
  };

  const thresholds = readThresholds(rules.rawDb);
  const agg = aggregateHours(rows, properties);
  const totalWorkHours =
    userRow.total_work_hours_this_year != null
      ? Number(userRow.total_work_hours_this_year)
      : null;
  const effectiveMin = calculateEffectiveMinHours(
    totalWorkHours ?? 0,
    buildRepsRulesRecord(rules.rawDb),
  );
  const repsPursuitActive = userRow.reps_pursuit_active === true;

  // Every logged hour counts toward REPS qualification — mirrors HoursScreen.
  const totalREHours =
    agg.totals.reps_general +
    agg.totals.material_participation +
    agg.totals.str_participation;

  // Group every logged activity by property so each property's detail table can
  // list its own rows; rows with no property_id are kept aside for the
  // "General Real Estate Activities" section.
  const rowsByProperty = new Map<string, HoursLogRow[]>();
  const generalRows: HoursLogRow[] = [];
  for (const r of rows) {
    if (r.property_id) {
      const list = rowsByProperty.get(r.property_id);
      if (list) list.push(r);
      else rowsByProperty.set(r.property_id, [r]);
    } else {
      generalRows.push(r);
    }
  }

  const toActivityRow = (r: HoursLogRow): ActivityReportRow => ({
    date: formatActivityDate(r.activity_date),
    description: r.description ?? '',
    hoursTypeLabel: formatHoursType(r.hours_type),
    hours: r.hours != null ? Number(r.hours) : 0,
  });

  // Sort ascending by activity_date — ISO 'YYYY-MM-DD' strings sort lexically.
  const sortByDate = (a: HoursLogRow, b: HoursLogRow): number =>
    (a.activity_date ?? '').localeCompare(b.activity_date ?? '');

  const describe = (p: PropertyRow): PropertyReportRow => {
    const test =
      p.mp_test_selected != null ? MP_TEST_FROM_INT[p.mp_test_selected] ?? null : null;
    const threshold = test ? mpHourThreshold(test, thresholds) : null;
    const hoursLogged = agg.perProperty.get(p.id) ?? 0;
    const activities = (rowsByProperty.get(p.id) ?? [])
      .slice()
      .sort(sortByDate)
      .map(toActivityRow);
    return {
      name: p.property_name,
      testLabel: test ? MP_TEST_SHORT_LABEL[test] : 'Not selected',
      hoursLogged,
      threshold,
      remaining: threshold != null ? Math.max(0, threshold - hoursLogged) : null,
      status: rowStatus(hoursLogged, threshold),
      avgRentalDays: null, // The app does not yet capture per-stay booking data.
      activities,
    };
  };

  const generalActivities = generalRows.slice().sort(sortByDate).map(toActivityRow);

  const longTerm = properties
    .filter((p) => p.property_type === 'long_term')
    .map(describe);
  const shortTerm = properties
    .filter((p) => p.property_type === 'short_term')
    .map(describe);

  const totalLongTermHours = longTerm.reduce((s, r) => s + r.hoursLogged, 0);
  const totalShortTermHours = shortTerm.reduce((s, r) => s + r.hoursLogged, 0);
  const grandTotalHours = totalREHours;

  const allRows = [...longTerm, ...shortTerm];
  const totalCount = allRows.length;
  const metCount = allRows.filter((r) => r.status === 'Met').length;

  const strategyLabel = repsPursuitActive
    ? 'REPS Pursuit'
    : shortTerm.length > 0 && longTerm.length === 0
      ? 'STR'
      : 'Material Participation Only';

  return {
    clientName: params.clientName || 'Client',
    year,
    generatedDate: formatDate(now),
    generatedDateTime: formatDateTime(now),
    strategyLabel,
    repsPursuitActive,
    totalREHours,
    totalWorkHours,
    effectiveMin,
    repsRemaining: Math.max(0, effectiveMin - totalREHours),
    repsPct:
      totalWorkHours && totalWorkHours > 0
        ? (totalREHours / totalWorkHours) * 100
        : 0,
    gate1Status: gateStatus(totalREHours, effectiveMin),
    longTerm,
    shortTerm,
    totalLongTermHours,
    totalShortTermHours,
    grandTotalHours,
    metCount,
    totalCount,
    generalActivities,
  };
}

// ── HTML template ──────────────────────────────────────────────────────────

function repsSection(d: RealEstateReportData): string {
  if (!d.repsPursuitActive) return '';
  const statusClass = gateStatusClass(d.gate1Status);
  return `
<div class="section-header">
  REPS Qualification Summary
</div>
<div class="summary-card">
  <h3>Gate 1 — Hour Requirements</h3>
  <div class="summary-row">
    <span class="summary-label">Total RE hours logged</span>
    <span class="summary-value">${d.totalREHours.toFixed(0)} hrs</span>
  </div>
  <div class="summary-row">
    <span class="summary-label">Total annual work hours</span>
    <span class="summary-value">${d.totalWorkHours != null ? `${d.totalWorkHours.toFixed(0)} hrs` : 'Not provided'}</span>
  </div>
  <div class="summary-row">
    <span class="summary-label">Effective minimum required</span>
    <span class="summary-value">${d.effectiveMin} hrs</span>
  </div>
  <div class="summary-row">
    <span class="summary-label">Hours remaining</span>
    <span class="summary-value ${statusClass}">${d.repsRemaining.toFixed(0)} hrs</span>
  </div>
  <div class="summary-row">
    <span class="summary-label">RE hours as % of total work</span>
    <span class="summary-value">${d.repsPct.toFixed(1)}%</span>
  </div>
  <div class="summary-row">
    <span class="summary-label">REPS Gate 1 Status</span>
    <span class="${statusClass}">${d.gate1Status}</span>
  </div>
</div>`;
}

function longTermSection(d: RealEstateReportData): string {
  if (d.longTerm.length === 0) return '';
  const rows = d.longTerm
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.testLabel)}</td>
      <td>${r.hoursLogged.toFixed(0)} hrs</td>
      <td>${r.threshold != null ? `${r.threshold} hrs` : '—'}</td>
      <td>${r.remaining != null ? `${r.remaining.toFixed(0)} hrs` : '—'}</td>
      <td class="${rowStatusClass(r.status)}">${r.status}</td>
    </tr>`,
    )
    .join('');
  return `
<div class="section-header">
  Long-Term Rental Properties — Material Participation
</div>
<table>
  <thead>
    <tr>
      <th>Property</th>
      <th>MP Test</th>
      <th>Hours Logged</th>
      <th>Target</th>
      <th>Remaining</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>${rows}
    <tr class="total-row">
      <td colspan="2">Total Long-Term Hours</td>
      <td>${d.totalLongTermHours.toFixed(0)}</td>
      <td colspan="3"></td>
    </tr>
  </tbody>
</table>`;
}

function shortTermSection(d: RealEstateReportData): string {
  if (d.shortTerm.length === 0) return '';
  const rows = d.shortTerm
    .map((r) => {
      const avg =
        r.avgRentalDays != null
          ? `${r.avgRentalDays.toFixed(0)} days ${r.avgRentalDays <= 7 ? '✓' : '⚠'}`
          : 'Not tracked';
      return `
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.testLabel)}</td>
      <td>${r.hoursLogged.toFixed(0)} hrs</td>
      <td>${r.threshold != null ? `${r.threshold} hrs` : '—'}</td>
      <td>${avg}</td>
      <td class="${rowStatusClass(r.status)}">${r.status}</td>
    </tr>`;
    })
    .join('');
  return `
<div class="section-header">
  Short-Term Rental Properties — Material Participation
</div>
<table>
  <thead>
    <tr>
      <th>Property</th>
      <th>MP Test</th>
      <th>Hours Logged</th>
      <th>Target</th>
      <th>Avg Rental Days</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>${rows}
    <tr class="total-row">
      <td colspan="2">Total STR Hours</td>
      <td>${d.totalShortTermHours.toFixed(0)}</td>
      <td colspan="3"></td>
    </tr>
  </tbody>
</table>`;
}

// ── Per-property activity detail (IRS audit support) ─────────────────────────

const ACTIVITY_TABLE_HEAD = `
  <thead>
    <tr>
      <th style="width:20%">Date</th>
      <th style="width:50%">Activity</th>
      <th style="width:15%">Type</th>
      <th style="width:15%">Hours</th>
    </tr>
  </thead>`;

function activityRowsHtml(activities: ActivityReportRow[]): string {
  return activities
    .map(
      (a) => `
    <tr>
      <td>${escapeHtml(a.date)}</td>
      <td>${escapeHtml(a.description)}</td>
      <td>${escapeHtml(a.hoursTypeLabel)}</td>
      <td>${a.hours} hrs</td>
    </tr>`,
    )
    .join('');
}

function subtotalRow(label: string, hours: number): string {
  return `
    <tr class="subtotal-row">
      <td colspan="3" style="font-weight:bold; background:#E6F1FB; color:#0C447C; padding:9px 12px;">
        Subtotal — ${escapeHtml(label)}
      </td>
      <td style="font-weight:bold; background:#E6F1FB; color:#0C447C; padding:9px 12px;">
        ${hours.toFixed(0)} hrs
      </td>
    </tr>`;
}

const EMPTY_ACTIVITY_ROW = `
    <tr>
      <td colspan="4" style="color:#888888; font-style:italic; padding:9px 12px;">
        No activities logged for this property in the selected period.
      </td>
    </tr>`;

function propertyActivityBlock(r: PropertyReportRow): string {
  const subtotalHours = r.activities.reduce((s, a) => s + a.hours, 0);
  const body = r.activities.length > 0 ? activityRowsHtml(r.activities) : EMPTY_ACTIVITY_ROW;
  return `
<div class="section-header">${escapeHtml(r.name)}</div>
<div class="summary-card">
  <div class="summary-row">
    <span class="summary-label">MP Test</span>
    <span class="summary-value">${escapeHtml(r.testLabel)}</span>
  </div>
  <div class="summary-row">
    <span class="summary-label">Target hours</span>
    <span class="summary-value">${r.threshold != null ? `${r.threshold} hrs` : '—'}</span>
  </div>
  <div class="summary-row">
    <span class="summary-label">Status</span>
    <span class="${rowStatusClass(r.status)}">${r.status}</span>
  </div>
</div>
<table>${ACTIVITY_TABLE_HEAD}
  <tbody>${body}${subtotalRow(r.name, subtotalHours)}
  </tbody>
</table>`;
}

function activityDetailSection(d: RealEstateReportData): string {
  const props = [...d.longTerm, ...d.shortTerm];
  const generalHours = d.generalActivities.reduce((s, a) => s + a.hours, 0);
  const generalBlock =
    d.generalActivities.length > 0
      ? `
<div class="section-header">General Real Estate Activities (Not Property-Specific)</div>
<table>${ACTIVITY_TABLE_HEAD}
  <tbody>${activityRowsHtml(d.generalActivities)}${subtotalRow('General Activities', generalHours)}
  </tbody>
</table>`
      : '';
  if (props.length === 0 && generalBlock === '') return '';
  return `
<div class="section-header" style="background:#042C53;">Activity Detail by Property</div>${props
    .map(propertyActivityBlock)
    .join('')}${generalBlock}`;
}

function overallSection(d: RealEstateReportData): string {
  const repsRow = d.repsPursuitActive
    ? (() => {
        const s = overallStatus(d.totalREHours, d.effectiveMin);
        return `
  <div class="summary-row">
    <span class="summary-label">REPS qualification status</span>
    <span class="${overallStatusClass(s)}">${s}</span>
  </div>`;
      })()
    : '';
  return `
<div class="section-header">
  Overall Compliance Summary
</div>
<div class="summary-card">
  <div class="summary-row">
    <span class="summary-label">Total RE hours all properties</span>
    <span class="summary-value">${d.grandTotalHours.toFixed(0)} hrs</span>
  </div>${repsRow}
  <div class="summary-row">
    <span class="summary-label">Properties meeting MP test</span>
    <span class="summary-value">${d.metCount} of ${d.totalCount}</span>
  </div>
  <div class="summary-row">
    <span class="summary-label">Report generated</span>
    <span class="summary-value">${escapeHtml(d.generatedDateTime)}</span>
  </div>
</div>`;
}

export function buildRealEstateReportHtml(d: RealEstateReportData): string {
  const client = escapeHtml(d.clientName);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    font-family: Arial, sans-serif;
    padding: 40px;
    color: #1A1A2E;
  }
  .header {
    background: #042C53;
    color: white;
    padding: 20px 24px;
    border-radius: 8px;
    margin-bottom: 24px;
  }
  .header h1 {
    font-size: 22px;
    margin: 0 0 6px 0;
  }
  .header p {
    font-size: 13px;
    margin: 2px 0;
    opacity: 0.85;
  }
  .section-header {
    background: #185FA5;
    color: white;
    padding: 10px 14px;
    border-radius: 4px 4px 0 0;
    font-size: 14px;
    font-weight: bold;
    margin-top: 20px;
  }
  .summary-card {
    background: #E6F1FB;
    border: 1px solid #185FA5;
    border-radius: 8px;
    padding: 14px 18px;
    margin-bottom: 16px;
  }
  .summary-card h3 {
    color: #042C53;
    font-size: 14px;
    margin: 0 0 8px 0;
  }
  .summary-row {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
    padding: 4px 0;
    border-bottom: 0.5px solid #CCCCCC;
  }
  .summary-row:last-child {
    border-bottom: none;
    font-weight: bold;
  }
  .summary-label { color: #555555; }
  .summary-value { color: #1A1A2E; font-weight: 500; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 0;
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
  }
  tr:nth-child(even) td {
    background: #F2F4F6;
  }
  .status-met {
    color: #0F6E56;
    font-weight: bold;
  }
  .status-not-met {
    color: #A32D2D;
    font-weight: bold;
  }
  .status-in-progress {
    color: #BA7517;
    font-weight: bold;
  }
  .total-row td {
    background: #042C53;
    color: white;
    font-weight: bold;
  }
  .footer {
    margin-top: 32px;
    font-size: 11px;
    color: #888888;
    border-top: 0.5px solid #CCCCCC;
    padding-top: 12px;
  }
</style>
</head>
<body>

<div class="header">
  <h1>Real Estate Compliance Report</h1>
  <p>${client}</p>
  <p>Tax Year: ${d.year}</p>
  <p>Generated: ${escapeHtml(d.generatedDate)}</p>
  <p>Strategy: ${escapeHtml(d.strategyLabel)}</p>
</div>
${repsSection(d)}
${longTermSection(d)}
${shortTermSection(d)}
${activityDetailSection(d)}
${overallSection(d)}
<div class="footer">
  This report was generated from contemporaneous records maintained in
  Compliance Co-Pilot and is intended as supporting documentation for tax
  preparation and IRS examination purposes.
  Client: ${client} | Tax Year: ${d.year} | Generated: ${escapeHtml(d.generatedDate)}
</div>

</body>
</html>`;
}

// Renders the HTML to a PDF via expo-print and presents the system share sheet.
export async function shareRealEstateReportPdf(html: string): Promise<void> {
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error('Sharing is not available on this device.');
  }
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: 'Real Estate Compliance Report',
    UTI: 'com.adobe.pdf',
  });
}

// One-call convenience used by the Generate Report buttons: gather → build →
// share. Throws on any failure so callers can surface an alert.
export async function generateRealEstateReport(
  params: GatherReportParams,
): Promise<void> {
  const data = await gatherRealEstateReportData(params);
  const html = buildRealEstateReportHtml(data);
  await shareRealEstateReportPdf(html);
}
