import React, { useEffect } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme';
import { useAuth } from '../../auth/AuthContext';
import { contentContainerStyle } from '../../constants/layout';
import type { OnboardingStackParamList } from '../../navigation/types';
import type { SubscriptionTier } from '../../services/supabase';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'UpgradeTeaser'>;

interface TeaserContent {
  headline: string;
  subhead: string;
  lockedFeatures: string[];
  upgradeLabel: string;
  upgradeTarget: SubscriptionTier;
  skipLabel: string;
}

const STARTER_TEASER: TeaserContent = {
  headline: "You're one step away from total compliance coverage",
  subhead: 'Core members track 3 strategies and never miss a deadline',
  lockedFeatures: ['Additional strategies', 'Strategy progress dashboard', 'Priority support'],
  upgradeLabel: 'Upgrade to Core — $99/mo',
  upgradeTarget: 'core',
  skipLabel: 'Continue with Basic',
};

const CORE_TEASER: TeaserContent = {
  headline: "You're one step away from total compliance coverage",
  subhead: 'Pro members track every strategy with the full audit trail',
  lockedFeatures: ['All tax strategies', 'AI voice meeting minutes', 'Complete audit trail'],
  upgradeLabel: 'Upgrade to Pro — $199/mo',
  upgradeTarget: 'pro',
  skipLabel: 'Continue with Core',
};

export const UpgradeTeaserScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const { subscriptionTier } = useAuth();

  // Defensive: Pro shouldn't see this; skip straight to the Business Travel
  // value screen (which then continues to payment).
  useEffect(() => {
    if (subscriptionTier === 'pro') {
      nav.replace('BusinessTravelIntro');
    }
  }, [subscriptionTier, nav]);

  if (subscriptionTier !== 'starter' && subscriptionTier !== 'core') return null;

  const content = subscriptionTier === 'starter' ? STARTER_TEASER : CORE_TEASER;

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
        <Text style={styles.headline}>{content.headline}</Text>
        <Text style={styles.subhead}>{content.subhead}</Text>

        <View style={styles.featureBox}>
          {content.lockedFeatures.map((f) => (
            <View key={f} style={styles.featureRow}>
              <Ionicons name="lock-closed" size={16} color="#BA7517" />
              <Text style={styles.featureText}>{f}</Text>
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
          <Text style={styles.upgradeText}>{content.upgradeLabel}</Text>
        </TouchableOpacity>

        <TouchableOpacity activeOpacity={0.7} style={styles.skipWrap} onPress={() => nav.replace('BusinessTravelIntro')}>
          <Text style={styles.skipText}>{content.skipLabel}</Text>
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
