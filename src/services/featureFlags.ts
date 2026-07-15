// Global feature flags live in the Supabase `feature_flags` table so entire
// features can be switched on/off firm-wide from the Admin panel without
// shipping a new build. This is a SEPARATE layer from subscription-tier gating:
// a feature shows only when it is BOTH enabled by its flag AND allowed by the
// user's tier. Flags never override tier gating — they only add a global switch.
//
// IMPORTANT (fail-open): every flag defaults to ENABLED. If the table read ever
// fails (offline, RLS, cold start) or a flag row is missing, the feature stays
// visible. A fetch failure must never hide a feature the user has paid for.

import { supabase } from './supabase';

// The ten flags seeded in the feature_flags table. `flag_key` is the stable
// identity; keep these in sync with the DB rows.
export type FeatureFlagKey =
  | 'mileage_tracker'
  | 'business_travel'
  | 'voice_features'
  | 'cancellation_signature'
  | 'document_retention_warnings'
  | 'augusta_rule'
  | 's_corp'
  | 'home_office'
  | 'family_management'
  | 'real_estate';

export const FEATURE_FLAG_KEYS: FeatureFlagKey[] = [
  'mileage_tracker',
  'business_travel',
  'voice_features',
  'cancellation_signature',
  'document_retention_warnings',
  'augusta_rule',
  's_corp',
  'home_office',
  'family_management',
  'real_estate',
];

// Human-friendly names used in the admin confirmation dialog and as a fallback
// label when a row has no description.
export const FEATURE_FLAG_LABELS: Record<FeatureFlagKey, string> = {
  mileage_tracker: 'Mileage Tracker',
  business_travel: 'Business Travel',
  voice_features: 'Voice Features',
  cancellation_signature: 'Cancellation Signature',
  document_retention_warnings: 'Document Retention Warnings',
  augusta_rule: 'Augusta Rule',
  s_corp: 'S-Corp',
  home_office: 'Home Office',
  family_management: 'Family Management',
  real_estate: 'Real Estate',
};

// App Store review mode. This is an OPERATIONAL flag, deliberately kept OUT of
// FEATURE_FLAG_KEYS above so it is NOT part of the fail-open default map. Every
// entry in FEATURE_FLAG_KEYS defaults to ENABLED (a read failure must never
// hide a paid feature); review_mode is the inverse — it must FAIL CLOSED. It
// counts as on ONLY when its feature_flags row is explicitly is_enabled = true,
// because turning it on bypasses live billing and unlocks every feature for
// ALL users. It must never switch on by accident (missing row, failed read, no
// provider). Read it exclusively through useReviewMode(), never useFeatureFlag.
export const REVIEW_MODE_FLAG_KEY = 'review_mode';
export const REVIEW_MODE_LABEL = 'Review Mode';

export interface FeatureFlagRow {
  flag_key: string;
  description: string | null;
  is_enabled: boolean;
  updated_at?: string | null;
}

// A flag map: flag_key → enabled. Missing keys are treated as enabled by the
// context, so this map only needs to carry whatever the DB returned.
export type FeatureFlagMap = Record<string, boolean>;

// Every flag enabled — the shipped fail-open baseline the context starts with.
export function defaultFeatureFlagMap(): FeatureFlagMap {
  const map: FeatureFlagMap = {};
  for (const key of FEATURE_FLAG_KEYS) map[key] = true;
  return map;
}

// Friendly name for a flag key, for user-facing copy.
export function featureFlagLabel(flagKey: string): string {
  return (
    FEATURE_FLAG_LABELS[flagKey as FeatureFlagKey] ??
    flagKey
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  );
}

// ── Reads ───────────────────────────────────────────────────────────────────

// Fetch every flag as a { flag_key: is_enabled } map for the client context.
// Returns an empty map on any error so the caller keeps its fail-open defaults
// (every flag stays enabled).
export async function fetchFeatureFlagMap(): Promise<FeatureFlagMap> {
  try {
    const { data, error } = await supabase
      .from('feature_flags')
      .select('flag_key, is_enabled');
    if (error || !data) return {};
    const map: FeatureFlagMap = {};
    for (const row of data as { flag_key: string; is_enabled: boolean }[]) {
      // Only an explicit `false` disables a feature. Anything else (true, null,
      // undefined) leaves it enabled — fail open.
      map[row.flag_key] = row.is_enabled !== false;
    }
    return map;
  } catch {
    return {};
  }
}

// Fetch full rows (key + description + state) for the Admin editor.
export async function fetchAllFeatureFlags(): Promise<FeatureFlagRow[]> {
  const { data, error } = await supabase
    .from('feature_flags')
    .select('*')
    .order('flag_key', { ascending: true });
  if (error) throw error;
  return ((data as Record<string, unknown>[]) ?? []).map((row) => ({
    flag_key: String(row.flag_key),
    description:
      typeof row.description === 'string' ? row.description : null,
    is_enabled: row.is_enabled !== false,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
  }));
}

// ── Admin write ───────────────────────────────────────────────────────────────

// Flip a flag and best-effort append an admin_audit_log entry. The audit insert
// is wrapped so a missing table never blocks the flag change itself (mirrors
// updatePricingPlan).
export async function updateFeatureFlag(
  flagKey: string,
  isEnabled: boolean,
  adminUserId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('feature_flags')
    .update({ is_enabled: isEnabled })
    .eq('flag_key', flagKey);
  if (error) throw error;

  try {
    await supabase.from('admin_audit_log').insert({
      admin_id: adminUserId,
      action: 'update_feature_flag',
      table_name: 'feature_flags',
      record_key: flagKey,
      details: { is_enabled: isEnabled },
    });
  } catch {
    /* admin_audit_log may not exist — flag update already succeeded */
  }
}
