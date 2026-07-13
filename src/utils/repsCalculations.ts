// Single source of truth for the REPS "effective minimum hours" target.
//
// The binding REPS Gate 1 requirement is the greater of the 750-hour test and
// "more than 50% of total annual work hours". Both the Dashboard and the Hours
// screen derive their hours target from this one function so the two views can
// never drift apart.

import type { ComplianceRuleRow } from '../services/supabase';

// Compute the effective REPS minimum from a flat { rule_key: rule_value } map.
// The 50% rule requires MORE THAN half of ALL working hours to be spent in real
// estate. "All working hours" = RE hours + non-RE hours combined, so to exceed
// half the total, RE hours must be greater than the non-RE hours the user works.
// totalWorkHours holds those non-RE hours, so the minimum RE hours needed is
// non-RE hours + 1. When no positive figure is supplied, the Gate 1 hour test
// stands alone.
export const calculateEffectiveMinHours = (
  totalWorkHours: number,
  complianceRules: Record<string, string>,
): number => {
  const repsGate1Hours = parseInt(
    complianceRules['reps_gate1_hours'] ?? '750',
    10,
  );

  if (!totalWorkHours || totalWorkHours <= 0) {
    return repsGate1Hours;
  }

  return Math.max(repsGate1Hours, totalWorkHours + 1);
};

// Project the generic (strategy_name, rule_key, rule_value) compliance_rules
// rows into the flat map calculateEffectiveMinHours expects. Both screens build
// the map this way so they feed the calculation byte-identical inputs.
export const buildRepsRulesRecord = (
  rawDb: ComplianceRuleRow[],
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const row of rawDb) {
    if (row.strategy_name === 'real_estate') out[row.rule_key] = row.rule_value;
  }
  return out;
};
