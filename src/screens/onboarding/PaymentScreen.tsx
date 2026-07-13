import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme';
import { supabase, type SubscriptionTier } from '../../services/supabase';
import { useAuth } from '../../auth/AuthContext';
import type { OnboardingStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'Payment'>;

const TIER_NAMES: Record<SubscriptionTier, string> = {
  // Display label only — the DB tier value stays 'starter'.
  starter: 'Basic',
  core: 'Core',
  pro: 'Pro',
};

const TIER_PRICES: Record<SubscriptionTier, number> = {
  starter: 49,
  core: 99,
  pro: 199,
};

export const PaymentScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const { session, subscriptionTier, refreshProfile } = useAuth();
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [zip, setZip] = useState('');
  const [busy, setBusy] = useState(false);

  const tier = subscriptionTier ?? 'starter';
  const price = TIER_PRICES[tier];

  const nextBillingLabel = useMemo(() => {
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 3); // was + 7, now + 3
    return trialEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }, []);

  const formValid = cardNumber.replace(/\s/g, '').length >= 12 && expiry.length >= 4 && cvc.length >= 3 && zip.length >= 3;

  const onPay = async () => {
    if (!session?.user.id) return;
    if (!formValid) {
      Alert.alert('Missing info', 'Please complete all card fields.');
      return;
    }
    setBusy(true);
    try {
      // Stubbed Stripe charge — record trial start on the user row.
      const startIso = new Date().toISOString();
      const { error } = await supabase
        .from('users')
        .update({
          subscription_tier: tier,
          subscription_status: 'trial',
          subscription_start: startIso,
        })
        .eq('id', session.user.id);
      if (error) throw error;

      // Best-effort welcome email. Don't block onboarding on email failure.
      try {
        await supabase.functions.invoke('send-welcome-email', {
          body: { user_id: session.user.id },
        });
      } catch {
        // Swallow — function may not be deployed yet.
      }

      await refreshProfile();
      nav.replace('StrategySelection');
    } catch (err) {
      Alert.alert('Payment failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const formatCard = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 19);
    return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
  };

  const formatExpiry = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 4);
    if (digits.length <= 2) return digits;
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 16 }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
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
          <Text style={styles.summaryPlan}>{TIER_NAMES[tier]}</Text>
          <Text style={styles.summaryPrice}>${price}/month</Text>
          <View style={styles.trialPill}>
            <Ionicons name="time-outline" size={12} color="#85B7EB" />
            <Text style={styles.trialPillText}>3-day free trial · first charge {nextBillingLabel}</Text>
          </View>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Payment details</Text>
          <Text style={styles.formSub}>Secured by Stripe</Text>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Card number</Text>
            <TextInput
              style={styles.input}
              value={cardNumber}
              onChangeText={(v) => setCardNumber(formatCard(v))}
              placeholder="1234 5678 9012 3456"
              placeholderTextColor={colors.subtleText}
              keyboardType="number-pad"
              maxLength={23}
            />
          </View>

          <View style={styles.fieldRow}>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.fieldLabel}>Expiry</Text>
              <TextInput
                style={styles.input}
                value={expiry}
                onChangeText={(v) => setExpiry(formatExpiry(v))}
                placeholder="MM/YY"
                placeholderTextColor={colors.subtleText}
                keyboardType="number-pad"
                maxLength={5}
              />
            </View>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.fieldLabel}>CVC</Text>
              <TextInput
                style={styles.input}
                value={cvc}
                onChangeText={(v) => setCvc(v.replace(/\D/g, '').slice(0, 4))}
                placeholder="123"
                placeholderTextColor={colors.subtleText}
                keyboardType="number-pad"
                maxLength={4}
                secureTextEntry
              />
            </View>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={styles.fieldLabel}>ZIP</Text>
              <TextInput
                style={styles.input}
                value={zip}
                onChangeText={(v) => setZip(v.replace(/\D/g, '').slice(0, 10))}
                placeholder="12345"
                placeholderTextColor={colors.subtleText}
                keyboardType="number-pad"
                maxLength={10}
              />
            </View>
          </View>
        </View>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onPay}
          disabled={busy}
          style={[styles.payBtn, busy && styles.payBtnDim]}
        >
          {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.payText}>Start Free Trial</Text>}
        </TouchableOpacity>

        <Text style={styles.footnote}>You won't be charged today. Cancel anytime during the trial.</Text>
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
  summaryPrice: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '500',
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
  formCard: {
    marginTop: 16,
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 18,
    gap: 12,
  },
  formTitle: {
    color: '#042C53',
    fontSize: 16,
    fontWeight: '700',
  },
  formSub: {
    color: colors.mutedText,
    fontSize: 12,
    marginTop: -8,
    marginBottom: 4,
  },
  field: {
    gap: 6,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 8,
  },
  fieldLabel: {
    color: colors.mutedText,
    fontSize: 12,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.bodyText,
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
  footnote: {
    marginTop: 12,
    color: '#85B7EB',
    fontSize: 12,
    textAlign: 'center',
  },
});
