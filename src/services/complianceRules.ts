// Loads and live-syncs IRS deductibility rules from Supabase. Rows live in
// public.compliance_rules and have a generic (strategy_name, rule_key,
// rule_value) shape; this module projects them into a typed ComplianceRules
// snapshot that the deductibility engine and IRS Rules sub-tab consume.

import { supabase, type ComplianceRuleRow } from './supabase';

// ── Legacy display shape (still used by the IRS Rules sub-tab) ──────────────

export type RuleKey =
  | 'domestic_business_day_threshold'
  | 'international_short_trip_max_days'
  | 'international_personal_day_threshold'
  | 'travel_days_count_as_business'
  | 'meals_deduction_pct';

export interface ComplianceRule {
  key: RuleKey;
  jurisdiction: 'domestic' | 'international' | 'shared';
  code_section: 'IRC §162' | 'IRC §274(c)' | 'IRC §274(n)';
  numeric_value: number;
  title: string;
  body: string;
  updated_at: string;
}

export interface ComplianceRules {
  domesticBusinessDayThreshold: number;
  internationalShortTripMaxDays: number;
  internationalPersonalDayThreshold: number;
  travelDaysCountAsBusiness: boolean;
  mealsDeductionPct: number;
  // Full row list (display shape) for the IRS Rules sub-tab.
  raw: ComplianceRule[];
  // All raw Supabase rows, for callers that need the generic table.
  rawDb: ComplianceRuleRow[];
  loadedAt: number;
}

// ── Mapping: generic DB rows → typed engine snapshot ────────────────────────

const findRow = (
  rows: ComplianceRuleRow[],
  strategy: string,
  key: string,
): ComplianceRuleRow | undefined =>
  rows.find((r) => r.strategy_name === strategy && r.rule_key === key);

const numberFromRow = (
  rows: ComplianceRuleRow[],
  strategy: string,
  key: string,
  fallback: number,
): { value: number; row?: ComplianceRuleRow } => {
  const row = findRow(rows, strategy, key);
  if (!row) return { value: fallback };
  const n = parseFloat(row.rule_value);
  return Number.isFinite(n) ? { value: n, row } : { value: fallback, row };
};

const boolFromRow = (
  rows: ComplianceRuleRow[],
  strategy: string,
  key: string,
  fallback: boolean,
): { value: boolean; row?: ComplianceRuleRow } => {
  const row = findRow(rows, strategy, key);
  if (!row) return { value: fallback };
  const v = row.rule_value.trim().toLowerCase();
  return { value: v === 'true' || v === '1' || v === 'yes', row };
};

const buildDisplayRule = (
  row: ComplianceRuleRow | undefined,
  key: RuleKey,
  jurisdiction: ComplianceRule['jurisdiction'],
  code_section: ComplianceRule['code_section'],
  numeric_value: number,
  title: string,
  body: string,
): ComplianceRule => ({
  key,
  jurisdiction,
  code_section,
  numeric_value,
  title: row?.display_label ?? title,
  body,
  updated_at: row?.updated_at ?? new Date().toISOString().slice(0, 10),
});

