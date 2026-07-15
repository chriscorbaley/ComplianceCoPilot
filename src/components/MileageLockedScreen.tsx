import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { scaled } from '../constants/layout';
import { usePricingPlans, formatPrice } from '../services/pricingPlans';
import { useAppContent } from '../services/appContent';
import type { RootStackParamList } from '../navigation/types';

// Shared marketing copy for the Mileage upsell — reused by the in-app locked
// screen (this file) and the onboarding Mileage intro screen (Feature 2).
export interface MileageStat {
  value: string;
  label: string;
}

export const MILEAGE_STATS: MileageStat[] = [
  { value: '$0.70', label: 'Per business mile deductible (2025 IRS rate)' },
  {
    value: '2 Categories',
    label: 'Business and medical miles tracked separately with correct IRS rates',
  },
  { value: 'Pro Only', label: 'Full mileage tracking with exportable IRS-ready reports' },
];

export interface MileageFeature {
  title: string;
  sub: string;
}

export const MILEAGE_FEATURES: MileageFeature[] = [
  {
    title: 'Multi-Vehicle Fleet Tracking',
    sub: 'Track miles across multiple vehicles separately for accurate records',
  },
  {
    title: 'Business & Medical Categories',
    sub: 'Separate IRS rates applied automatically — $0.70 for business, $0.21 for medical (2025 rates)',
  },
  {
    title: 'Odometer or Direct Entry',
    sub: 'Log starting and ending odometer or enter total miles directly — flexible for every situation',
  },
  {
    title: 'Instant Deduction Calculator',
    sub: 'See your estimated deduction as you log each trip',
  },
  {
    title: 'IRS-Ready PDF Reports',
    sub: 'Export a complete mileage log formatted for your tax professional or IRS examination',
  },
  {
    title: 'Prior Year Access',
    sub: 'Log and edit entries for prior tax years — never miss a deduction',
  },
];

// app_content keys for the mileage marketing copy, shared by BOTH surfaces that
// render it — this in-app locked screen and the onboarding Mileage intro — so
// an Admin edit updates both places consistently. The MILEAGE_STATS /
// MILEAGE_FEATURES constants above remain the shipped fallbacks (paired by
// index with these keys).
export const MILEAGE_CONTENT_KEYS = {
  title: 'mileage_intro_title',
  subtitle: 'mileage_intro_subtitle',
  cardTitle: 'mileage_intro_card_title',
} as const;

export const MILEAGE_STAT_KEYS = [
  { valueKey: 'mileage_intro_stat1_value', labelKey: 'mileage_intro_stat1_label' },
  { valueKey: 'mileage_intro_stat2_value', labelKey: 'mileage_intro_stat2_label' },
  { valueKey: 'mileage_intro_stat3_value', labelKey: 'mileage_intro_stat3_label' },
];

export const MILEAGE_FEATURE_KEYS = [
  { titleKey: 'mileage_intro_feature1_title', subKey: 'mileage_intro_feature1_sub' },
  { titleKey: 'mileage_intro_feature2_title', subKey: 'mileage_intro_feature2_sub' },
  { titleKey: 'mileage_intro_feature3_title', subKey: 'mileage_intro_feature3_sub' },
  { titleKey: 'mileage_intro_feature4_title', subKey: 'mileage_intro_feature4_sub' },
  { titleKey: 'mileage_intro_feature5_title', subKey: 'mileage_intro_feature5_sub' },
  { titleKey: 'mileage_intro_feature6_title', subKey: 'mileage_intro_feature6_sub' },
];

// Locked teaser shown on the Mileage tab for Basic and Core subscribers.
// Mileage tracking is a Pro-only feature.
export const MileageLockedScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { byKey } = usePricingPlans();
  const content = useAppContent();

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, { paddingTop: insets.top + 32 }]}>
          <Ionicons name="speedometer" size={48} color={colors.amber} />
          <Text style={styles.title}>{content.get(MILEAGE_CONTENT_KEYS.title, 'Track Every Mile, Maximize Every Deduction')}</Text>
          <Text style={styles.subtitle}>
            {content.get(
              MILEAGE_CONTENT_KEYS.subtitle,
              'The IRS allows substantial deductions for business and medical miles driven. Most business owners leave this money on the table.',
            )}
          </Text>

          <View style={styles.statsRow}>
            {MILEAGE_STATS.map((s, i) => (
              <View key={MILEAGE_STAT_KEYS[i]?.valueKey ?? s.value} style={styles.statCard}>
                <Text style={styles.statValue}>{content.get(MILEAGE_STAT_KEYS[i]?.valueKey ?? '', s.value)}</Text>
                <Text style={styles.statLabel}>{content.get(MILEAGE_STAT_KEYS[i]?.labelKey ?? '', s.label)}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{content.get(MILEAGE_CONTENT_KEYS.cardTitle, 'What Pro members get')}</Text>
          {MILEAGE_FEATURES.map((f, i) => (
            <View key={MILEAGE_FEATURE_KEYS[i]?.titleKey ?? f.title} style={styles.featureRow}>
              <Ionicons name="checkmark-circle" size={20} color={colors.teal} />
              <View style={styles.featureText}>
                <Text style={styles.featureTitle}>{content.get(MILEAGE_FEATURE_KEYS[i]?.titleKey ?? '', f.title)}</Text>
                <Text style={styles.featureSub}>{content.get(MILEAGE_FEATURE_KEYS[i]?.subKey ?? '', f.sub)}</Text>
              </View>
            </View>
          ))}

          <Text style={styles.bottomNote}>
            Mileage tracking requires Pro. Upgrade now to unlock it.
          </Text>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigation.navigate('ChoosePlan', { highlight: 'pro' })}
            style={styles.cta}
          >
            <Text style={styles.ctaText}>
              Upgrade to {byKey.pro.display_name} — {formatPrice(byKey.pro.monthly_price)}/mo
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#042C53' },
  hero: { alignItems: 'center', paddingHorizontal: 24, paddingBottom: 28 },
  title: {
    color: colors.white,
    fontSize: 24,
    fontWeight: '700',
    marginTop: 16,
    textAlign: 'center',
  },
  subtitle: {
    color: '#85B7EB',
    fontSize: 15,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 21,
  },
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 24, alignItems: 'stretch' },
  statCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(133,183,235,0.25)',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  statValue: {
    color: colors.amber,
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
    flexShrink: 1,
  },
  statLabel: {
    color: colors.white,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 6,
    textAlign: 'center',
    flexShrink: 1,
  },
  card: {
    backgroundColor: colors.white,
    marginHorizontal: 16,
    borderRadius: 16,
    padding: 20,
    gap: 14,
  },
  cardTitle: { color: '#042C53', fontSize: 16, fontWeight: '700' },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  featureText: { flex: 1 },
  featureTitle: { color: colors.bodyText, fontSize: 14, fontWeight: '700' },
  featureSub: { color: colors.mutedText, fontSize: 12, lineHeight: 17, marginTop: 2 },
  bottomNote: {
    color: colors.mutedText,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
  },
  cta: {
    backgroundColor: colors.amber,
    borderRadius: 10,
    paddingVertical: scaled(15),
    minHeight: scaled(44),
    alignItems: 'center',
  },
  ctaText: { color: colors.white, fontSize: 15, fontWeight: '700' },
});
