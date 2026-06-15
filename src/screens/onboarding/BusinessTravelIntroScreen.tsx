import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme';
import { useAuth } from '../../auth/AuthContext';
import type { OnboardingStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'BusinessTravelIntro'>;

interface StatDef {
  value: string;
  label: string;
}

const STATS: StatDef[] = [
  { value: '$3,500+', label: 'Average tax savings per business trip' },
  { value: '100%', label: 'Of airfare may be deductible on qualifying trips' },
  { value: '2 IRS Rule Sets', label: 'Domestic and international compliance handled automatically' },
];

interface FeatureDef {
  title: string;
  sub: string;
}

const FEATURES: FeatureDef[] = [
  {
    title: 'AI Itinerary Analyzer',
    sub: 'Speak your trip — get an instant deductibility verdict before you even book',
  },
  {
    title: 'Domestic Travel (IRC §162)',
    sub: 'Primary purpose test applied automatically — know your deduction before you travel',
  },
  {
    title: 'International Travel (IRC §274(c))',
    sub: '7-day rule, 25% personal threshold, and allocation formula calculated for you',
  },
  {
    title: 'Log This Trip',
    sub: 'AI analysis results pre-fill your trip log — one tap to save a compliant record',
  },
  {
    title: 'Draft Future Trips',
    sub: 'Plan upcoming travel and finalize records after you return',
  },
  {
    title: 'Exportable Reports',
    sub: 'Send a complete trip compliance report to your tax advisor in seconds',
  },
];

// Value-proposition screen shown to ALL tiers between the upgrade teaser and the
// payment screen. Encourages Basic users to upgrade before paying.
export const BusinessTravelIntroScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const { subscriptionTier } = useAuth();
  const tier = subscriptionTier ?? 'starter';
  const isBasic = tier === 'starter';
  const tierName = tier === 'pro' ? 'Pro' : 'Core';

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, { paddingTop: insets.top + 28 }]}>
          <Ionicons name="airplane" size={48} color={colors.amber} style={styles.planeIcon} />
          <Text style={styles.title}>Don't Leave Money on the Table</Text>
          <Text style={styles.subtitle}>
            Business travel is one of the most overlooked tax deductions for
            business owners
          </Text>

          <View style={styles.statsRow}>
            {STATS.map((s) => (
              <View key={s.value} style={styles.statCard}>
                <Text style={styles.statValue}>{s.value}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>What Core and Pro members get</Text>
          {FEATURES.map((f) => (
            <View key={f.title} style={styles.featureRow}>
              <Ionicons name="checkmark-circle" size={20} color={colors.teal} />
              <View style={styles.featureText}>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureSub}>{f.sub}</Text>
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
                <Text style={styles.ctaText}>Upgrade to Core — $99/mo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.85}
                style={[styles.cta, styles.ctaOutline]}
                onPress={() => nav.replace('Payment')}
              >
                <Text style={styles.ctaOutlineText}>Continue with Basic</Text>
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
                onPress={() => nav.replace('Payment')}
              >
                <Text style={styles.ctaText}>Continue</Text>
              </TouchableOpacity>
            </>
          )}
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
    gap: 10,
    marginTop: 24,
  },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(133,183,235,0.25)',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 10,
  },
  statValue: {
    color: colors.amber,
    fontSize: 17,
    fontWeight: '800',
  },
  statLabel: {
    color: colors.white,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 6,
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
