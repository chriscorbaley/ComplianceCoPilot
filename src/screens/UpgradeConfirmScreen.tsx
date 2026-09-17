// STEP 1 + STEP 2 of the post-onboarding upgrade flow.
//
// Shows what the user is buying (title, billing period, store price, and the NEW
// features unlocked) BEFORE any purchase, then runs the real in-app purchase.
// On success it performs STEP 2 — appending 'business_travel' to
// active_strategies — and routes to the additional-strategy picker.
//
// Billing model, same as the onboarding paywall:
//   • Purchases go through RevenueCat / StoreKit. This screen used to grant the
//     tier with a direct DB write and no payment at all; it no longer does.
//   • Price shown is ALWAYS the store's priceString, never pricing_plans (that
//     table is copy/features only).
//   • users.subscription_tier / subscription_status are written by the
//     RevenueCat webhook. The client only sets the tier optimistically via
//     setLocalSubscriptionTier so gating unlocks immediately.
//   • active_strategies IS still written here — it's app data, not billing, and
//     UpgradeStrategySelect depends on it.
//
// TIERS: handles 'starter' (Basic) as well as Core/Pro. Basic is a real paid
// product, so ChoosePlanScreen routes a post-onboarding Basic selection here
// instead of writing the tier directly. Basic is the ENTRY tier, so that path
// differs in two ways: the copy says "Subscribe", not "Upgrade", and on success
// it skips STEP 2 (Business Travel is a Core/Pro perk) and STEP 3 (the
// add-strategies picker grants no new slots on Basic), returning straight to the
// Dashboard.
//
// ORDERING TRAP: the active_strategies write needs refreshProfile() to land in
// context, but refreshProfile() re-reads subscription_tier from a database the
// webhook may not have updated yet. setLocalSubscriptionTier must therefore be
// called AFTER refreshProfile(), or the optimistic tier gets clobbered.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
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
import { supabase, type SubscriptionTier } from '../services/supabase';
import { useAuth } from '../auth/AuthContext';
import { useReviewMode } from '../context/FeatureFlagContext';
import { usePricingPlans } from '../services/pricingPlans';
import { purchasePackage, restorePurchases } from '../services/revenueCat';
import { purchaseErrorMessage, useTierOffering } from '../services/paywall';
import { BillingPeriodOptions } from '../components/BillingPeriodOptions';
import { PaywallLegalLinks } from '../components/PaywallLegalLinks';
import type { RootStackParamList } from '../navigation/types';
import { contentContainerStyle } from '../constants/layout';

type Nav = NativeStackNavigationProp<RootStackParamList, 'UpgradeConfirm'>;
type Route = NativeStackScreenProps<RootStackParamList, 'UpgradeConfirm'>['route'];

