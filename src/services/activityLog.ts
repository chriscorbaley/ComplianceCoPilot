// Real Estate audit-ready activity log: querying hours_log joined to
// properties, grouping by property with subtotals, building the shareable
// export document, and auto-saving each logged activity into the documents
// table so it surfaces in the Documents screen.
//
// All threshold values (e.g. the REPS 750-hour gate) are read from
// compliance_rules at runtime via readThresholds — never hardcoded here.

import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { supabase } from './supabase';
import { hydrateLogo, LOGO_PLACEHOLDER } from './pdfDocuments';
import { loadComplianceRules } from './complianceRules';
import { readThresholds } from './realEstate';

// hours_log.hours_type enum (matches the hours_log_hours_type_check constraint).
export type ActivityHoursType =
  | 'reps_general'
  | 'material_participation'
  | 'str_participation';

const GENERAL_KEY = '__general__';
const GENERAL_LABEL = 'General / Administrative';

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// ── Date helpers ────────────────────────────────────────────────────────────

// Formats an activity date as "MMM DD YYYY" (e.g. "Nov 20 2025"). hours_log
// stores activity_date as a plain `date` column ("YYYY-MM-DD"); we parse the
// parts directly to avoid a timezone shift from `new Date('YYYY-MM-DD')`.
export function formatActivityDate(iso: string | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) {
    const year = Number(m[1]);
    const monthIdx = Number(m[2]) - 1;
    const day = Number(m[3]);
    if (monthIdx >= 0 && monthIdx < 12) {
      return `${MONTH_SHORT[monthIdx]} ${String(day).padStart(2, '0')} ${year}`;
    }
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${MONTH_SHORT[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')} ${d.getFullYear()}`;
}

// Local-time "YYYY-MM-DD" for a Date (used for the date-range bounds so the
// pickers and the query agree without a UTC offset surprise).
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

// hours_type when the row didn't record one: derive from the property type.
export function deriveHoursType(propertyType: string | null): ActivityHoursType {
  if (!propertyType) return 'reps_general';
  return propertyType === 'short_term' ? 'str_participation' : 'material_participation';
}

// ── Part 1: auto-save a document per logged activity ─────────────────────────

export interface SaveActivityDocumentInput {
  userId: string;
  businessId: string | null;
  propertyName: string;
  activityDate: string | null;
  description: string;
  hours: number;
  hoursType: string | null;
}

// Inserts an `activity_log` document mirroring a freshly-logged hours entry so
// it appears in the Documents screen under the Real Estate filter. created_at
// is left to the DB default (now()).
export async function saveActivityDocument(
  input: SaveActivityDocumentInput,
): Promise<void> {
  const dateLabel = formatActivityDate(input.activityDate);
  const activityType = input.description.trim() || 'Activity';
  const namePieces = [input.propertyName, activityType, dateLabel].filter(Boolean);
  const name = namePieces.join(' — ');

  const fileUrl = [
    `Property: ${input.propertyName}`,
    `Date: ${input.activityDate ?? ''}`,
    `Activity: ${input.description}`,
    `Hours: ${input.hours}`,
    `Hours Type: ${input.hoursType ?? ''}`,
    `Logged: ${new Date().toISOString()}`,
  ].join('\n');

  const { error } = await supabase.from('documents').insert({
    user_id: input.userId,
    business_id: input.businessId,
    name,
    strategy_category: 'real_estate',
    file_url: fileUrl,
    file_type: 'activity_log',
  });
  if (error) throw new Error(error.message);
}

// ── Part 2: query + grouping ─────────────────────────────────────────────────

export interface ActivityLogEntry {
  id: string;
  activityDate: string | null;
  description: string;
  hours: number;
  hoursType: string | null;
  propertyId: string | null;
  propertyName: string;
  propertyType: string | null;
}

export interface PropertyGroup {
  key: string;
  propertyId: string | null;
  propertyName: string;
  entries: ActivityLogEntry[];
  subtotalHours: number;
}

export interface GroupedActivityLog {
  groups: PropertyGroup[];
  grandTotalHours: number;
}

interface FetchParams {
  userId: string;
  businessId: string | null;
  fromDate: string; // 'YYYY-MM-DD'
  toDate: string; // 'YYYY-MM-DD'
}

// Supabase embeds a to-one foreign relationship as an object, but defensive
// callers see an array in some PostgREST versions — normalize both.
function embeddedProperty(
  raw: unknown,
): { property_name?: string | null; property_type?: string | null } | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw as { property_name?: string | null; property_type?: string | null };
}

// Runs the hours_log ⋈ properties query for the given user and date range,
// returning entries sorted by property name (asc) then activity date (desc).
export async function fetchActivityLog(params: FetchParams): Promise<ActivityLogEntry[]> {
  let query = supabase
    .from('hours_log')
    .select(
      'id, activity_date, description, hours, hours_type, property_id, properties (property_name, property_type)',
    )
    .eq('user_id', params.userId)
    .gte('activity_date', params.fromDate)
    .lte('activity_date', params.toDate);
  if (params.businessId) query = query.eq('business_id', params.businessId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const entries: ActivityLogEntry[] = (data ?? []).map((r: Record<string, unknown>) => {
    const prop = embeddedProperty(r.properties);
    return {
      id: String(r.id),
      activityDate: (r.activity_date as string | null) ?? null,
      description: (r.description as string | null) ?? '',
      hours: Number(r.hours) || 0,
      hoursType: (r.hours_type as string | null) ?? null,
      propertyId: (r.property_id as string | null) ?? null,
      propertyName: prop?.property_name ?? GENERAL_LABEL,
      propertyType: prop?.property_type ?? null,
    };
  });

  entries.sort((a, b) => {
    const byName = a.propertyName.localeCompare(b.propertyName);
    if (byName !== 0) return byName;
    return (b.activityDate ?? '').localeCompare(a.activityDate ?? '');
  });
  return entries;
}

// Groups entries by property (null property → General / Administrative),
// computing per-property subtotals and the grand total across all properties.
export function groupByProperty(entries: ActivityLogEntry[]): GroupedActivityLog {
  const map = new Map<string, PropertyGroup>();
  for (const e of entries) {
    const key = e.propertyId ?? GENERAL_KEY;
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        propertyId: e.propertyId,
        propertyName: e.propertyName,
        entries: [],
        subtotalHours: 0,
      };
      map.set(key, group);
    }
    group.entries.push(e);
    group.subtotalHours += e.hours;
  }
  const groups = Array.from(map.values()).sort((a, b) =>
    a.propertyName.localeCompare(b.propertyName),
  );
  for (const g of groups) {
    g.entries.sort((a, b) => (b.activityDate ?? '').localeCompare(a.activityDate ?? ''));
  }
  const grandTotalHours = groups.reduce((sum, g) => sum + g.subtotalHours, 0);
  return { groups, grandTotalHours };
}

