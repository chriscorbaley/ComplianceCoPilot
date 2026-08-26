// Monthly / Annual selector shared by the onboarding paywall and the
// post-onboarding upgrade screen.
//
// Each row states the three things Apple's Paid Applications Agreement §3.8(b)
// requires before purchase: what it is, how long the period is, and the price —
// always the store's own priceString, never a value from pricing_plans. Periods
// the tier has no package for are simply not rendered.

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import { colors } from '../theme';
import type { BillingPeriod, TierOffering } from '../services/revenueCat';
import { PERIOD_LABEL, PERIOD_LENGTH } from '../services/paywall';

interface BillingPeriodOptionsProps {
  offering: TierOffering | null;
  period: BillingPeriod;
  onSelect: (period: BillingPeriod) => void;
  savingsPercent: number | null;
  disabled?: boolean;
}

export const BillingPeriodOptions: React.FC<BillingPeriodOptionsProps> = ({
  offering,
  period,
  onSelect,
  savingsPercent,
  disabled = false,
}) => {
  const renderOption = (key: BillingPeriod, pkg: PurchasesPackage | null) => {
    if (!pkg) return null;
    const selected = period === key;
    return (
      <TouchableOpacity
        key={key}
        activeOpacity={0.85}
        onPress={() => onSelect(key)}
        disabled={disabled}
        accessibilityRole="radio"
        accessibilityState={{ selected, disabled }}
        style={[styles.option, selected && styles.optionSelected]}
      >
        <View style={[styles.radio, selected && styles.radioOn]}>
          {selected ? <View style={styles.radioDot} /> : null}
        </View>
        <View style={styles.optionText}>
          <View style={styles.optionTitleRow}>
            <Text style={styles.optionTitle}>{PERIOD_LABEL[key]}</Text>
            {key === 'annual' && savingsPercent !== null ? (
              <View style={styles.saveBadge}>
                <Text style={styles.saveBadgeText}>SAVE {savingsPercent}%</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.optionLength}>{PERIOD_LENGTH[key]}</Text>
          {key === 'annual' && pkg.product.pricePerMonthString ? (
            <Text style={styles.optionEquivalent}>
              {pkg.product.pricePerMonthString}/mo equivalent
            </Text>
          ) : null}
        </View>
        <Text style={styles.optionPrice}>{pkg.product.priceString}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.wrap}>
      {renderOption('monthly', offering?.monthly ?? null)}
      {renderOption('annual', offering?.annual ?? null)}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    gap: 10,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  optionSelected: {
    borderColor: '#185FA5',
    borderWidth: 2,
    backgroundColor: colors.lightBlue,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.subtleText,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: {
    borderColor: '#185FA5',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#185FA5',
  },
  optionText: {
    flex: 1,
    gap: 2,
  },
  optionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  optionTitle: {
    color: '#042C53',
    fontSize: 15,
    fontWeight: '700',
  },
  saveBadge: {
    backgroundColor: colors.tealLight,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  saveBadgeText: {
    color: colors.teal,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  optionLength: {
    color: colors.mutedText,
    fontSize: 12,
  },
  optionEquivalent: {
    color: colors.teal,
    fontSize: 12,
    fontWeight: '600',
  },
  optionPrice: {
    color: '#042C53',
    fontSize: 18,
    fontWeight: '700',
  },
});
