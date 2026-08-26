import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme';
import { supabase, type SubscriptionTier } from '../../services/supabase';
import { useAuth } from '../../auth/AuthContext';
import { usePricingPlans, formatPrice, type PricingPlan } from '../../services/pricingPlans';
import { openManageSubscriptions } from '../../services/revenueCat';
import type { OnboardingStackParamList, RootStackParamList } from '../../navigation/types';
import { contentContainerStyle } from '../../constants/layout';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'ChoosePlan'>;
type Route = NativeStackScreenProps<OnboardingStackParamList, 'ChoosePlan'>['route'];

interface PlanCardProps {
  name: string;
  price: number;
  trialDays: number;
  features: string[];
  highlighted: boolean;
  busy: boolean;
  // Button label. Normally "Select Plan", but a paying subscriber picking Basic
  // is handed off to the store instead of changing plan in-app, so the label
  // says so (see selectPlan).
  selectLabel: string;
  onSelect: () => void;
}

const StarterCard: React.FC<PlanCardProps> = ({ name, price, trialDays, features, highlighted, busy, selectLabel, onSelect }) => (
  <View style={[styles.cardWhite, highlighted && styles.cardHighlighted]}>
    <Text style={styles.planNameNavy}>{name}</Text>
    <View style={styles.priceRow}>
      <Text style={styles.priceLargeNavy}>{formatPrice(price)}</Text>
      <Text style={styles.priceMuted}>/month</Text>
    </View>
    <Text style={styles.trialLine}>{trialDays}-day free trial</Text>
    <View style={styles.divider} />
    {features.map((f, i) => (
      <View key={i} style={styles.featureRow}>
        <Ionicons name="checkmark-circle" size={16} color={colors.teal} />
        <Text style={styles.featureText}>{f}</Text>
      </View>
    ))}
    <TouchableOpacity activeOpacity={0.85} disabled={busy} onPress={onSelect} style={styles.selectBtnOutline}>
      {busy ? <ActivityIndicator color={colors.navy} /> : <Text style={styles.selectBtnOutlineText}>{selectLabel}</Text>}
    </TouchableOpacity>
  </View>
);

const CoreCard: React.FC<PlanCardProps> = ({ name, price, trialDays, features, highlighted, busy, selectLabel, onSelect }) => (
  <View style={[styles.cardWhite, styles.cardCoreBorder, highlighted && styles.cardHighlighted]}>
    <Text style={styles.planNameNavy}>{name}</Text>
    <View style={styles.priceRow}>
      <Text style={styles.priceLargeNavy}>{formatPrice(price)}</Text>
      <Text style={styles.priceMuted}>/month</Text>
    </View>
    <Text style={styles.trialLine}>{trialDays}-day free trial</Text>
    <View style={styles.divider} />
    {features.map((f, i) => (
      <View key={i} style={styles.featureRow}>
        <Ionicons name="checkmark-circle" size={16} color={colors.teal} />
        <Text style={styles.featureText}>{f}</Text>
      </View>
    ))}
    <TouchableOpacity activeOpacity={0.85} disabled={busy} onPress={onSelect} style={styles.selectBtnOutline}>
      {busy ? <ActivityIndicator color={colors.navy} /> : <Text style={styles.selectBtnOutlineText}>{selectLabel}</Text>}
    </TouchableOpacity>
  </View>
);

const ProCard: React.FC<PlanCardProps> = ({ name, price, trialDays, features, highlighted, busy, selectLabel, onSelect }) => (
  <View style={[styles.cardNavy, highlighted && styles.cardNavyHighlighted]}>
    <View style={styles.badge}>
      <Text style={styles.badgeText}>MOST POPULAR</Text>
    </View>
    <Text style={styles.planNameWhite}>{name}</Text>
    <View style={styles.priceRow}>
      <Text style={styles.priceLargeWhite}>{formatPrice(price)}</Text>
      <Text style={styles.priceMutedBlue}>/month</Text>
    </View>
    <Text style={styles.trialLineBlue}>{trialDays}-day free trial</Text>
    <View style={styles.dividerWhite} />
    {features.map((f, i) => (
      <View key={i} style={styles.featureRow}>
        <Ionicons name="checkmark-circle" size={16} color="#BA7517" />
        <Text style={styles.featureTextWhite}>{f}</Text>
      </View>
    ))}
    <TouchableOpacity activeOpacity={0.85} disabled={busy} onPress={onSelect} style={styles.selectBtnGold}>
      {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.selectBtnGoldText}>{selectLabel}</Text>}
    </TouchableOpacity>
  </View>
);

