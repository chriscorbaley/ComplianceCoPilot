// Single source of truth for the REPS "effective minimum hours" target.
//
// The binding REPS Gate 1 requirement is the greater of the 750-hour test and
// "more than 50% of total annual work hours". Both the Dashboard and the Hours
// screen derive their hours target from this one function so the two views can
// never drift apart.

import type { ComplianceRuleRow } from '../services/supabase';

// Compute the effective REPS minimum from a flat { rule_key: rule_value } map.
// majorityPct is read in percentage form (e.g. "50") and converted internally.
// When no positive total-work-hours figure is supplied, the Gate 1 hour test
// stands alone.
export const calculateEffectiveMinHours = (
  totalWorkHours: number,
  complianceRules: Record<string, string>,
): number => {
  const repsGate1Hours = parseInt(
    complianceRules['reps_gate1_hours'] ?? '750',
    10,
  );
  const majorityPct =
    parseInt(complianceRules['reps_majority_services_pct'] ?? '50', 10) / 100;

  if (!totalWorkHours || totalWorkHours <= 0) {
    return repsGate1Hours;
  }

  return Math.max(repsGate1Hours, Math.floor(totalWorkHours * majorityPct) + 1);
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
