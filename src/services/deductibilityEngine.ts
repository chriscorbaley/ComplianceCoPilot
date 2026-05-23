// Pure IRS deductibility engine. Consumes a parsed itinerary and a snapshot of
// compliance_rules, returns a structured verdict the screen renders directly.
//
// Branching is intentionally explicit so it mirrors the §162 / §274(c) cascade.

import type { ComplianceRules } from './complianceRules';

export type DayKind = 'business' | 'travel' | 'personal';
export type TripType = 'domestic' | 'international';
export type Verdict = 'full_deduction' | 'partial_deduction' | 'not_deductible';

export interface ItineraryDay {
  date: string;
  kind: DayKind;
  label: string;
}

export interface ParsedItinerary {
  destination: string;
  trip_type: TripType;
  total_days: number;
  business_days: number;
  personal_days: number;
  travel_days: number;
  days: ItineraryDay[];
  purpose: string;
  countries?: string[];
}

export interface DeductibilityBreakdown {
  transportation_pct: number;
  lodging_business_day_pct: number;
  lodging_personal_day_pct: number;
  meals_business_day_pct: number;
  meals_personal_day_pct: number;
}

export interface DeductibilityResult {
  trip_type: TripType;
  total_days: number;
  business_days: number;
  personal_days: number;
  travel_days: number;
  // Days counted as business for the test — travel days are folded in here
  // when the corresponding compliance_rules row is on.
  counted_business_days: number;
  business_day_pct: number;
  personal_day_pct: number;
  verdict: Verdict;
  rule_applied: string;
  rationale: string;
  breakdown: DeductibilityBreakdown;
}

const round = (n: number) => Math.round(n * 100) / 100;
const pctInt = (n: number) => Math.round(n * 100);

function evaluateDomestic(
  itin: ParsedItinerary,
  rules: ComplianceRules,
  countedBusinessDays: number,
): DeductibilityResult {
  const businessDayPct = countedBusinessDays / itin.total_days;
  const personalDayPct = itin.personal_days / itin.total_days;
  const passes = businessDayPct > rules.domesticBusinessDayThreshold;

  const verdict: Verdict = passes ? 'full_deduction' : 'not_deductible';
  const transportationPct = passes ? 100 : 0;

  return {
    trip_type: 'domestic',
    total_days: itin.total_days,
    business_days: itin.business_days,
    personal_days: itin.personal_days,
    travel_days: itin.travel_days,
    counted_business_days: countedBusinessDays,
    business_day_pct: pctInt(businessDayPct),
    personal_day_pct: pctInt(personalDayPct),
    verdict,
    rule_applied: 'IRC §162 — primarily-business test',
    rationale: passes
      ? `Business days are ${pctInt(businessDayPct)}% of the trip, above the ` +
        `${pctInt(rules.domesticBusinessDayThreshold)}% threshold. ` +
        'Transportation is fully deductible.'
      : `Business days are only ${pctInt(businessDayPct)}% of the trip, at or ` +
        `below the ${pctInt(rules.domesticBusinessDayThreshold)}% threshold. ` +
        'Transportation is not deductible.',
    breakdown: {
      transportation_pct: transportationPct,
      lodging_business_day_pct: 100,
      lodging_personal_day_pct: 0,
      meals_business_day_pct: pctInt(rules.mealsDeductionPct),
      meals_personal_day_pct: 0,
    },
  };
}

