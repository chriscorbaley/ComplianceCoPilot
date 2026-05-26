import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
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

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'StrategySelection'>;

interface StrategyDef {
  key: string;
  name: string;
  description: string;
}

const STRATEGIES: StrategyDef[] = [
  { key: 'real_estate',       name: 'Real Estate / REPS',        description: 'Material participation hours toward real estate professional status (IRC §469).' },
  { key: 'augusta_rule',      name: 'Augusta Rule',              description: '14-day tax-free rental of your home to your business (IRC §280A(g)).' },
  { key: 's_corp',            name: 'S-Corp / Payroll',          description: 'Reasonable compensation analysis and payroll records for S-Corp shareholders.' },
  { key: 'business_travel',   name: 'Business Travel and Meals', description: 'Trip deductibility, day-by-day allocation, and IRC §274 meals (50%).' },
  { key: 'home_office',       name: 'Home Office',               description: 'Exclusive-use attestation and home-office deduction tracking (IRC §280A).' },
  { key: 'family_management', name: 'Family Management Company', description: 'Employment agreements and payroll for family management company wages.' },
  { key: 'str',               name: 'Short Term Rental (STR)',   description: 'STR hours tracking and material participation under non-passive rules.' },
];

const TIER_LIMITS: Record<SubscriptionTier, number> = {
  starter: 1,
  core: 3,
  pro: Infinity,
};

const TIER_REQUIRED_FOR_MORE: Record<Exclude<SubscriptionTier, 'pro'>, 'Core' | 'Pro'> = {
  starter: 'Core',
  core: 'Pro',
};

