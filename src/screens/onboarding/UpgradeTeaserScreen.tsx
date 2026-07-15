import React, { useEffect } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme';
import { useAuth } from '../../auth/AuthContext';
import { usePricingPlans, formatPrice } from '../../services/pricingPlans';
import { useAppContent } from '../../services/appContent';
import { contentContainerStyle } from '../../constants/layout';
import type { OnboardingStackParamList } from '../../navigation/types';
import type { SubscriptionTier } from '../../services/supabase';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'UpgradeTeaser'>;

// Copy is editable from Admin → Content. The `*Key` fields point at app_content
// rows; the sibling strings are the shipped fallbacks rendered until the DB
// values load (or if the fetch fails).
interface TeaserFeature {
  key: string;
  fallback: string;
}

interface TeaserContent {
  headlineKey: string;
  headline: string;
  subheadKey: string;
  subhead: string;
  lockedFeatures: TeaserFeature[];
  // Tier being upsold (its display_name + price come from pricing_plans).
  upgradeTarget: SubscriptionTier;
}

const STARTER_TEASER: TeaserContent = {
  headlineKey: 'upsell_headline',
  headline: "You're one step away from better compliance coverage",
  subheadKey: 'upsell_body_starter',
  subhead: 'Core members track 3 strategies and never miss a deadline',
  lockedFeatures: [
    { key: 'upsell_starter_feature1', fallback: 'Additional strategies' },
    { key: 'upsell_starter_feature2', fallback: 'Strategy progress dashboard' },
    { key: 'upsell_starter_feature3', fallback: 'Priority support' },
  ],
  upgradeTarget: 'core',
};

const CORE_TEASER: TeaserContent = {
  headlineKey: 'upsell_headline',
  headline: "You're one step away from better compliance coverage",
  subheadKey: 'upsell_body_core',
  subhead: 'Pro members track every strategy with the full audit trail',
  lockedFeatures: [
    { key: 'upsell_core_feature1', fallback: 'All tax strategies' },
    { key: 'upsell_core_feature2', fallback: 'AI voice meeting minutes' },
    { key: 'upsell_core_feature3', fallback: 'Complete audit trail' },
  ],
  upgradeTarget: 'pro',
};

export const UpgradeTeaserScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const { subscriptionTier } = useAuth();
  const { byKey } = usePricingPlans();
  const appContent = useAppContent();

  // Defensive: Pro shouldn't see this; skip straight to the Business Travel
  // value screen (which then continues to payment).
  useEffect(() => {
    if (subscriptionTier === 'pro') {
      nav.replace('BusinessTravelIntro');
    }
  }, [subscriptionTier, nav]);

  if (subscriptionTier !== 'starter' && subscriptionTier !== 'core') return null;

  const content = subscriptionTier === 'starter' ? STARTER_TEASER : CORE_TEASER;
  const target = byKey[content.upgradeTarget];
  const upgradeLabel = `Upgrade to ${target.display_name} — ${formatPrice(target.monthly_price)}/mo`;
  const skipLabel = `Continue with ${byKey[subscriptionTier].display_name}`;

  return (
    <View style={[styles.root, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.brand}>
        <Image
          source={require('../../../assets/logo.png')}
          style={styles.logo}
          resizeMode="contain"
          tintColor="#FFFFFF"
        />
      </View>

      <View style={styles.body}>
        <View style={[contentContainerStyle, { gap: 12 }]}>
        <Text style={styles.headline}>{appContent.get(content.headlineKey, content.headline)}</Text>
        <Text style={styles.subhead}>{appContent.get(content.subheadKey, content.subhead)}</Text>

        <View style={styles.featureBox}>
          {content.lockedFeatures.map((f) => (
            <View key={f.key} style={styles.featureRow}>
              <Ionicons name="lock-closed" size={16} color="#BA7517" />
              <Text style={styles.featureText}>{appContent.get(f.key, f.fallback)}</Text>
            </View>
          ))}
        </View>
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.upgradeBtn}
          onPress={() => nav.replace('ChoosePlan', { highlight: content.upgradeTarget })}
        >
          <Text style={styles.upgradeText}>{upgradeLabel}</Text>
        </TouchableOpacity>

        <TouchableOpacity activeOpacity={0.7} style={styles.skipWrap} onPress={() => nav.replace('BusinessTravelIntro')}>
          <Text style={styles.skipText}>{skipLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#042C53',
    paddingHorizontal: 24,
  },
  brand: {
    alignItems: 'center',
    marginBottom: 12,
  },
  logo: {
    height: 50,
    width: undefined,
    aspectRatio: 1,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    gap: 12,
  },
  headline: {
    color: colors.white,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 28,
  },
  subhead: {
    color: '#85B7EB',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 8,
  },
  featureBox: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 18,
    gap: 12,
    marginTop: 8,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  featureText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '500',
  },
  actions: {
    gap: 12,
  },
  upgradeBtn: {
    backgroundColor: '#BA7517',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  upgradeText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  skipWrap: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  skipText: {
    color: '#85B7EB',
    fontSize: 13,
    fontWeight: '500',
  },
});
