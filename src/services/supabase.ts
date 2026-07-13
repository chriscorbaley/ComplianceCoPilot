// Single Supabase client for the app. Sessions persist in AsyncStorage so the
// user stays signed in across launches.

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type Session } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anon) {
  throw new Error(
    'EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY must be set in .env',
  );
}

export type DayLogJson = Array<{
  date: string;
  type: 'business' | 'travel' | 'personal';
  description: string;
}>;

// Day-by-day schedule persisted with a business trip (Fix 2). Each day carries
// its designation; the derived night counts drive lodging deductibility under
// the IRS rule (a night is deductible when the following day is a business or
// travel day, not deductible when the following day is personal).
export interface DayScheduleJson {
  days: Array<{ date: string; type: 'business' | 'travel' | 'personal' }>;
  deductible_nights: number;
  total_nights: number;
}

export type SubscriptionTier = 'starter' | 'core' | 'pro';
export type SubscriptionStatus = 'trial' | 'active' | 'cancelled';

// Real estate v2 portfolio + material-participation enums. re_property_type
// is the user-level portfolio shape captured in onboarding; default_mp_test is
// the integer MP-test code (1, 3, or 5) applied to new properties by default.
export type RePropertyType = 'long_term' | 'short_term' | 'both';

// Material-participation test key used throughout the app. Persisted to
// properties.mp_test_selected as an integer code (see properties.MP_TEST_INT).
export type MpTestKey =
  | 'test_1'
  | 'test_2'
  | 'test_3'
  | 'test_4'
  | 'test_5'
  | 'test_7';

// Participation bucket recorded on each hours_log row.
export type HoursType =
  | 'reps_general'
  | 'material_participation'
  | 'str_participation';

export interface UserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  active_strategies: string[] | null;
  is_admin: boolean;
  created_at: string;
  subscription_tier: SubscriptionTier | null;
  subscription_status: SubscriptionStatus | null;
  subscription_start: string | null;
  onboarding_completed: boolean;
  re_grouping_election: boolean | null;
  // Real estate v2 onboarding state.
  re_has_properties: boolean | null;
  re_property_type: RePropertyType | null;
  default_mp_test: number | null;
  reps_pursuit_active: boolean | null;
  total_work_hours_this_year: number | null;
}

export interface TosAcceptanceRow {
  id: string;
  user_id: string;
  accepted_at: string;
  tos_version: string;
}

export interface PrivacyAcceptanceRow {
  id: string;
  user_id: string;
  accepted_at: string;
  policy_version: string;
}

export type EntityType = 'LLC' | 'S-Corp' | 'C-Corp' | 'Sole Proprietor' | 'Trust';

export interface BusinessRow {
  id: string;
  user_id: string;
  business_name: string;
  entity_type: EntityType | null;
  ein: string | null;
  address: string | null;
  logo_url: string | null;
  is_default: boolean;
  created_at: string;
}

export type BusinessInsert = Omit<BusinessRow, 'id' | 'created_at' | 'is_default'> & {
  id?: string;
  created_at?: string;
  is_default?: boolean;
};

// v2 enum, matching the properties_property_type_check constraint in
// schema.sql. (v1 used 'residential' | 'commercial' | 'STR' | 'land'.)
export type PropertyType = 'long_term' | 'short_term';

export interface PropertyRow {
  id: string;
  user_id: string;
  business_id: string | null;
  property_name: string;
  property_type: PropertyType | null;
  has_grouping_election: boolean;
  // v2 per-property mirror of users.re_grouping_election. This is the column
  // the manage-properties toggle reads and writes; has_grouping_election is
  // the legacy v1 column still read by computeParticipation.
  grouping_election: boolean;
  grouping_group_name: string | null;
  // Integer MP-test code (1–5, 7) selected for this property. Mapped to/from
  // the MpTestKey string form at the boundary via properties.MP_TEST_INT.
  mp_test_selected: number | null;
  created_at: string;
}

export type PropertyInsert = Omit<PropertyRow, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export interface HoursLogRow {
  id: string;
  user_id: string;
  business_id: string | null;
  property_id: string | null;
  description: string | null;
  category: string | null;
  hours: number | null;
  activity_date: string | null;
  // Participation bucket recorded on each row (reps_general /
  // material_participation / str_participation). Surfaced in the audit export
  // and editable from the Hours activity log.
  hours_type: string | null;
  created_at: string;
}

export interface HoursLogInsert {
  user_id: string;
  business_id?: string | null;
  property_id?: string | null;
  description?: string | null;
  category?: string | null;
  hours?: number | null;
  activity_date?: string | null;
}