// Map each plan_key to its styled card. plan_key is the stable gating identity;
// display_name/price/features/trial all come from the database row.
const CARD_BY_KEY: Record<SubscriptionTier, React.FC<PlanCardProps>> = {
  starter: StarterCard,
  core: CoreCard,
  pro: ProCard,
};

export const ChoosePlanScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { session, subscriptionTier, refreshProfile, onboardingCompleted } = useAuth();
  const { plans, loading } = usePricingPlans();
  const highlight = route.params?.highlight ?? null;
  const [busyTier, setBusyTier] = useState<SubscriptionTier | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState('');
  const [codeApplied, setCodeApplied] = useState(false);

  // Someone who finished onboarding AND holds a paid tier has a real store
  // subscription behind them. Their plan changes have to go through the store,
  // not through a database write (see selectPlan).
  const isPaidSubscriber =
    onboardingCompleted && (subscriptionTier === 'core' || subscriptionTier === 'pro');

  const storeName = Platform.OS === 'ios' ? 'App Store' : 'Play Store';

  const selectPlan = async (tier: SubscriptionTier) => {
    if (!session?.user.id) return;
    // Post-onboarding upgrade to a paid tier: don't charge or change anything
    // yet. Route through the confirmation → strategy-selection flow, which
    // performs the actual tier change and strategy activation on confirm.
    if (onboardingCompleted && (tier === 'core' || tier === 'pro')) {
      const rootNav = nav as unknown as NativeStackNavigationProp<RootStackParamList>;
      rootNav.navigate('UpgradeConfirm', { tier });
      return;
    }
    // Paying subscriber dropping to Basic. This used to write subscription_tier
    // straight to the database, which downgraded them in-app while Apple/Google
    // kept charging the old price indefinitely. Only the store can change what
    // someone is billed, so hand off to its subscription management UI — within
    // one Subscription Group the store handles the cross-grade and its timing,
    // and the RevenueCat webhook writes the new tier when it takes effect.
    if (isPaidSubscriber && tier === 'starter') {
      setBusyTier(tier);
      try {
        const result = await openManageSubscriptions();
        if (result !== 'opened') {
          Alert.alert(
            'Could not open subscriptions',
            Platform.OS === 'ios'
              ? 'Open the Settings app, tap your name, then Subscriptions to change your plan.'
              : 'Open the Google Play Store app, then Menu → Payments & subscriptions to change your plan.',
          );
        }
      } finally {
        setBusyTier(null);
      }
      return;
    }
    setBusyTier(tier);
    try {
      const { error } = await supabase
        .from('users')
        .update({ subscription_tier: tier })
        .eq('id', session.user.id);
      if (error) throw error;
      await refreshProfile();
      // Post-onboarding selection by someone with no paid store subscription
      // (already on Basic, or never purchased). Nothing is being billed, so the
      // tier can safely change immediately — gating reads subscription_tier at
      // render. Paying subscribers never reach here; they were handed to the
      // store above.
      if (onboardingCompleted) {
        const label = tier === 'pro' ? 'Pro' : tier === 'core' ? 'Core' : 'Basic';
        Alert.alert('Plan updated', `You're now on the ${label} plan.`);
        if (nav.canGoBack()) nav.goBack();
        return;
      }
      if (tier === 'pro') {
        // Pro skips the upgrade teaser but still sees the Business Travel value
        // screen before payment.
        nav.replace('BusinessTravelIntro');
      } else {
        nav.replace('UpgradeTeaser');
      }
    } catch (err) {
      Alert.alert('Could not save plan', err instanceof Error ? err.message : String(err));
    } finally {
      setBusyTier(null);
    }
  };

  const applyCode = () => {
    if (code.trim().toUpperCase() === 'TAXLAB') {
      setCodeApplied(true);
      Alert.alert('Code applied', 'Your discount will be applied at checkout.');
    } else {
      Alert.alert('Invalid code', 'That code is not recognized.');
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            // Post-onboarding this screen sits under the RootStack navy header,
            // which already clears the safe area — so don't double-pad the top.
            paddingTop: onboardingCompleted ? 16 : insets.top + 16,
            paddingBottom: insets.bottom + 32,
          },
        ]}
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
        <Text style={styles.title}>Choose Your Plan</Text>
        <Text style={styles.subtitle}>Start protecting your compliance today</Text>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.white} />
            <Text style={styles.loadingText}>Loading plans…</Text>
          </View>
        ) : (
          <View style={styles.cards}>
            {plans.map((p: PricingPlan) => {
              const Card = CARD_BY_KEY[p.plan_key];
              if (!Card) return null;
              return (
                <Card
                  key={p.plan_key}
                  name={p.display_name}
                  price={p.monthly_price}
                  trialDays={p.trial_days}
                  features={p.features}
                  highlighted={highlight === p.plan_key}
                  busy={busyTier === p.plan_key}
                  selectLabel={
                    isPaidSubscriber && p.plan_key === 'starter'
                      ? `Change in ${storeName}`
                      : 'Select Plan'
                  }
                  onSelect={() => selectPlan(p.plan_key)}
                />
              );
            })}
          </View>
        )}

        {isPaidSubscriber ? (
          <Text style={styles.handoffNote}>
            Moving to {plans.find((p) => p.plan_key === 'starter')?.display_name ?? 'Basic'} changes
            what you're billed, so the {storeName} handles it. We'll take you there — your plan
            updates here once the change takes effect.
          </Text>
        ) : null}

        <Text style={styles.trialNote}>Cancel anytime.</Text>

        <TouchableOpacity onPress={() => setCodeOpen(true)} style={styles.codeWrap}>
          <Text style={styles.codeText}>
            {codeApplied ? 'Code applied ✓' : 'Already have a code?'}
          </Text>
        </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal visible={codeOpen} transparent animationType="fade" onRequestClose={() => setCodeOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Enter discount code</Text>
            <TextInput
              style={styles.codeInput}
              value={code}
              onChangeText={setCode}
              placeholder="Enter code"
              placeholderTextColor={colors.subtleText}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setCodeOpen(false)} style={styles.modalCancel}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  applyCode();
                  setCodeOpen(false);
                }}
                style={styles.modalApply}
              >
                <Text style={styles.modalApplyText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#042C53',
  },
  scrollContent: {
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
  title: {
    color: colors.white,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: '#85B7EB',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 20,
  },
  cards: {
    gap: 12,
  },
  loadingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    gap: 12,
  },
  loadingText: {
    color: '#85B7EB',
    fontSize: 14,
  },
  trialLine: {
    color: colors.teal,
    fontSize: 12,
    fontWeight: '600',
    marginTop: -2,
  },
  trialLineBlue: {
    color: '#85B7EB',
    fontSize: 12,
    fontWeight: '600',
    marginTop: -2,
  },
  cardWhite: {
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CCCCCC',
    padding: 18,
    gap: 8,
  },
  cardHighlighted: {
    borderColor: '#185FA5',
    borderWidth: 2,
  },
  cardNavy: {
    backgroundColor: '#042C53',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    padding: 18,
    gap: 8,
    position: 'relative',
  },
  cardNavyHighlighted: {
    borderColor: '#BA7517',
    borderWidth: 2,
  },
  cardCoreBorder: {
    borderColor: '#042C53',
    borderWidth: 2,
  },
  badge: {
    position: 'absolute',
    top: -8,
    right: 14,
    backgroundColor: '#BA7517',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  planNameNavy: {
    color: '#042C53',
    fontSize: 16,
    fontWeight: '700',
  },
  planNameWhite: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  priceLargeNavy: {
    color: '#042C53',
    fontSize: 32,
    fontWeight: '700',
  },
  priceLargeWhite: {
    color: colors.white,
    fontSize: 32,
    fontWeight: '700',
  },
  priceMuted: {
    color: '#888888',
    fontSize: 14,
  },
  priceMutedBlue: {
    color: '#85B7EB',
    fontSize: 14,
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: 6,
  },
  dividerWhite: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginVertical: 6,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  featureText: {
    color: colors.bodyText,
    fontSize: 13,
  },
  featureTextWhite: {
    color: colors.white,
    fontSize: 13,
  },
  selectBtnOutline: {
    marginTop: 12,
    borderWidth: 1.5,
    borderColor: '#042C53',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  selectBtnOutlineText: {
    color: '#042C53',
    fontSize: 14,
    fontWeight: '700',
  },
  selectBtnGold: {
    marginTop: 12,
    backgroundColor: '#BA7517',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  selectBtnGoldText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  selectBtnNavy: {
    marginTop: 12,
    backgroundColor: '#042C53',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  selectBtnNavyText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  trialNote: {
    color: '#888888',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 16,
  },
  handoffNote: {
    color: '#85B7EB',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: 16,
  },
  codeWrap: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  codeText: {
    color: '#85B7EB',
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  modalCard: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 20,
    gap: 12,
  },
  modalTitle: {
    color: '#042C53',
    fontSize: 16,
    fontWeight: '700',
  },
  codeInput: {
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.bodyText,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  modalCancel: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  modalCancelText: {
    color: colors.mutedText,
    fontWeight: '600',
  },
  modalApply: {
    backgroundColor: '#185FA5',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  modalApplyText: {
    color: colors.white,
    fontWeight: '700',
  },
});
