// Document-retention policy (Feature 4).
//
// Policy: keep the current tax year + 3 prior years. Documents older than that
// window are eligible for deletion on February 1 of the year after the window
// closes. Example: in 2026 we keep 2026/2025/2024/2023; 2022-and-earlier docs
// are purged on February 1, 2026.
//
// Warning window: October 1 (Q4) through February 1 (deletion date). This module
// computes whether a warning is currently active, its urgency, and how many
// documents are affected so the banner and push reminders can render.

import { supabase, type DocumentRow } from './supabase';

export type RetentionUrgency = 'early' | 'urgent';

export interface RetentionWarning {
  // Tax year of the documents approaching deletion.
  docYear: number;
  // The February 1 deletion date and its display label.
  deletionDate: Date;
  deletionDateLabel: string;
  deletionYear: number;
  daysRemaining: number;
  urgency: RetentionUrgency;
  // Whether the banner may be dismissed (never in the final two weeks).
  canDismiss: boolean;
  // How many documents fall in the affected window (that year or older).
  docCount: number;
}

const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAY_MS = 24 * 60 * 60 * 1000;

// The active warning window for `now`, or null when outside Oct 1 – Feb 1.
export function retentionWindow(
  now: Date,
): { docYear: number; deletionDate: Date; urgency: RetentionUrgency } | null {
  const y = now.getFullYear();
  const m = now.getMonth(); // 0 = Jan
  // Oct–Dec: warn about docs from (y-3); deletion Feb 1 of next year.
  if (m >= 9) {
    return { docYear: y - 3, deletionDate: new Date(y + 1, 1, 1), urgency: 'early' };
  }
  // Jan 1 – Feb 1: warn about docs from (y-4); deletion Feb 1 this year.
  if (m === 0 || (m === 1 && now.getDate() <= 1)) {
    return { docYear: y - 4, deletionDate: new Date(y, 1, 1), urgency: 'urgent' };
  }
  return null;
}

const startOfDay = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

// Computes the current retention warning for the signed-in user's documents, or
// null when there's no active window or no affected documents.
export async function getRetentionWarning(
  businessId: string | null,
  now: Date = new Date(),
): Promise<RetentionWarning | null> {
  const win = retentionWindow(now);
  if (!win) return null;

  // Count documents created in the affected year or earlier.
  let q = supabase
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .lte('created_at', `${win.docYear}-12-31T23:59:59`);
  if (businessId) q = q.eq('business_id', businessId);
  const { count, error } = await q;
  if (error || !count) return null;

  const daysRemaining = Math.max(
    0,
    Math.ceil((win.deletionDate.getTime() - startOfDay(now).getTime()) / DAY_MS),
  );
  const canDismiss = win.urgency === 'early' ? true : daysRemaining > 14;

  return {
    docYear: win.docYear,
    deletionDate: win.deletionDate,
    deletionYear: win.deletionDate.getFullYear(),
    deletionDateLabel: `${MONTH_FULL[win.deletionDate.getMonth()]} 1, ${win.deletionDate.getFullYear()}`,
    daysRemaining,
    urgency: win.urgency,
    canDismiss,
    docCount: count,
  };
}

// The documents eligible for deletion in the warned window (that year or older),
// newest first — used by the "Download All" action.
export async function listExpiringDocuments(
  businessId: string | null,
  docYear: number,
): Promise<DocumentRow[]> {
  let q = supabase
    .from('documents')
    .select('*')
    .lte('created_at', `${docYear}-12-31T23:59:59`)
    .order('created_at', { ascending: false });
  if (businessId) q = q.eq('business_id', businessId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as DocumentRow[];
}

// Notification copy for the current warning.
export function retentionNotificationText(w: RetentionWarning): {
  title: string;
  body: string;
} {
  if (w.urgency === 'urgent') {
    return {
      title: '⚠️ Final warning',
      body: `${w.docYear} documents deleted in ${w.daysRemaining} days. Open CCP to download.`,
    };
  }
  return {
    title: 'CCP Reminder',
    body: `Your ${w.docYear} compliance documents will be deleted ${w.deletionDateLabel}. Download them now.`,
  };
}