export interface BusinessTripRow {
  id: string;
  user_id: string;
  business_id: string | null;
  trip_type: 'domestic' | 'international' | null;
  destination: string | null;
  countries_visited: string[] | null;
  purpose: string | null;
  departure_date: string | null;
  return_date: string | null;
  total_days: number | null;
  business_days: number | null;
  personal_days: number | null;
  business_day_pct: number | null;
  transport_deduct_pct: number | null;
  day_by_day_log: DayLogJson | null;
  day_schedule: DayScheduleJson | null;
  itinerary_transcript: string | null;
  compliance_verdict: string | null;
  compliance_notes: string | null;
  expenses_transport: number | null;
  expenses_lodging: number | null;
  expenses_meals: number | null;
  expenses_other: number | null;
  status: string | null;
  created_at: string;
}

export type BusinessTripInsert = Omit<BusinessTripRow, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

// ── Mileage Tracker (Pro) ────────────────────────────────────────────────
export interface VehicleRow {
  id: string;
  user_id: string;
  business_id: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  nickname: string | null;
  is_active: boolean;
  created_at: string;
}

export type VehicleInsert = Omit<VehicleRow, 'id' | 'created_at' | 'is_active'> & {
  id?: string;
  created_at?: string;
  is_active?: boolean;
};

export type MileageTripType = 'business' | 'medical';

export interface MileageLogRow {
  id: string;
  user_id: string;
  business_id: string | null;
  vehicle_id: string | null;
  trip_date: string | null;
  start_odometer: number | null;
  end_odometer: number | null;
  total_miles: number | null;
  trip_type: MileageTripType | null;
  purpose: string | null;
  tax_year: number | null;
  deduction_amount: number | null;
  created_at: string;
}

export type MileageLogInsert = Omit<MileageLogRow, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export interface MeetingMinutesRow {
  id: string;
  user_id: string;
  business_id: string | null;
  meeting_type: string | null;
  location: string | null;
  meeting_date: string | null;
  transcript: string | null;
  minutes_document: string | null;
  attendee_count: number | null;
  status: 'complete' | 'draft' | null;
  created_at: string;
}

export type MeetingMinutesInsert = Omit<MeetingMinutesRow, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export interface DocumentRow {
  id: string;
  user_id: string;
  business_id: string | null;
  name: string | null;
  strategy_category: string | null;
  file_url: string | null;
  file_type: string | null;
  created_at: string;
}

export type DocumentInsert = Omit<DocumentRow, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export interface ComplianceRuleRow {
  id: string;
  strategy_name: string;
  rule_key: string;
  rule_value: string;
  display_label: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface RegulatoryAlertRow {
  id: string;
  source: 'IRS' | 'TaxCourt' | 'Congress' | null;
  document_title: string | null;
  document_url: string | null;
  published_date: string | null;
  affected_strategies: string[] | null;
  ai_summary: string | null;
  affected_rule_keys: string[] | null;
  suggested_values: Record<string, unknown> | null;
  status: 'pending_review' | 'approved' | 'dismissed' | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface StrategyRow {
  id: string;
  display_name: string;
  enabled: boolean;
  sort_order: number;
  updated_at: string;
}

export interface DocumentTemplateRow {
  id: string;
  strategy_name: string;
  template_key: string;
  display_label: string | null;
  template_content: string;
  updated_at: string;
  updated_by: string | null;
}

export interface FormFieldRow {
  id: string;
  strategy_name: string;
  field_key: string;
  field_label: string;
  field_type: string;
  required: boolean;
  sort_order: number;
  updated_at: string;
}

export interface IrcReferenceRow {
  id: string;
  strategy_name: string;
  irc_section: string;
  citation: string;
  display_label: string | null;
  updated_at: string;
}

export interface AnnouncementRow {
  id: string;
  message: string;
  published_at: string;
  expires_at: string | null;
  published_by: string | null;
}

export interface CancellationRow {
  id: string;
  user_id: string;
  cancelled_at: string;
  deletion_scheduled_for: string;
  signature_1_url: string;
  signature_2_url: string;
  document_count_at_cancellation: number;
  stripe_subscription_id: string | null;
  is_deleted: boolean;
  deleted_at: string | null;
}

export type CancellationInsert = Omit<CancellationRow, 'id' | 'cancelled_at' | 'is_deleted' | 'deleted_at'> & {
  id?: string;
  cancelled_at?: string;
  is_deleted?: boolean;
  deleted_at?: string | null;
};

// We don't pass a typed Database<> generic to createClient because the
// PostgREST type machinery (v2.x) silently collapses to `never` when a
// hand-written interface doesn't exactly match its `Record<string, unknown>`-
// based GenericTable constraint. Row shapes are enforced at call sites via
// `as XRow` casts and the typed Insert helpers below.
export const supabase = createClient(url, anon, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function requireUserId(): Promise<string> {
  const id = await getCurrentUserId();
  if (!id) throw new Error('Not signed in');
  return id;
}

export type { Session };