function evaluateInternational(
  itin: ParsedItinerary,
  rules: ComplianceRules,
  countedBusinessDays: number,
): DeductibilityResult {
  // Rule 1: short trips are evaluated under the domestic test.
  if (itin.total_days <= rules.internationalShortTripMaxDays) {
    const domestic = evaluateDomestic(itin, rules, countedBusinessDays);
    return {
      ...domestic,
      trip_type: 'international',
      rule_applied:
        `IRC §274(c) — short-trip exception (≤ ` +
        `${rules.internationalShortTripMaxDays} days); evaluated under §162`,
      rationale:
        `Trip is ${itin.total_days} days, within the ` +
        `${rules.internationalShortTripMaxDays}-day short-trip window. ` +
        domestic.rationale,
    };
  }

  const businessDayPct = countedBusinessDays / itin.total_days;
  const personalDayPct = itin.personal_days / itin.total_days;

  // Rule 2: long international trip, personal time below allocation threshold.
  if (personalDayPct < rules.internationalPersonalDayThreshold) {
    return {
      trip_type: 'international',
      total_days: itin.total_days,
      business_days: itin.business_days,
      personal_days: itin.personal_days,
      travel_days: itin.travel_days,
      counted_business_days: countedBusinessDays,
      business_day_pct: pctInt(businessDayPct),
      personal_day_pct: pctInt(personalDayPct),
      verdict: 'full_deduction',
      rule_applied: 'IRC §274(c) — personal time below allocation threshold',
      rationale:
        `Personal time is ${pctInt(personalDayPct)}% of the trip, below the ` +
        `${pctInt(rules.internationalPersonalDayThreshold)}% allocation ` +
        'threshold. Transportation is fully deductible.',
      breakdown: {
        transportation_pct: 100,
        lodging_business_day_pct: 100,
        lodging_personal_day_pct: 0,
        meals_business_day_pct: pctInt(rules.mealsDeductionPct),
        meals_personal_day_pct: 0,
      },
    };
  }

  // Rule 3: long international trip, allocate transportation by business %.
  const transportationPct = pctInt(businessDayPct);
  return {
    trip_type: 'international',
    total_days: itin.total_days,
    business_days: itin.business_days,
    personal_days: itin.personal_days,
    travel_days: itin.travel_days,
    counted_business_days: countedBusinessDays,
    business_day_pct: pctInt(businessDayPct),
    personal_day_pct: pctInt(personalDayPct),
    verdict: 'partial_deduction',
    rule_applied: 'IRC §274(c) — allocation by business-day percentage',
    rationale:
      `Personal time is ${pctInt(personalDayPct)}% of the trip, at or above the ` +
      `${pctInt(rules.internationalPersonalDayThreshold)}% allocation ` +
      `threshold. Transportation is deductible at ${transportationPct}% — the ` +
      'business-day percentage.',
    breakdown: {
      transportation_pct: transportationPct,
      lodging_business_day_pct: 100,
      lodging_personal_day_pct: 0,
      meals_business_day_pct: pctInt(rules.mealsDeductionPct),
      meals_personal_day_pct: 0,
    },
  };
}

export function evaluateDeductibility(
  itin: ParsedItinerary,
  rules: ComplianceRules,
): DeductibilityResult {
  const countedBusinessDays = rules.travelDaysCountAsBusiness
    ? itin.business_days + itin.travel_days
    : itin.business_days;

  if (itin.trip_type === 'domestic') {
    return evaluateDomestic(itin, rules, countedBusinessDays);
  }
  return evaluateInternational(itin, rules, countedBusinessDays);
}

// Convenience for the Log Trip form, which works with raw integer counts
// rather than a day-by-day list.
export function evaluateFromCounts(args: {
  trip_type: TripType;
  destination: string;
  purpose: string;
  total_days: number;
  business_days: number;
  countries?: string[];
  rules: ComplianceRules;
}): DeductibilityResult {
  const travelDays = args.total_days >= 2 ? 2 : args.total_days >= 1 ? 1 : 0;
  // business_days from the form already excludes travel days; clamp anything
  // weird.
  const businessDays = Math.max(
    0,
    Math.min(args.business_days, args.total_days - travelDays),
  );
  const personalDays = Math.max(
    0,
    args.total_days - businessDays - travelDays,
  );
  const days: ItineraryDay[] = [];
  return evaluateDeductibility(
    {
      destination: args.destination,
      trip_type: args.trip_type,
      total_days: args.total_days,
      business_days: businessDays,
      personal_days: personalDays,
      travel_days: travelDays,
      days,
      purpose: args.purpose,
      countries: args.countries,
    },
    args.rules,
  );
}

export const _internals = { round };