const projectRules = (rows: ComplianceRuleRow[]): ComplianceRules => {
  const domesticPct = numberFromRow(rows, 'business_travel_domestic', 'primary_purpose_threshold', 50);
  const intlShort = numberFromRow(rows, 'business_travel_intl', 'short_trip_day_limit', 7);
  const intlPersonalPct = numberFromRow(rows, 'business_travel_intl', 'personal_day_threshold', 25);
  const mealsPct = numberFromRow(rows, 'business_travel_meals', 'deduct_pct', 50);
  const travelDays = boolFromRow(rows, 'business_travel_shared', 'travel_days_count_as_business', true);

  return {
    domesticBusinessDayThreshold: domesticPct.value / 100,
    internationalShortTripMaxDays: intlShort.value,
    internationalPersonalDayThreshold: intlPersonalPct.value / 100,
    travelDaysCountAsBusiness: travelDays.value,
    mealsDeductionPct: mealsPct.value / 100,
    raw: [
      buildDisplayRule(
        domesticPct.row,
        'domestic_business_day_threshold',
        'domestic',
        'IRC §162',
        domesticPct.value / 100,
        'Primarily-business test (domestic)',
        'A domestic trip is fully deductible when more than ' +
          `${domesticPct.value}% of the days are business days. If business ` +
          'days do not exceed that threshold, the transportation cost is not ' +
          'deductible. Lodging and 50% of meals on business days remain deductible.',
      ),
      buildDisplayRule(
        intlShort.row,
        'international_short_trip_max_days',
        'international',
        'IRC §274(c)',
        intlShort.value,
        'Seven-day short-trip exception',
        `International trips of ${intlShort.value} days or fewer (excluding ` +
          'the day of departure) are evaluated under the domestic primarily-' +
          'business test. The allocation rule in §274(c)(2)(A) does not apply.',
      ),
      buildDisplayRule(
        intlPersonalPct.row,
        'international_personal_day_threshold',
        'international',
        'IRC §274(c)',
        intlPersonalPct.value / 100,
        'Personal-day allocation threshold',
        `For international trips longer than ${intlShort.value} days, ` +
          'transportation is fully deductible only when personal days are ' +
          `below ${intlPersonalPct.value}% of total days. When personal days ` +
          'are at or above that share, transportation is allocated by the ' +
          'business-day percentage.',
      ),
      buildDisplayRule(
        travelDays.row,
        'travel_days_count_as_business',
        'shared',
        'IRC §162',
        travelDays.value ? 1 : 0,
        'Travel days count as business days',
        'The day of departure and the day of return are treated as business ' +
          'days when their primary purpose is travel to or from the business ' +
          'destination.',
      ),
      buildDisplayRule(
        mealsPct.row,
        'meals_deduction_pct',
        'shared',
        'IRC §274(n)',
        mealsPct.value / 100,
        'Meal deduction limit',
        `Business meals incurred on business days are ${mealsPct.value}% ` +
          'deductible. Personal-day meals are not deductible.',
      ),
    ],
    rawDb: rows,
    loadedAt: Date.now(),
  };
};

// ── Cache + live sync ───────────────────────────────────────────────────────

let cache: ComplianceRules | null = null;
let inflight: Promise<ComplianceRules> | null = null;
const listeners = new Set<(rules: ComplianceRules) => void>();
let channelStarted = false;

async function fetchRules(): Promise<ComplianceRules> {
  const { data, error } = await supabase
    .from('compliance_rules')
    .select('*');
  if (error) throw new Error(error.message);
  return projectRules((data ?? []) as ComplianceRuleRow[]);
}

function ensureChannel(): void {
  if (channelStarted) return;
  channelStarted = true;
  supabase
    .channel('compliance_rules-stream')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'compliance_rules' },
      () => {
        fetchRules()
          .then((r) => {
            cache = r;
            listeners.forEach((fn) => fn(r));
          })
          .catch(() => undefined);
      },
    )
    .subscribe();
}

export async function loadComplianceRules(
  force = false,
): Promise<ComplianceRules> {
  ensureChannel();
  if (cache && !force) return cache;
  if (inflight && !force) return inflight;
  inflight = fetchRules()
    .then((r) => {
      cache = r;
      inflight = null;
      listeners.forEach((fn) => fn(r));
      return r;
    })
    .catch((e) => {
      inflight = null;
      throw e;
    });
  return inflight;
}

export function getCachedRules(): ComplianceRules | null {
  return cache;
}

export function subscribeToRules(
  fn: (rules: ComplianceRules) => void,
): () => void {
  listeners.add(fn);
  ensureChannel();
  if (cache) fn(cache);
  return () => listeners.delete(fn);
}
