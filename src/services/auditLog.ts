// Admin audit trail. Every admin write in the app records a row here so the
// Admin Panel's Audit Log tab can show who changed what, when, and how.
//
// The table lives in Supabase with columns:
//   admin_email, action, table_affected, record_key, old_value, new_value,
//   created_at (default now()). RLS allows admin read + admin insert only.
//
// The write path (`logAdminAction`) is INTENTIONALLY best-effort: it swallows
// every error and only warns to the console. An audit insert must never block
// or break the admin action it is describing — if logging fails, the change the
// admin just made still succeeds. The read path (`fetchAuditLog`) is used by the
// read-only viewer and paginates so the list stays fast.
import { supabase } from './supabase';

// A single audit row as returned to the viewer. old_value / new_value are stored
// as JSON (jsonb) so they can hold a scalar, a before/after object, or null.
// `id` is optional: the viewer never relies on it (it may not be part of the
// table's column set) and falls back to created_at for list keys.
export interface AuditLogEntry {
  id?: string;
  admin_email: string | null;
  action: string;
  table_affected: string | null;
  record_key: string | null;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
}

export interface AuditLogFilters {
  adminEmail?: string | null;
  tableAffected?: string | null;
  // ISO date-time strings (inclusive lower / upper bounds).
  from?: string | null;
  to?: string | null;
}

export interface LogAdminActionParams {
  action: string;
  tableAffected: string;
  recordKey: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  // The acting admin's email. When omitted it is resolved from the current
  // Supabase session so inline callers don't have to thread it through.
  adminEmail?: string | null;
}

// Resolve the signed-in admin's email from the active session. Best-effort:
// returns null on any failure so it never throws inside the audit path.
async function resolveAdminEmail(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user.email ?? null;
  } catch {
    return null;
  }
}

// Record an admin action. Never throws — on any failure it warns and resolves,
// so the caller's real write is unaffected. Callers should `await` it (so the
// row is written before a realtime refresh), but a rejected promise is
// impossible by design.
export async function logAdminAction(params: LogAdminActionParams): Promise<void> {
  try {
    const adminEmail =
      params.adminEmail !== undefined ? params.adminEmail : await resolveAdminEmail();
    const { error } = await supabase.from('admin_audit_log').insert({
      admin_email: adminEmail,
      action: params.action,
      table_affected: params.tableAffected,
      record_key: params.recordKey,
      old_value: params.oldValue ?? null,
      new_value: params.newValue ?? null,
    });
    if (error) throw error;
  } catch (err) {
    // Table absent, RLS denial, offline, schema drift — none of these should
    // ever surface to the admin or block the change they just made.
    console.warn('[auditLog] failed to record admin action:', params.action, err);
  }
}

const PAGE_SIZE = 100;

export interface AuditLogPage {
  entries: AuditLogEntry[];
  // True when more rows exist beyond this page (drives the "Load more" button).
  hasMore: boolean;
}

// Fetch one page of audit entries, newest first, applying the given filters.
// `offset` is the number of rows already loaded. Returns up to PAGE_SIZE rows.
export async function fetchAuditLog(
  filters: AuditLogFilters = {},
  offset = 0,
  pageSize = PAGE_SIZE,
): Promise<AuditLogPage> {
  // Select '*' rather than an explicit column list so the query still works
  // regardless of whether the table has a surrogate `id` column.
  let query = supabase
    .from('admin_audit_log')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters.adminEmail) query = query.eq('admin_email', filters.adminEmail);
  if (filters.tableAffected) query = query.eq('table_affected', filters.tableAffected);
  if (filters.from) query = query.gte('created_at', filters.from);
  if (filters.to) query = query.lte('created_at', filters.to);

  // Fetch one extra row to cheaply detect whether more pages exist.
  const { data, error } = await query.range(offset, offset + pageSize);
  if (error) throw error;

  const rows = (data ?? []) as AuditLogEntry[];
  const hasMore = rows.length > pageSize;
  return { entries: hasMore ? rows.slice(0, pageSize) : rows, hasMore };
}

// Distinct admin emails and affected tables for the filter dropdowns. Derived
// from recent rows (capped) rather than a true DISTINCT, which is plenty for a
// per-firm admin log and keeps it to a single lightweight query.
export async function fetchAuditFilterOptions(): Promise<{
  admins: string[];
  tables: string[];
}> {
  const { data, error } = await supabase
    .from('admin_audit_log')
    .select('admin_email, table_affected')
    .order('created_at', { ascending: false })
    .limit(1000);
  if (error) throw error;

  const admins = new Set<string>();
  const tables = new Set<string>();
  for (const row of (data ?? []) as { admin_email: string | null; table_affected: string | null }[]) {
    if (row.admin_email) admins.add(row.admin_email);
    if (row.table_affected) tables.add(row.table_affected);
  }
  return {
    admins: Array.from(admins).sort(),
    tables: Array.from(tables).sort(),
  };
}
