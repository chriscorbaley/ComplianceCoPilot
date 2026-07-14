import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { scaled } from '../constants/layout';
import type { RootStackParamList } from '../navigation/types';

interface StatDef {
  value: string;
  label: string;
}

const STATS: StatDef[] = [
  { value: '$3,500+', label: 'Average savings per business trip for Core and Pro members' },
  { value: '100%', label: 'Of transportation costs may be deductible on qualifying trips' },
  { value: '2 Rule Sets', label: 'Domestic IRC 162 and International IRC 274(c) compliance engines' },
];

const FEATURES: string[] = [
  'AI itinerary analyzer — speak your trip for instant deductibility verdict',
  'Domestic vs international IRS rules applied automatically',
  'Log This Trip pre-fills form from AI analysis',
  'Draft trips for future travel planning',
  'Complete trip history with deductibility status badges',
  'Exportable compliance reports',
];

// Locked teaser shown on the Trips tab for Basic subscribers. Business Travel is
// a Core/Pro feature.
export const BusinessTravelLockedScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const goUpgrade = (tier: 'core' | 'pro') =>
    navigation.navigate('ChoosePlan', { highlight: tier });

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, { paddingTop: insets.top + 32 }]}>
          <Ionicons name="airplane" size={48} color={colors.amber} />
          <Text style={styles.title}>Business Travel Compliance</Text>
          <Text style={styles.subtitle}>Available on Core and Pro</Text>

          <View style={styles.statsCol}>
            {STATS.map((s) => (
              <View key={s.value} style={styles.statCard}>
                <Text style={styles.statValue}>{s.value}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.featureSection}>
          {FEATURES.map((f) => (
            <View key={f} style={styles.featureRow}>
              <Ionicons name="checkmark-circle" size={18} color={colors.teal} />
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => goUpgrade('core')}
            style={[styles.cta, styles.ctaCore]}
          >
            <Text style={styles.ctaText}>Upgrade to Core — $99/mo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => goUpgrade('pro')}
            style={[styles.cta, styles.ctaPro]}
          >
            <Text style={styles.ctaText}>Upgrade to Pro — $199/mo</Text>
          </TouchableOpacity>

          <Text style={styles.trialNote}>3-day free trial on all plans</Text>
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
    backgroundColor: '#042C53',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 28,
  },
  title: {
    color: colors.white,
    fontSize: 22,
    fontWeight: '700',
    marginTop: 16,
    textAlign: 'center',
  },
  subtitle: {
    color: '#85B7EB',
    fontSize: 14,
    marginTop: 6,
  },
  statsCol: {
    alignSelf: 'stretch',
    marginTop: 24,
    gap: 12,
  },
  statCard: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(133,183,235,0.25)',
    borderRadius: 12,
    padding: 16,
  },
  statValue: {
    color: colors.amber,
    fontSize: 24,
    fontWeight: '800',
  },
  statLabel: {
    color: colors.white,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  featureSection: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    gap: 14,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  featureText: {
    flex: 1,
    color: colors.bodyText,
    fontSize: 14,
    lineHeight: 20,
  },
  cta: {
    borderRadius: 10,
    paddingVertical: scaled(15),
    minHeight: scaled(44),
    alignItems: 'center',
  },
  ctaCore: {
    marginTop: 10,
    backgroundColor: colors.navy,
  },
  ctaPro: {
    backgroundColor: colors.amber,
  },
  ctaText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  trialNote: {
    textAlign: 'center',
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 2,
  },
});
