import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
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
import type { OnboardingStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'ChoosePlan'>;
type Route = NativeStackScreenProps<OnboardingStackParamList, 'ChoosePlan'>['route'];

const TIER_PRICES: Record<SubscriptionTier, number> = {
  starter: 49,
  core: 99,
  pro: 199,
};

interface Feature {
  text: string;
}

interface PlanCardProps {
  tier: SubscriptionTier;
  name: string;
  price: number;
  features: Feature[];
  highlighted: boolean;
  busy: boolean;
  onSelect: () => void;
}

const StarterCard: React.FC<Omit<PlanCardProps, 'tier'>> = ({ name, price, features, highlighted, busy, onSelect }) => (
  <View style={[styles.cardWhite, highlighted && styles.cardHighlighted]}>
    <Text style={styles.planNameNavy}>{name}</Text>
    <View style={styles.priceRow}>
      <Text style={styles.priceLargeNavy}>${price}</Text>
      <Text style={styles.priceMuted}>/month</Text>
    </View>
    <View style={styles.divider} />
    {features.map((f, i) => (
      <View key={i} style={styles.featureRow}>
        <Ionicons name="checkmark-circle" size={16} color={colors.teal} />
        <Text style={styles.featureText}>{f.text}</Text>
      </View>
    ))}
    <TouchableOpacity activeOpacity={0.85} disabled={busy} onPress={onSelect} style={styles.selectBtnOutline}>
      {busy ? <ActivityIndicator color={colors.navy} /> : <Text style={styles.selectBtnOutlineText}>Select Plan</Text>}
    </TouchableOpacity>
  </View>
);

const CoreCard: React.FC<Omit<PlanCardProps, 'tier'>> = ({ name, price, features, highlighted, busy, onSelect }) => (
  <View style={[styles.cardNavy, highlighted && styles.cardNavyHighlighted]}>
    <View style={styles.badge}>
      <Text style={styles.badgeText}>MOST POPULAR</Text>
    </View>
    <Text style={styles.planNameWhite}>{name}</Text>
    <View style={styles.priceRow}>
      <Text style={styles.priceLargeWhite}>${price}</Text>
      <Text style={styles.priceMutedBlue}>/month</Text>
    </View>
    <View style={styles.dividerWhite} />
    {features.map((f, i) => (
      <View key={i} style={styles.featureRow}>
        <Ionicons name="checkmark-circle" size={16} color="#BA7517" />
        <Text style={styles.featureTextWhite}>{f.text}</Text>
      </View>
    ))}
    <TouchableOpacity activeOpacity={0.85} disabled={busy} onPress={onSelect} style={styles.selectBtnGold}>
      {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.selectBtnGoldText}>Select Plan</Text>}
    </TouchableOpacity>
  </View>
);

const ProCard: React.FC<Omit<PlanCardProps, 'tier'>> = ({ name, price, features, highlighted, busy, onSelect }) => (
  <View style={[styles.cardWhite, styles.cardProBorder, highlighted && styles.cardProHighlighted]}>
    <Text style={styles.planNameNavy}>{name}</Text>
    <View style={styles.priceRow}>
      <Text style={styles.priceLargeNavy}>${price}</Text>
      <Text style={styles.priceMuted}>/month</Text>
    </View>
    <View style={styles.divider} />
    {features.map((f, i) => (
      <View key={i} style={styles.featureRow}>
        <Ionicons name="checkmark-circle" size={16} color="#BA7517" />
        <Text style={styles.featureText}>{f.text}</Text>
      </View>
    ))}
    <TouchableOpacity activeOpacity={0.85} disabled={busy} onPress={onSelect} style={styles.selectBtnNavy}>
      {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.selectBtnNavyText}>Select Plan</Text>}
    </TouchableOpacity>
  </View>
);

export const ChoosePlanScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { session, refreshProfile } = useAuth();
  const highlight = route.params?.highlight ?? null;
  const [busyTier, setBusyTier] = useState<SubscriptionTier | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState('');
  const [codeApplied, setCodeApplied] = useState(false);

  const selectPlan = async (tier: SubscriptionTier) => {
    if (!session?.user.id) return;
    setBusyTier(tier);
    try {
      const { error } = await supabase
        .from('users')
        .update({ subscription_tier: tier })
        .eq('id', session.user.id);
      if (error) throw error;
      await refreshProfile();
      if (tier === 'pro') {
        nav.replace('Payment');
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
      Alert.alert('Code applied', 'TAXLAB discount will be applied at checkout.');
    } else {
      Alert.alert('Invalid code', 'That code is not recognized.');
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 },
        ]}
      >
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

        <View style={styles.cards}>
          <StarterCard
            name="Starter"
            price={TIER_PRICES.starter}
            features={[
              { text: '1 tax strategy' },
              { text: 'AI document generator' },
              { text: 'AI voice-to-doc fill' },
              { text: 'Document storage' },
            ]}
            highlighted={highlight === 'starter'}
            busy={busyTier === 'starter'}
            onSelect={() => selectPlan('starter')}
          />

          <CoreCard
            name="Core"
            price={TIER_PRICES.core}
            features={[
              { text: 'Up to 3 tax strategies' },
              { text: 'All Starter features' },
              { text: 'Strategy progress tracking' },
              { text: 'Priority support' },
            ]}
            highlighted={highlight === 'core'}
            busy={busyTier === 'core'}
            onSelect={() => selectPlan('core')}
          />

          <ProCard
            name="Pro"
            price={TIER_PRICES.pro}
            features={[
              { text: 'All strategies' },
              { text: 'AI voice meeting minutes' },
              { text: 'Complete audit trail' },
              { text: 'All Core and Starter features' },
            ]}
            highlighted={highlight === 'pro'}
            busy={busyTier === 'pro'}
            onSelect={() => selectPlan('pro')}
          />
        </View>

        <Text style={styles.trialNote}>All plans include a 7-day free trial. Cancel anytime.</Text>

        <TouchableOpacity onPress={() => setCodeOpen(true)} style={styles.codeWrap}>
          <Text style={styles.codeText}>
            {codeApplied ? 'TAXLAB code applied ✓' : 'Already have a code?'}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={codeOpen} transparent animationType="fade" onRequestClose={() => setCodeOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Enter discount code</Text>
            <TextInput
              style={styles.codeInput}
              value={code}
              onChangeText={setCode}
              placeholder="e.g. TAXLAB"
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
  cardProBorder: {
    borderColor: '#BA7517',
    borderWidth: 2,
  },
  cardProHighlighted: {
    borderColor: '#BA7517',
    borderWidth: 3,
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
