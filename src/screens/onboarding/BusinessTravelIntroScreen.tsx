import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme';
import { usePricingPlans, formatPrice } from '../../services/pricingPlans';
import { useAppContent } from '../../services/appContent';
import type { OnboardingStackParamList } from '../../navigation/types';
import { contentContainerStyle } from '../../constants/layout';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'BusinessTravelIntro'>;
type Route = RouteProp<OnboardingStackParamList, 'BusinessTravelIntro'>;

// Copy is editable from Admin → Content. Each `*Key` points at an app_content
// row; the sibling strings are the shipped fallbacks rendered until the DB
// values load (or if the fetch fails).
interface StatDef {
  valueKey: string;
  value: string;
  labelKey: string;
  label: string;
}

const STATS: StatDef[] = [
  { valueKey: 'bt_intro_stat1_value', value: '$3,500+', labelKey: 'bt_intro_stat1_label', label: 'Average tax savings per business trip' },
  { valueKey: 'bt_intro_stat2_value', value: '100%', labelKey: 'bt_intro_stat2_label', label: 'Of airfare may be deductible on qualifying trips' },
  { valueKey: 'bt_intro_stat3_value', value: '2 IRS Rule Sets', labelKey: 'bt_intro_stat3_label', label: 'Domestic and international compliance handled automatically' },
];

interface FeatureDef {
  titleKey: string;
  title: string;
  subKey: string;
  sub: string;
}

const FEATURES: FeatureDef[] = [
  {
    titleKey: 'bt_intro_feature1_title',
    title: 'AI Itinerary Analyzer',
    subKey: 'bt_intro_feature1_sub',
    sub: 'Speak your trip — get an instant deductibility verdict before you even book',
  },
  {
    titleKey: 'bt_intro_feature2_title',
    title: 'Domestic Travel (IRC §162)',
    subKey: 'bt_intro_feature2_sub',
    sub: 'Primary purpose test applied automatically — know your deduction before you travel',
  },
  {
    titleKey: 'bt_intro_feature3_title',
    title: 'International Travel (IRC §274(c))',
    subKey: 'bt_intro_feature3_sub',
    sub: '7-day rule, 25% personal threshold, and allocation formula calculated for you',
  },
  {
    titleKey: 'bt_intro_feature4_title',
    title: 'Log This Trip',
    subKey: 'bt_intro_feature4_sub',
    sub: 'AI analysis results pre-fill your trip log — one tap to save a compliant record',
  },
  {
    titleKey: 'bt_intro_feature5_title',
    title: 'Draft Future Trips',
    subKey: 'bt_intro_feature5_sub',
    sub: 'Plan upcoming travel and finalize records after you return',
  },
  {
    titleKey: 'bt_intro_feature6_title',
    title: 'Exportable Reports',
    subKey: 'bt_intro_feature6_sub',
    sub: 'Send a complete trip compliance report to your tax advisor in seconds',
  },
];

// Value-proposition screen shown to ALL tiers between the upgrade teaser and the
// payment screen. Encourages Basic users to upgrade before paying.
export const BusinessTravelIntroScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const { byKey } = usePricingPlans();
  const content = useAppContent();
  // The tier picked on ChoosePlan, passed forward rather than read from the
  // profile — nothing has been purchased yet, so the profile has no tier.
  const { tier } = useRoute<Route>().params;
  const isBasic = tier === 'starter';
  const tierName = byKey[tier].display_name;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={contentContainerStyle}>
        <View style={[styles.hero, { paddingTop: insets.top + 28 }]}>
          <Ionicons name="airplane" size={48} color={colors.amber} style={styles.planeIcon} />
          <Text style={styles.title}>{content.get('bt_intro_title', "Don't Leave Money on the Table")}</Text>
          <Text style={styles.subtitle}>
            {content.get(
              'bt_intro_subtitle',
              'Business travel is one of the most overlooked tax deductions for business owners',
            )}
          </Text>

          <View style={styles.statsRow}>
            {STATS.map((s) => (
              <View key={s.valueKey} style={styles.statCard}>
                <Text style={styles.statValue}>{content.get(s.valueKey, s.value)}</Text>
                <Text style={styles.statLabel}>{content.get(s.labelKey, s.label)}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{content.get('bt_intro_card_title', 'What Core and Pro members get')}</Text>
          {FEATURES.map((f) => (
            <View key={f.titleKey} style={styles.featureRow}>
              <Ionicons name="checkmark-circle" size={20} color={colors.teal} />
              <View style={styles.featureText}>
                <Text style={styles.featureTitle}>{content.get(f.titleKey, f.title)}</Text>
                <Text style={styles.featureSub}>{content.get(f.subKey, f.sub)}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.bottom}>
          {isBasic ? (
            <>
              <Text style={styles.bottomNote}>
                Business Travel requires Core or Pro. Upgrade now to unlock it.
              </Text>
              <TouchableOpacity
                activeOpacity={0.85}
                style={[styles.cta, styles.ctaGold]}
                onPress={() => nav.replace('ChoosePlan', { highlight: 'core' })}
              >
                <Text style={styles.ctaText}>
                  Upgrade to {byKey.core.display_name} — {formatPrice(byKey.core.monthly_price)}/mo
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.85}
                style={[styles.cta, styles.ctaOutline]}
                onPress={() => nav.replace('Payment', { tier })}
              >
                <Text style={styles.ctaOutlineText}>Continue with {byKey.starter.display_name}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.includedRow}>
                <Ionicons name="checkmark-circle" size={18} color={colors.teal} />
                <Text style={styles.includedText}>
                  Business Travel is included in your {tierName} plan
                </Text>
              </View>
              <TouchableOpacity
                activeOpacity={0.85}
                style={[styles.cta, styles.ctaNavy]}
                // Core sees the Mileage (Pro) upsell next; Pro already has
                // everything and goes straight to payment.
                onPress={() =>
                  tier === 'core'
                    ? nav.replace('MileageIntro', { tier })
                    : nav.replace('Payment', { tier })
                }
              >
                <Text style={styles.ctaText}>Continue</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#042C53',
  },
  hero: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    alignItems: 'center',
  },
  planeIcon: {
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  title: {
    color: colors.white,
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 16,
  },
  subtitle: {
    color: '#85B7EB',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 21,
    marginTop: 8,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 24,
    alignItems: 'stretch',
  },
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
  cardTitle: {
    color: '#042C53',
    fontSize: 16,
    fontWeight: '700',
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  featureText: {
    flex: 1,
  },
  featureTitle: {
    color: colors.bodyText,
    fontSize: 14,
    fontWeight: '700',
  },
  featureSub: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  bottom: {
    paddingHorizontal: 24,
    paddingTop: 20,
    gap: 12,
  },
  bottomNote: {
    color: '#85B7EB',
    fontSize: 13,
    textAlign: 'center',
  },
  includedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  includedText: {
    color: colors.teal,
    fontSize: 14,
    fontWeight: '700',
  },
  cta: {
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  ctaGold: {
    backgroundColor: colors.amber,
  },
  ctaNavy: {
    backgroundColor: colors.midNavy,
  },
  ctaOutline: {
    borderWidth: 1.5,
    borderColor: colors.white,
  },
  ctaText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  ctaOutlineText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
});