// ── Thresholds + status ───────────────────────────────────────────────────

// Reads the REPS gate-1 hour requirement (750 by default) from compliance_rules.
export async function getRepsThreshold(): Promise<number> {
  const rules = await loadComplianceRules();
  return readThresholds(rules.rawDb).reps_gate1_hours;
}

export type RepsStatus = 'On Track' | 'Needs Attention' | 'Qualified';

function yearFractionElapsed(year: number, now: Date): number {
  // A prior tax year is fully elapsed; the current year uses the actual pace.
  if (now.getFullYear() > year) return 1;
  if (now.getFullYear() < year) return 0;
  const start = new Date(year, 0, 1).getTime();
  const end = new Date(year + 1, 0, 1).getTime();
  return Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
}

// Audit status for the REPS hour threshold. Qualified once the threshold is
// met; otherwise On Track if hours keep pace with the elapsed year, else Needs
// Attention.
export function repsStatus(
  totalHours: number,
  threshold: number,
  year: number,
  now: Date = new Date(),
): RepsStatus {
  if (threshold > 0 && totalHours >= threshold) return 'Qualified';
  const elapsed = yearFractionElapsed(year, now);
  if (elapsed <= 0) return 'On Track';
  const expected = threshold * elapsed;
  return totalHours >= expected ? 'On Track' : 'Needs Attention';
}

// ── Part 3: export as a formatted PDF + share ────────────────────────────────

export interface BuildExportParams {
  clientName: string;
  year: number;
  generatedDate: string; // human-readable "today"
  grouped: GroupedActivityLog;
  threshold: number;
}

// Readable label per hours_type. Falls back to a title-cased version of any
// unknown value so a future enum addition still renders sensibly.
const HOURS_TYPE_LABEL: Record<string, string> = {
  reps_general: 'REPS — General',
  material_participation: 'Material Participation',
  str_participation: 'Short-Term Rental',
};

