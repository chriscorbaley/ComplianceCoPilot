// Paywall for the tier the user picked on ChoosePlanScreen. The tier arrives as
// a route param, threaded through the upsell screens — it is deliberately NOT on
// the profile yet, because nothing has been purchased at this point.
//
// Purchases run through RevenueCat / StoreKit — there is no card form and no
// third-party processor referenced anywhere on this screen. Apple rejects apps
// that reference non-IAP payment for digital goods (App Store Review 3.1.1).
//
// Prices are ALWAYS the store's own priceString, never pricing_plans. That table
// is copy/features only; Apple's price is the real, locale-correct, currency-
// correct number and the only one we are allowed to show next to a buy button.
//
// After a successful purchase we push the new tier into auth state optimistically
// and navigate. We deliberately do NOT write users.subscription_tier here, and
// deliberately do NOT call refreshProfile() — the RevenueCat webhook is the
// durable writer, and re-reading the profile before it lands would clobber the
// optimistic value with the stale one.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme';
import { supabase } from '../../services/supabase';
import { useAuth } from '../../auth/AuthContext';
import { useReviewMode } from '../../context/FeatureFlagContext';
import { usePricingPlans } from '../../services/pricingPlans';
import { purchasePackage, restorePurchases } from '../../services/revenueCat';
import {
  freeTrialDays,
  PERIOD_LABEL,
  purchaseErrorMessage,
  useTierOffering,
} from '../../services/paywall';
import { BillingPeriodOptions } from '../../components/BillingPeriodOptions';
import { PaywallLegalLinks } from '../../components/PaywallLegalLinks';
import type { OnboardingStackParamList } from '../../navigation/types';
import { contentContainerStyle } from '../../constants/layout';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'Payment'>;
type Route = RouteProp<OnboardingStackParamList, 'Payment'>;