export const StrategySelectionScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const { session, subscriptionTier, refreshProfile } = useAuth();
  const [selected, setSelected] = useState<string[]>([]);
  const [lockedSheet, setLockedSheet] = useState<StrategyDef | null>(null);
  const [busy, setBusy] = useState(false);

  const tier: SubscriptionTier = subscriptionTier ?? 'starter';
  const limit = TIER_LIMITS[tier];

  const subtitle = useMemo(() => {
    if (tier === 'starter') return 'Choose 1 strategy to get started';
    if (tier === 'core') return 'Choose up to 3 strategies';
    return 'All strategies included — select to activate';
  }, [tier]);

  const isSelected = (key: string) => selected.includes(key);
  const limitReached = selected.length >= limit;

  const onCardPress = (s: StrategyDef) => {
    if (isSelected(s.key)) {
      setSelected((prev) => prev.filter((k) => k !== s.key));
      return;
    }
    if (limitReached && tier !== 'pro') {
      setLockedSheet(s);
      return;
    }
    setSelected((prev) => [...prev, s.key]);
  };

  const onUpgrade = () => {
    setLockedSheet(null);
    if (tier === 'pro') return;
    const target: SubscriptionTier = tier === 'starter' ? 'core' : 'pro';
    // Return to plan picker. The Gate will route us back through Payment after
    // a new tier is selected.
    nav.replace('ChoosePlan', { highlight: target });
  };

  const onFinish = async () => {
    if (!session?.user.id || selected.length === 0) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from('users')
        .update({
          active_strategies: selected,
          onboarding_completed: true,
        })
        .eq('id', session.user.id);
      if (error) throw error;
      await refreshProfile();
      // The Gate in App.tsx will swap to RootStack now that onboarding_completed=true.
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 16 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Choose Your Strategy</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        {tier !== 'pro' ? (
          <Text style={styles.counter}>
            {selected.length} / {limit} selected
          </Text>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {STRATEGIES.map((s) => {
          const sel = isSelected(s.key);
          const locked = !sel && limitReached && tier !== 'pro';
          return (
            <Pressable
              key={s.key}
              onPress={() => onCardPress(s)}
              style={({ pressed }) => [
                styles.card,
                sel && styles.cardSelected,
                locked && styles.cardLocked,
                pressed && { opacity: 0.85 },
              ]}
            >
              <View style={styles.cardLeft}>
                <Text style={[styles.cardName, locked && styles.cardNameDim]} numberOfLines={1}>
                  {s.name}
                </Text>
                <Text style={[styles.cardDesc, locked && styles.cardDescDim]} numberOfLines={2}>
                  {s.description}
                </Text>
                {locked ? <Text style={styles.upgradeHint}>Upgrade to unlock</Text> : null}
              </View>
              <View style={styles.cardRight}>
                {sel ? (
                  <View style={styles.checkBubble}>
                    <Ionicons name="checkmark" size={18} color={colors.white} />
                  </View>
                ) : locked ? (
                  <View style={styles.lockBubble}>
                    <Ionicons name="lock-closed" size={16} color={colors.amber} />
                  </View>
                ) : (
                  <View style={styles.emptyBubble} />
                )}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          activeOpacity={0.85}
          disabled={selected.length === 0 || busy}
          onPress={onFinish}
          style={[styles.finishBtn, (selected.length === 0 || busy) && styles.finishBtnDisabled]}
        >
          {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.finishText}>Get Started</Text>}
        </TouchableOpacity>
      </View>

      <Modal
        visible={lockedSheet !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setLockedSheet(null)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setLockedSheet(null)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <View style={styles.sheetHandle} />
            {lockedSheet ? (
              <>
                <View style={styles.sheetHeader}>
                  <View style={styles.sheetLock}>
                    <Ionicons name="lock-closed" size={20} color={colors.amber} />
                  </View>
                  <Text style={styles.sheetTitle}>{lockedSheet.name}</Text>
                </View>
                <Text style={styles.sheetDesc}>{lockedSheet.description}</Text>
                {tier !== 'pro' ? (
                  <Text style={styles.sheetRequires}>
                    This strategy requires {TIER_REQUIRED_FOR_MORE[tier]}.
                  </Text>
                ) : null}
                <TouchableOpacity activeOpacity={0.85} style={styles.sheetUpgrade} onPress={onUpgrade}>
                  <Text style={styles.sheetUpgradeText}>Upgrade Now</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.7} onPress={() => setLockedSheet(null)} style={styles.sheetDismiss}>
                  <Text style={styles.sheetDismissText}>Not now</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 4,
  },
  title: {
    color: '#042C53',
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.mutedText,
    fontSize: 14,
  },
  counter: {
    color: '#185FA5',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 10,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: 14,
    gap: 12,
  },
  cardSelected: {
    borderColor: colors.teal,
    borderWidth: 2,
    backgroundColor: colors.tealLight,
  },
  cardLocked: {
    backgroundColor: colors.amberLight,
    opacity: 0.6,
  },
  cardLeft: {
    flex: 1,
    gap: 4,
  },
  cardName: {
    color: colors.bodyText,
    fontSize: 14,
    fontWeight: '700',
  },
  cardNameDim: {
    color: colors.mutedText,
  },
  cardDesc: {
    color: '#888888',
    fontSize: 12,
    lineHeight: 16,
  },
  cardDescDim: {
    color: colors.subtleText,
  },
  upgradeHint: {
    marginTop: 2,
    color: colors.amber,
    fontSize: 11,
    fontWeight: '700',
  },
  cardRight: {
    width: 32,
    alignItems: 'center',
  },
  checkBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(186,117,23,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBubble: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.divider,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  finishBtn: {
    backgroundColor: '#042C53',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  finishBtnDisabled: {
    backgroundColor: '#C7CDD3',
  },
  finishText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 20,
    paddingBottom: 28,
    gap: 12,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.divider,
    marginBottom: 8,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sheetLock: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(186,117,23,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitle: {
    flex: 1,
    color: '#042C53',
    fontSize: 17,
    fontWeight: '700',
  },
  sheetDesc: {
    color: colors.bodyText,
    fontSize: 14,
    lineHeight: 20,
  },
  sheetRequires: {
    color: colors.amber,
    fontSize: 13,
    fontWeight: '700',
  },
  sheetUpgrade: {
    marginTop: 8,
    backgroundColor: '#BA7517',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  sheetUpgradeText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  sheetDismiss: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  sheetDismissText: {
    color: colors.mutedText,
    fontSize: 13,
    fontWeight: '600',
  },
});
