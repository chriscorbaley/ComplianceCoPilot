// Shared real estate v2 derivation: which tracks are active, hour aggregates,
// threshold map. Used by both HoursScreen and StrategyDetailScreen so the two
// views stay in lockstep.

import type {
  ComplianceRuleRow,
  HoursLogRow,
  HoursType,
  MpTestKey,
  PropertyRow,
} from './supabase';

export interface ThresholdMap {
  reps_gate1_hours: number;
  reps_majority_services_pct: number;
  mp_test_1_hours: number;
  mp_test_3_hours: number;
  mp_test_4_hours: number;
  mp_test_4_total_hours: number;
  mp_test_7_hours: number;
  str_avg_period_max_days: number;
}

export const DEFAULT_THRESHOLDS: ThresholdMap = {
  reps_gate1_hours: 750,
  reps_majority_services_pct: 50,
  mp_test_1_hours: 500,
  mp_test_3_hours: 100,
  mp_test_4_hours: 100,
  mp_test_4_total_hours: 500,
  mp_test_7_hours: 100,
  str_avg_period_max_days: 7,
};

export function readThresholds(rawDb: ComplianceRuleRow[]): ThresholdMap {
  const out: ThresholdMap = { ...DEFAULT_THRESHOLDS };
  const num = (strategy: string, key: string): number | null => {
    const row = rawDb.find(
      (r) => r.strategy_name === strategy && r.rule_key === key,
    );
    if (!row) return null;
    const n = parseFloat(row.rule_value);
    return Number.isFinite(n) ? n : null;
  };
  const re = (k: keyof ThresholdMap, strategy: string, ruleKey: string) => {
    const v = num(strategy, ruleKey);
    if (v !== null) out[k] = v;
  };
  re('reps_gate1_hours', 'real_estate', 'reps_gate1_hours');
  re('reps_majority_services_pct', 'real_estate', 'reps_majority_services_pct');
  re('mp_test_1_hours', 'real_estate', 'mp_test_1_hours');
  re('mp_test_3_hours', 'real_estate', 'mp_test_3_hours');
  re('mp_test_4_hours', 'real_estate', 'mp_test_4_hours');
  re('mp_test_4_total_hours', 'real_estate', 'mp_test_4_total_hours');
  re('mp_test_7_hours', 'real_estate', 'mp_test_7_hours');
  re('str_avg_period_max_days', 'str', 'avg_period_max_days');
  return out;
}

// Per-test hour requirement. Tests 2 and 5 are qualitative — return null so
// callers can render a note instead of a progress bar.
export function mpHourThreshold(
  test: MpTestKey,
  t: ThresholdMap,
): number | null {
  switch (test) {
    case 'test_1':
      return t.mp_test_1_hours;
    case 'test_3':
      return t.mp_test_3_hours;
    case 'test_4':
      return t.mp_test_4_hours;
    case 'test_7':
      return t.mp_test_7_hours;
    case 'test_2':
    case 'test_5':
      return null;
  }
}

export interface ActiveTracks {
  hasA: boolean;
  hasB: boolean;
  hasC: boolean;
  longTerm: PropertyRow[];
  shortTerm: PropertyRow[];
  groupingActive: boolean;
}

export function deriveActiveTracks(
  properties: PropertyRow[],
  repsPursuit: boolean | null,
): ActiveTracks {
  const longTerm = properties.filter((p) => p.property_type === 'long_term');
  const shortTerm = properties.filter((p) => p.property_type === 'short_term');
  const groupingActive = longTerm.some((p) => p.grouping_election);
  return {
    hasA: longTerm.length > 0 && repsPursuit === true,
    hasB: shortTerm.length > 0,
    hasC: longTerm.length > 0 && repsPursuit !== true,
    longTerm,
    shortTerm,
    groupingActive,
  };
}

export interface HourAggregates {
  totals: Record<HoursType, number>;
  perProperty: Map<string, number>;
}

export function aggregateHours(
  rows: HoursLogRow[],
  properties: PropertyRow[],
): HourAggregates {
  const propertyMap = new Map(properties.map((p) => [p.id, p]));
  const totals: Record<HoursType, number> = {
    reps_general: 0,
    material_participation: 0,
    str_participation: 0,
  };
  const perProperty = new Map<string, number>();
  for (const r of rows) {
    const hrs = Number(r.hours) || 0;
    if (hrs === 0) continue;
    const property = r.property_id ? propertyMap.get(r.property_id) ?? null : null;
    const ht: HoursType = r.hours_type ?? deriveHoursType(property);
    totals[ht] += hrs;
    if (r.property_id) {
      perProperty.set(r.property_id, (perProperty.get(r.property_id) ?? 0) + hrs);
    }
  }
  return { totals, perProperty };
}

export function deriveHoursType(p: PropertyRow | null): HoursType {
  if (!p) return 'reps_general';
  return p.property_type === 'short_term'
    ? 'str_participation'
    : 'material_participation';
}

export type Pace = 'On Track' | 'In Progress' | 'At Risk';

function yearFractionElapsed(now: Date = new Date()): number {
  const year = now.getFullYear();
  const start = new Date(year, 0, 1).getTime();
  const end = new Date(year + 1, 0, 1).getTime();
  return Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
}

export function paceFor(pct: number): {
  label: Pace;
  variant: 'success' | 'info' | 'warning';
} {
  if (pct >= 1) return { label: 'On Track', variant: 'success' };
  const elapsed = yearFractionElapsed();
  if (elapsed <= 0) return { label: 'In Progress', variant: 'info' };
  if (pct >= elapsed) return { label: 'On Track', variant: 'success' };
  if (pct >= elapsed * 0.75) return { label: 'In Progress', variant: 'info' };
  return { label: 'At Risk', variant: 'warning' };
}

// Weakest-link status for the dashboard pill. Walks every relevant gate and
// returns the worst pace.
export interface WeakestLinkInput {
  tracks: ActiveTracks;
  aggregates: HourAggregates;
  thresholds: ThresholdMap;
  totalWorkHours: number | null;
}

export function weakestLinkStatus(input: WeakestLinkInput): {
  label: Pace;
  variant: 'success' | 'info' | 'warning';
} {
  const { tracks, aggregates, thresholds, totalWorkHours } = input;
  const paces: ReturnType<typeof paceFor>[] = [];

  if (tracks.hasA) {
    const realEstateHours =
      aggregates.totals.material_participation +
      aggregates.totals.reps_general;
    paces.push(
      paceFor(
        thresholds.reps_gate1_hours
          ? realEstateHours / thresholds.reps_gate1_hours
          : 0,
      ),
    );
    if (totalWorkHours && totalWorkHours > 0) {
      const majorityPct = (realEstateHours / totalWorkHours) * 100;
      paces.push(
        paceFor(majorityPct / thresholds.reps_majority_services_pct),
      );
    }
  }
  for (const p of [...tracks.longTerm, ...tracks.shortTerm]) {
    const test = p.mp_test_selected;
    const t = test ? mpHourThreshold(test, thresholds) : null;
    if (!t) continue;
    const hrs = aggregates.perProperty.get(p.id) ?? 0;
    paces.push(paceFor(hrs / t));
  }

  const worst = paces.reduce<ReturnType<typeof paceFor>>((acc, p) => {
    const rank: Record<Pace, number> = {
      'At Risk': 0,
      'In Progress': 1,
      'On Track': 2,
    };
    return rank[p.label] < rank[acc.label] ? p : acc;
  }, { label: 'On Track', variant: 'success' });
  return worst;
}