export const PaymentScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const { session, setLocalSubscriptionTier } = useAuth();
  const reviewMode = useReviewMode();
  const { byKey } = usePricingPlans();

  // The tier was chosen on ChoosePlanScreen and threaded here through the upsell
  // screens as a route param. Nothing has been written to the profile yet — this
  // screen's purchase is what makes the tier real.
  const { tier } = useRoute<Route>().params;
  const plan = byKey[tier];

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

  const trialDays = freeTrialDays(selectedPackage);

  const firstChargeLabel = useMemo(() => {
    if (!trialDays) return null;
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + trialDays);
    return trialEnd.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }, [trialDays]);

  // Best-effort welcome email; onboarding never blocks on it.
  const sendWelcomeEmail = useCallback(async () => {
    if (!session?.user.id) return;
    try {
      await supabase.functions.invoke('send-welcome-email', {
        body: { user_id: session.user.id },
      });
    } catch {
      // Swallow — the function may not be deployed yet.
    }
  }, [session?.user.id]);

  // Review-mode bypass. App Store reviewers must be able to reach the full app
  // without a real purchase, so we skip StoreKit entirely and record the trial
  // ourselves. This is the ONE path that writes subscription_tier from the
  // client: no purchase happens, so no webhook will ever fire for it.
  const completeReviewBypass = useCallback(async () => {
    if (!session?.user.id) return;
    setBusy('purchase');
    setError(null);
    try {
      const { error: dbError } = await supabase
        .from('users')
        .update({
          subscription_tier: tier,
          subscription_status: 'trial',
          subscription_start: new Date().toISOString(),
        })
        .eq('id', session.user.id);
      if (dbError) throw dbError;
      setLocalSubscriptionTier(tier);
      await sendWelcomeEmail();
      if (!mounted.current) return;
      nav.replace('StrategySelection');
    } catch (err) {
      if (mounted.current) {
        setError(purchaseErrorMessage(err, 'Could not start your review-mode session.'));
      }
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, [session?.user.id, tier, setLocalSubscriptionTier, sendWelcomeEmail, nav]);

  const onSubscribe = useCallback(async () => {
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
            'Your purchase could not be completed. Please try again.',
          ),
        );
      }
      return;
    }
    // Optimistic: unlock gating now; the webhook writes the durable value.
    setLocalSubscriptionTier(outcome.tier ?? tier);
    await sendWelcomeEmail();
    if (!mounted.current) return;
    setBusy(null);
    nav.replace('StrategySelection');
  }, [
    reviewMode,
    completeReviewBypass,
    selectedPackage,
    setLocalSubscriptionTier,
    tier,
    sendWelcomeEmail,
    nav,
  ]);

  // Required by App Store Review guideline 3.1.1.
  const onRestore = useCallback(async () => {
    setBusy('restore');
    setError(null);
    const outcome = await restorePurchases();
    if (!mounted.current) return;
    setBusy(null);
    if (!outcome.ok) {
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
      Alert.alert(
        'Nothing to restore',
        Platform.OS === 'ios'
          ? 'We did not find an active subscription for this Apple Account.'
          : 'We did not find an active subscription for this Google account.',
      );
      return;
    }
    setLocalSubscriptionTier(outcome.tier);
    nav.replace('StrategySelection');
  }, [setLocalSubscriptionTier, nav]);

  const purchaseBusy = busy === 'purchase';
  const buyDisabled = busy !== null || (!reviewMode && !selectedPackage);
  const buyLabel = reviewMode
    ? 'Continue (Review Mode)'
    : trialDays
      ? 'Start Free Trial'
      : 'Subscribe';

  return (
    <View style={[styles.root, { paddingTop: insets.top + 16 }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={contentContainerStyle}>
          <View style={styles.brand}>
            <Image
              source={require('../../../assets/logo.png')}
              style={styles.logo}
              resizeMode="contain"
              tintColor="#FFFFFF"
            />
          </View>

          <View style={styles.summary}>
            <Text style={styles.summaryLabel}>You're starting</Text>
            <Text style={styles.summaryPlan}>{plan.display_name}</Text>
            {trialDays && firstChargeLabel ? (
              <View style={styles.trialPill}>
                <Ionicons name="time-outline" size={12} color="#85B7EB" />
                <Text style={styles.trialPillText}>
                  {trialDays}-day free trial · first charge {firstChargeLabel}
                </Text>
              </View>
            ) : null}
          </View>

          {reviewMode ? (
            <View style={styles.reviewNote}>
              <Ionicons name="flask-outline" size={12} color={colors.amber} />
              <Text style={styles.reviewNoteText}>Review mode active</Text>
            </View>
          ) : null}

          {loading ? (
            <View style={styles.stateCard}>
              <ActivityIndicator color={colors.midNavy} />
              <Text style={styles.stateText}>Loading plans…</Text>
            </View>
          ) : unavailable ? (
            <View style={styles.stateCard}>
              <Ionicons name="cloud-offline-outline" size={22} color={colors.mutedText} />
              <Text style={styles.stateTitle}>Unable to load pricing right now</Text>
              <Text style={styles.stateText}>
                We couldn't reach the {Platform.OS === 'ios' ? 'App Store' : 'Play Store'} for the{' '}
                {plan.display_name} plan. Please try again shortly.
              </Text>
              <TouchableOpacity activeOpacity={0.85} onPress={reload} style={styles.retryBtn}>
                <Text style={styles.retryText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.optionsCard}>
              <Text style={styles.optionsTitle}>{plan.display_name} subscription</Text>
              <BillingPeriodOptions
                offering={offering}
                period={period}
                onSelect={setPeriod}
                savingsPercent={savingsPercent}
                disabled={busy !== null}
              />
            </View>
          )}

          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={16} color={colors.orangeAlert} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* In review mode the button must work even when offerings failed to
              load — reviewers still need a way through onboarding. */}
          {reviewMode || !unavailable ? (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => void onSubscribe()}
              disabled={buyDisabled}
              style={[styles.payBtn, buyDisabled && styles.payBtnDim]}
            >
              {purchaseBusy ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.payText}>{buyLabel}</Text>
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
              <ActivityIndicator color="#85B7EB" />
            ) : (
              <Text style={styles.restoreText}>Restore Purchases</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.footnote}>
            {trialDays
              ? `Your ${trialDays}-day free trial converts to a paid ${PERIOD_LABEL[
                  period
                ].toLowerCase()} subscription unless cancelled at least 24 hours before it ends. `
              : ''}
            Payment is charged to your{' '}
            {Platform.OS === 'ios' ? 'Apple Account' : 'Google account'} at confirmation of
            purchase. The subscription renews automatically unless cancelled at least 24 hours
            before the end of the current period, and can be managed or cancelled in your{' '}
            {Platform.OS === 'ios' ? 'App Store' : 'Play Store'} account settings.
          </Text>

          <PaywallLegalLinks tone="light" />
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
  scroll: {
    paddingHorizontal: 20,
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
  summary: {
    alignItems: 'center',
    paddingVertical: 12,
    gap: 4,
  },
  summaryLabel: {
    color: '#85B7EB',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  summaryPlan: {
    color: colors.white,
    fontSize: 26,
    fontWeight: '700',
  },
  trialPill: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  trialPillText: {
    color: '#85B7EB',
    fontSize: 12,
    fontWeight: '500',
  },
  reviewNote: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 5,
    marginBottom: 4,
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
  stateCard: {
    marginTop: 16,
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
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
  optionsCard: {
    marginTop: 16,
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  optionsTitle: {
    color: '#042C53',
    fontSize: 16,
    fontWeight: '700',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 14,
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
  payBtn: {
    marginTop: 20,
    backgroundColor: '#042C53',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  payBtnDim: { opacity: 0.7 },
  payText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  restoreBtn: {
    marginTop: 14,
    alignItems: 'center',
    paddingVertical: 8,
  },
  restoreText: {
    color: '#85B7EB',
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  footnote: {
    marginTop: 12,
    color: '#85B7EB',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
});
