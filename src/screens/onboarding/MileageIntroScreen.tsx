import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme';
import {
  MILEAGE_CONTENT_KEYS,
  MILEAGE_FEATURE_KEYS,
  MILEAGE_FEATURES,
  MILEAGE_STAT_KEYS,
  MILEAGE_STATS,
} from '../../components/MileageLockedScreen';
import { usePricingPlans, formatPrice } from '../../services/pricingPlans';
import { useAppContent } from '../../services/appContent';
import type { OnboardingStackParamList } from '../../navigation/types';
import { contentContainerStyle } from '../../constants/layout';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'MileageIntro'>;

// Shown ONLY to Core subscribers during onboarding, between the Business Travel
// intro and the payment screen. Upsells Core → Pro for mileage tracking. Basic
// users see the Business Travel intro instead; Pro users skip both upsells.
export const MileageIntroScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const { byKey } = usePricingPlans();
  const content = useAppContent();

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={contentContainerStyle}>
        <View style={[styles.hero, { paddingTop: insets.top + 28 }]}>
          <Ionicons name="speedometer" size={48} color={colors.amber} style={styles.icon} />
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
        </View>

        <View style={styles.bottom}>
          <Text style={styles.bottomNote}>
            Mileage tracking requires Pro. Upgrade now to unlock it.
          </Text>
          <TouchableOpacity
            activeOpacity={0.85}
            style={[styles.cta, styles.ctaGold]}
            onPress={() => nav.replace('ChoosePlan', { highlight: 'pro' })}
          >
            <Text style={styles.ctaText}>
              Upgrade to {byKey.pro.display_name} — {formatPrice(byKey.pro.monthly_price)}/mo
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.85}
            style={[styles.cta, styles.ctaOutline]}
            onPress={() => nav.replace('Payment')}
          >
            <Text style={styles.ctaOutlineText}>Continue with {byKey.core.display_name}</Text>
          </TouchableOpacity>
        </View>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#042C53' },
  hero: { paddingHorizontal: 24, paddingBottom: 24, alignItems: 'center' },
  icon: {
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
  bottom: { paddingHorizontal: 24, paddingTop: 20, gap: 12 },
  bottomNote: { color: '#85B7EB', fontSize: 13, textAlign: 'center' },
  cta: { borderRadius: 10, paddingVertical: 15, alignItems: 'center' },
  ctaGold: { backgroundColor: colors.amber },
  ctaOutline: { borderWidth: 1.5, borderColor: colors.white },
  ctaText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  ctaOutlineText: { color: colors.white, fontSize: 15, fontWeight: '700' },
});