export const UpgradeConfirmScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { session, activeStrategies, refreshProfile, setLocalSubscriptionTier } = useAuth();
  const reviewMode = useReviewMode();
  const { byKey } = usePricingPlans();

  const tier = route.params.tier;
  const plan = byKey[tier];
  const label = plan.display_name;
  // "Upgrade" only reads correctly when moving up from a plan the user already
  // holds. Basic is the entry tier: whoever lands here for it has no active
  // subscription (never purchased, or lapsed — the RevenueCat webhook writes
  // tier 'starter' on EXPIRATION, so a revoked user looks the same).
  const isUpgrade = tier !== 'starter';

  const {
    offering,
    loading,
    unavailable,
    period,
    setPeriod,
    selectedPackage,
    savingsPercent,
    reload,
  } = useTierOffering(tier);

  const [busy, setBusy] = useState<'purchase' | 'restore' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Business Travel is auto-added and doesn't count toward the strategy limit,
  // so exclude it from the "you currently have N" count shown to Core upgraders.
  const currentStrategyCount = activeStrategies.filter(
    (k) => k !== 'business_travel',
  ).length;

  // Only the NEW capabilities the user does not already have on their plan.
  // Basic is the entry tier, so for it everything in the plan is new.
  const features: string[] =
    tier === 'starter'
      ? [
          '1 tax strategy of your choice',
          'AI document generator',
          'Strategy-specific compliance checklists',
          'Secure document storage',
        ]
      : tier === 'core'
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

  // Append Business Travel to the user's active strategies. App data, not
  // billing — this stays a client write even though the tier itself doesn't.
  // Fresh-reads first so we extend the real current list, not a stale cache.
  const activateBusinessTravel = useCallback(async () => {
    const uid = session?.user.id;
    if (!uid) return;
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
    if (current.includes('business_travel')) return;
    const { error: updateErr } = await supabase
      .from('users')
      .update({ active_strategies: [...current, 'business_travel'] })
      .eq('id', uid);
    if (updateErr) throw updateErr;
  }, [session?.user.id]);

  // Shared tail for a successful purchase or restore: activate Business Travel,
  // pull the new strategy list into context, THEN apply the optimistic tier
  // (see the ordering note in the file header) and continue to STEP 3.
  const completeUpgrade = useCallback(
    async (grantedTier: SubscriptionTier) => {
      // Basic grants neither Business Travel (a Core/Pro perk) nor extra
      // strategy slots, so STEP 2 and STEP 3 would both be wrong for it —
      // activating Business Travel would hand out a tier it doesn't include,
      // and UpgradeStrategySelect only accepts 'core' | 'pro'. Go straight back
      // to the Dashboard, keeping the refreshProfile-before-optimistic-tier
      // ordering from the file header.
      if (grantedTier === 'starter') {
        await refreshProfile();
        setLocalSubscriptionTier(grantedTier);
        if (!mounted.current) return;
        nav.navigate('Tabs', {
          screen: 'Dashboard',
          params: { upgradedTo: grantedTier },
        });
        return;
      }
      await activateBusinessTravel();
      await refreshProfile();
      setLocalSubscriptionTier(grantedTier);
      if (!mounted.current) return;
      nav.replace('UpgradeStrategySelect', {
        tier: grantedTier === 'pro' ? 'pro' : 'core',
      });
    },
    [activateBusinessTravel, refreshProfile, setLocalSubscriptionTier, nav],
  );

  // Review-mode bypass. App Store reviewers must be able to exercise the upgrade
  // flow without a real charge, so we skip StoreKit and write the tier directly.
  // This is the ONE path that writes subscription_tier from the client: no
  // purchase happens, so no webhook will ever fire for it.
  const completeReviewBypass = useCallback(async () => {
    const uid = session?.user.id;
    if (!uid) return;
    setBusy('purchase');
    setError(null);
    try {
      const { error: dbError } = await supabase
        .from('users')
        .update({ subscription_tier: tier, subscription_status: 'active' })
        .eq('id', uid);
      if (dbError) throw dbError;
      await completeUpgrade(tier);
    } catch (err) {
      if (mounted.current) {
        setError(
          purchaseErrorMessage(
            err,
            isUpgrade
              ? 'Could not complete the review-mode upgrade.'
              : 'Could not complete the review-mode subscription.',
          ),
        );
      }
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, [session?.user.id, tier, completeUpgrade, isUpgrade]);

  const onConfirm = useCallback(async () => {
    if (reviewMode) {
      await completeReviewBypass();
      return;
    }
    if (!selectedPackage) return;
    setBusy('purchase');
    setError(null);
    const outcome = await purchasePackage(selectedPackage);
    // Cancelling the native sheet is normal user behaviour, not a failure.
    if (outcome.userCancelled) {
      if (mounted.current) setBusy(null);
      return;
    }
    if (!outcome.ok) {
      if (mounted.current) {
        setBusy(null);
        setError(
          purchaseErrorMessage(
            outcome.error,
            isUpgrade
              ? 'Your upgrade could not be completed. Please try again.'
              : 'Your purchase could not be completed. Please try again.',
          ),
        );
      }
      return;
    }
    try {
      await completeUpgrade(outcome.tier ?? tier);
    } catch (err) {
      if (mounted.current) {
        // The purchase itself succeeded — only the follow-up setup failed.
        setError(
          purchaseErrorMessage(
            err,
            isUpgrade
              ? 'Your upgrade went through, but we could not finish setting up your strategies. Please try again.'
              : 'Your subscription went through, but we could not finish setting up your account. Please try again.',
          ),
        );
      }
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, [reviewMode, completeReviewBypass, selectedPackage, completeUpgrade, tier, isUpgrade]);

  // Required by App Store Review guideline 3.1.1.
  const onRestore = useCallback(async () => {
    setBusy('restore');
    setError(null);
    const outcome = await restorePurchases();
    if (!mounted.current) return;
    if (!outcome.ok) {
      setBusy(null);
      setError(
        purchaseErrorMessage(
          outcome.error,
          'We could not restore your purchases. Please try again.',
        ),
      );
      return;
    }
    if (!outcome.tier) {
      // Succeeded, but the store account owns nothing — not an error.
      setBusy(null);
      Alert.alert(
        'Nothing to restore',
        Platform.OS === 'ios'
          ? 'We did not find an active subscription for this Apple Account.'
          : 'We did not find an active subscription for this Google account.',
      );
      return;
    }
    // A restore can return a tier that isn't an upgrade (e.g. the Basic plan
    // they already had while trying to buy Core). Apply it, but don't push them
    // into the add-strategies flow for a tier that grants nothing new. When
    // Basic IS what this screen is selling, a restored Basic is the intended
    // outcome — fall through to completeUpgrade instead.
    if (outcome.tier === 'starter' && tier !== 'starter') {
      setLocalSubscriptionTier(outcome.tier);
      setBusy(null);
      Alert.alert(
        'Subscription restored',
        `We restored your ${byKey.starter.display_name} subscription. Choose a paid plan to upgrade.`,
      );
      return;
    }
    try {
      await completeUpgrade(outcome.tier);
    } catch (err) {
      if (mounted.current) {
        setError(
          purchaseErrorMessage(
            err,
            'We restored your subscription, but could not finish setting up your strategies.',
          ),
        );
      }
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, [setLocalSubscriptionTier, byKey.starter.display_name, completeUpgrade, tier]);

  const purchaseBusy = busy === 'purchase';
  const confirmDisabled = busy !== null || (!reviewMode && !selectedPackage);
  const confirmVerb = isUpgrade ? 'Upgrade to' : 'Subscribe to';
  const confirmLabel = reviewMode
    ? isUpgrade
      ? `Confirm Upgrade to ${label} (Review Mode)`
      : `Confirm ${label} Subscription (Review Mode)`
    : selectedPackage
      ? `${confirmVerb} ${label} — ${selectedPackage.product.priceString}`
      : `${confirmVerb} ${label}`;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={[contentContainerStyle, styles.column]}>
        {reviewMode ? (
          <View style={styles.reviewNote}>
            <Ionicons name="flask-outline" size={12} color={colors.amber} />
            <Text style={styles.reviewNoteText}>Review mode active</Text>
          </View>
        ) : null}

        {/* Plan details card — title, length and price, per Apple PAA §3.8(b) */}
        <View style={styles.card}>
          <Text style={styles.planName}>{label} subscription</Text>
          {loading ? (
            <View style={styles.stateWrap}>
              <ActivityIndicator color={colors.midNavy} />
              <Text style={styles.stateText}>Loading pricing…</Text>
            </View>
          ) : unavailable ? (
            <View style={styles.stateWrap}>
              <Ionicons name="cloud-offline-outline" size={22} color={colors.mutedText} />
              <Text style={styles.stateTitle}>Unable to load pricing right now</Text>
              <Text style={styles.stateText}>
                We couldn't reach the {Platform.OS === 'ios' ? 'App Store' : 'Play Store'} for the{' '}
                {label} plan. Please try again shortly.
              </Text>
              <TouchableOpacity activeOpacity={0.85} onPress={reload} style={styles.retryBtn}>
                <Text style={styles.retryText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <BillingPeriodOptions
              offering={offering}
              period={period}
              onSelect={setPeriod}
              savingsPercent={savingsPercent}
              disabled={busy !== null}
            />
          )}
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

        {/* Amber billing disclosure. Deliberately says nothing about proration
            or credit for the remaining time on the current plan — that depends
            on the products sharing one App Store subscription group, which is
            store-side configuration this screen can't verify. */}
        <View style={styles.billingBox}>
          <Text style={styles.billingText}>
            Your new plan takes effect immediately. Payment is charged to your{' '}
            {Platform.OS === 'ios' ? 'Apple Account' : 'Google account'} at confirmation of
            purchase, and the subscription renews automatically unless cancelled at least 24
            hours before the end of the current period. Manage or cancel it anytime in your{' '}
            {Platform.OS === 'ios' ? 'App Store' : 'Play Store'} account settings.
          </Text>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.orangeAlert} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* In review mode the button must work even when offerings failed to
            load — reviewers still need a way through the upgrade flow. */}
        {reviewMode || !unavailable ? (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => void onConfirm()}
            disabled={confirmDisabled}
            style={[styles.confirmBtn, confirmDisabled && styles.confirmBtnDim]}
          >
            {purchaseBusy ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.confirmText}>{confirmLabel}</Text>
            )}
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => void onRestore()}
          disabled={busy !== null}
          style={styles.restoreBtn}
        >
          {busy === 'restore' ? (
            <ActivityIndicator color={colors.midNavy} />
          ) : (
            <Text style={styles.restoreText}>Restore Purchases</Text>
          )}
        </TouchableOpacity>

        <PaywallLegalLinks tone="dark" />

        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => nav.goBack()}
          style={styles.notNow}
          disabled={busy !== null}
        >
          <Text style={styles.notNowText}>Not now</Text>
        </TouchableOpacity>
      </View>
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
  },
  column: {
    gap: 16,
  },
  reviewNote: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 5,
    backgroundColor: colors.amberLight,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  reviewNoteText: {
    color: colors.amber,
    fontSize: 12,
    fontWeight: '700',
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CCCCCC',
    padding: 18,
    gap: 10,
  },
  planName: {
    color: '#042C53',
    fontSize: 18,
    fontWeight: '700',
  },
  stateWrap: {
    alignItems: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  stateTitle: {
    color: '#042C53',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  stateText: {
    color: colors.mutedText,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  retryBtn: {
    marginTop: 6,
    borderWidth: 1.5,
    borderColor: '#042C53',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryText: {
    color: '#042C53',
    fontSize: 14,
    fontWeight: '700',
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
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.orangeAlertBg,
    borderRadius: 10,
    padding: 12,
  },
  errorText: {
    flex: 1,
    color: colors.orangeAlert,
    fontSize: 13,
    lineHeight: 18,
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
  restoreBtn: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  restoreText: {
    color: '#185FA5',
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
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