function formatHoursType(t: string | null): string {
  if (!t) return '—';
  if (HOURS_TYPE_LABEL[t]) return HOURS_TYPE_LABEL[t];
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// HTML-escape any user-entered text before interpolating it into the template
// so a stray "&", "<", or quote in a description can't corrupt the markup.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Builds the full HTML document for the auditor export. expo-print renders this
// to a real PDF, so the table cells wrap instead of truncating like the old
// fixed-width text export did.
export function buildExportHtml(params: BuildExportParams): string {
  const { clientName, year, generatedDate, grouped, threshold } = params;
  const client = escapeHtml(clientName || 'Client');
  const status = repsStatus(grouped.grandTotalHours, threshold, year);
  const statusClass =
    status === 'Needs Attention' ? 'status-needs-attention' : 'status-on-track';

  const propertyBlocks =
    grouped.groups.length === 0
      ? '<p style="color:#888888;font-size:13px;">No activities recorded for this tax year.</p>'
      : grouped.groups
          .map((group) => {
            const name = escapeHtml(group.propertyName);
            const rows = group.entries
              .map(
                (e) => `
      <tr>
        <td>${escapeHtml(formatActivityDate(e.activityDate))}</td>
        <td>${escapeHtml(e.description || '—')}</td>
        <td>${escapeHtml(formatHoursType(e.hoursType))}</td>
        <td>${e.hours.toFixed(1)}</td>
      </tr>`,
              )
              .join('');
            return `
  <div class="property-header">${name}</div>
  <table>
    <thead>
      <tr>
        <th style="width:18%">Date</th>
        <th style="width:46%">Activity</th>
        <th style="width:18%">Type</th>
        <th style="width:18%">Hours</th>
      </tr>
    </thead>
    <tbody>${rows}
      <tr class="subtotal-row">
        <td colspan="3">Subtotal — ${name}</td>
        <td>${group.subtotalHours.toFixed(1)}</td>
      </tr>
    </tbody>
  </table>`;
          })
          .join('');

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
  .header h1 {
    font-size: 20px;
    margin: 0 0 4px 0;
  }
  .header p {
    font-size: 13px;
    margin: 2px 0;
    opacity: 0.8;
  }
  .property-header {
    background: #E6F1FB;
    color: #185FA5;
    font-weight: bold;
    font-size: 14px;
    padding: 10px 12px;
    margin-top: 20px;
    border-radius: 4px 4px 0 0;
  }
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
    vertical-align: top;
    word-wrap: break-word;
  }
  tr:nth-child(even) td {
    background: #F2F4F6;
  }
  .subtotal-row td {
    background: #E6F1FB;
    color: #0C447C;
    font-weight: bold;
    font-size: 12px;
  }
  .grand-total {
    background: #042C53;
    color: white;
    padding: 12px 16px;
    margin-top: 20px;
    border-radius: 4px;
    display: flex;
    justify-content: space-between;
    font-size: 14px;
    font-weight: bold;
  }
  .status-bar {
    padding: 10px 16px;
    border-radius: 4px;
    margin-top: 12px;
    font-size: 13px;
    font-weight: bold;
  }
  .status-on-track {
    background: #E1F5EE;
    color: #0F6E56;
  }
  .status-needs-attention {
    background: #FAEEDA;
    color: #BA7517;
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
    <img class="brandLogo" src="${LOGO_PLACEHOLDER}" />
    <div class="headerText">
      <h1>Real Estate Activity Log</h1>
      <p>${client}</p>
      <p>Tax Year: ${year}</p>
      <p>Generated: ${escapeHtml(generatedDate)}</p>
    </div>
  </div>
${propertyBlocks}
  <div class="grand-total">
    <span>Total Hours All Properties</span>
    <span>${grouped.grandTotalHours.toFixed(1)}</span>
  </div>

  <div class="status-bar ${statusClass}">
    REPS Status: ${grouped.grandTotalHours.toFixed(1)} of ${threshold} hours logged — ${status}
  </div>

  <div class="footer">
    This document was generated from contemporaneous records maintained in
    Compliance Co-Pilot and is intended as supporting documentation for IRS
    examination or audit purposes.
    Client: ${client} | Generated: ${escapeHtml(generatedDate)}
  </div>
</body>
</html>`;
}

// Renders the HTML to a PDF via expo-print and presents the system share sheet.
export async function shareActivityLogPdf(html: string): Promise<void> {
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error('Sharing is not available on this device.');
  }
  // Inline the (business or brand) logo before printing — expo-print can't fetch
  // a remote image at render time.
  const hydrated = await hydrateLogo(html);
  const { uri } = await Print.printToFileAsync({ html: hydrated, base64: false });
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: 'Export Activity Log',
    UTI: 'com.adobe.pdf',
  });
}
