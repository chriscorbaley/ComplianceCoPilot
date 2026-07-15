// STEP 1 + STEP 2 of the post-onboarding upgrade flow.
//
// Shows a confirmation screen (plan price, the NEW features unlocked, and the
// billing disclosure) BEFORE any charge/tier change happens. On confirm it
// performs STEP 2: flips subscription_tier + subscription_status and appends
// 'business_travel' to active_strategies, then routes to the additional-
// strategy picker (UpgradeStrategySelect).

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { supabase } from '../services/supabase';
import { useAuth } from '../auth/AuthContext';
import { usePricingPlans, formatPrice } from '../services/pricingPlans';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'UpgradeConfirm'>;
type Route = NativeStackScreenProps<RootStackParamList, 'UpgradeConfirm'>['route'];

export const UpgradeConfirmScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { session, activeStrategies, refreshProfile } = useAuth();
  const { byKey } = usePricingPlans();

  const tier = route.params.tier;
  const plan = byKey[tier];
  const price = plan.monthly_price;
  const label = plan.display_name;
  const [busy, setBusy] = useState(false);

  // Business Travel is auto-added and doesn't count toward the strategy limit,
  // so exclude it from the "you currently have N" count shown to Core upgraders.
  const currentStrategyCount = activeStrategies.filter(
    (k) => k !== 'business_travel',
  ).length;

  // Only the NEW capabilities the user does not already have on their plan.
  const features: string[] =
    tier === 'core'
      ? [
          `Up to 3 strategies (you currently have ${currentStrategyCount})`,
          'AI voice on all strategy screens',
          'Business Travel — included automatically',
          'Full strategy progress dashboard',
        ]
      : [
          'All strategies — no limit',
          'AI voice meeting minutes',
          'Complete audit trail',
          'Business Travel — included automatically',
        ];

  const onConfirm = async () => {
    const uid = session?.user.id;
    if (!uid || busy) return;
    setBusy(true);
    try {
      // Fresh read so Business Travel is appended to the real current list
      // rather than a possibly-stale cached copy.
      const { data } = await supabase
        .from('users')
        .select('active_strategies')
        .eq('id', uid)
        .maybeSingle();
      const current = Array.isArray(
        (data as { active_strategies?: string[] } | null)?.active_strategies,
      )
        ? (data as { active_strategies: string[] }).active_strategies
        : [];
      const withBusinessTravel = current.includes('business_travel')
        ? current
        : [...current, 'business_travel'];

      const { error } = await supabase
        .from('users')
        .update({
          subscription_tier: tier,
          subscription_status: 'active',
          active_strategies: withBusinessTravel,
        })
        .eq('id', uid);
      if (error) throw error;
      await refreshProfile();
      // STEP 3: pick additional strategies. replace() so Back doesn't return to
      // this confirmation screen after the tier has already changed.
      nav.replace('UpgradeStrategySelect', { tier });
    } catch (e) {
      Alert.alert(
        'Could not complete upgrade',
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Plan details card */}
      <View style={styles.card}>
        <Text style={styles.planName}>{label}</Text>
        <View style={styles.priceRow}>
          <Text style={styles.price}>{formatPrice(price)}</Text>
          <Text style={styles.priceUnit}>/month</Text>
        </View>
        <Text style={styles.billedVia}>Billed monthly via Stripe</Text>
      </View>

      {/* What you're getting card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>What you’re getting</Text>
        {features.map((f) => (
          <View key={f} style={styles.featureRow}>
            <Ionicons name="checkmark-circle" size={18} color={colors.teal} />
            <Text style={styles.featureText}>{f}</Text>
          </View>
        ))}
      </View>

      {/* Amber billing disclosure */}
      <View style={styles.billingBox}>
        <Text style={styles.billingText}>
          By upgrading you agree to be charged {formatPrice(price)}/month starting
          today. You can cancel anytime from your account settings.
        </Text>
      </View>

      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onConfirm}
        disabled={busy}
        style={[styles.confirmBtn, busy && styles.confirmBtnDim]}
      >
        {busy ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.confirmText}>
            Confirm Upgrade to {label} — {formatPrice(price)}/mo
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => nav.goBack()}
        style={styles.notNow}
        disabled={busy}
      >
        <Text style={styles.notNowText}>Not now</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 20,
    gap: 16,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CCCCCC',
    padding: 18,
    gap: 8,
  },
  planName: {
    color: '#042C53',
    fontSize: 18,
    fontWeight: '700',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  price: {
    color: '#042C53',
    fontSize: 32,
    fontWeight: '700',
  },
  priceUnit: {
    color: '#888888',
    fontSize: 14,
  },
  billedVia: {
    color: colors.mutedText,
    fontSize: 13,
  },
  cardTitle: {
    color: '#042C53',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  featureText: {
    color: colors.bodyText,
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },
  billingBox: {
    backgroundColor: '#FAEEDA',
    borderRadius: 10,
    padding: 14,
  },
  billingText: {
    color: '#BA7517',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  confirmBtn: {
    backgroundColor: '#042C53',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
  },
  confirmBtnDim: {
    opacity: 0.7,
  },
  confirmText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  notNow: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  notNowText: {
    color: '#888888',
    fontSize: 14,
    fontWeight: '600',
  },
});
