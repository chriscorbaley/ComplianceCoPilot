// STEP 3 of the post-onboarding upgrade flow: after the tier has changed the
// user must pick which additional strategies to activate — otherwise
// active_strategies still only holds their original Basic strategy and every
// new strategy stays grayed out on the dashboard.
//
// Existing strategies show pre-selected (teal, non-deselectable). Business
// Travel shows as auto-included. Newly selectable cards respect the Core 3-slot
// limit (locked past the limit); Pro has no limit. Saving appends the new
// selections to active_strategies and returns to the dashboard with a success
// banner (STEP 4).

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
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
import { useFeatureFlags } from '../context/FeatureFlagContext';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'UpgradeStrategySelect'>;
type Route = NativeStackScreenProps<RootStackParamList, 'UpgradeStrategySelect'>['route'];

interface StrategyDef {
  key: string;
  name: string;
  description: string;
}

// Same user-selectable catalog as onboarding (Business Travel is auto-added and
// therefore not in this list).
const STRATEGIES: StrategyDef[] = [
  { key: 'real_estate', name: 'Real Estate / REPS', description: 'Material Participation hours for short-term rental tracking, and or Real Estate Professional status.' },
  { key: 'augusta_rule', name: 'Augusta Rule', description: '14-day tax-free rental of your home to your business (IRC §280A(g)).' },
  { key: 's_corp', name: 'S-Corp', description: 'Your S-Corp compliance, organized and export-ready — templates, records, and documents in one place.' },
  { key: 'home_office', name: 'Home Office', description: 'Exclusive-use attestation and home-office deduction tracking (IRC §280A).' },
  { key: 'family_management', name: 'Family Management Company', description: 'Track the documents and activity that keep your family management company strategy working.' },
];

const TIER_LABEL: Record<'core' | 'pro', string> = { core: 'Core', pro: 'Pro' };
const CORE_LIMIT = 3;

export const UpgradeStrategySelectScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { session, activeStrategies, refreshProfile } = useAuth();
  // Globally-disabled strategies are hidden from the upgrade picker too.
  const { isEnabled } = useFeatureFlags();
  const visibleStrategies = useMemo(
    () => STRATEGIES.filter((s) => isEnabled(s.key)),
    [isEnabled],
  );

  const tier = route.params.tier;
  const label = TIER_LABEL[tier];
  const [newSelected, setNewSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Strategies the user already owns (pre-selected, cannot be removed). Business
  // Travel is tracked separately and doesn't count toward the Core limit.
  const owned = useMemo(() => new Set(activeStrategies), [activeStrategies]);
  const ownedStrategyCount = useMemo(
    () => activeStrategies.filter((k) => k !== 'business_travel').length,
    [activeStrategies],
  );

  const totalIfSaved = ownedStrategyCount + newSelected.length;
  const limitReached = tier === 'core' && totalIfSaved >= CORE_LIMIT;
  const slotsRemaining = Math.max(0, CORE_LIMIT - ownedStrategyCount);

  const subtitle =
    tier === 'core'
      ? `Select up to ${slotsRemaining} more ${slotsRemaining === 1 ? 'strategy' : 'strategies'}`
      : 'Select any remaining strategies — all included';

  const toggle = (key: string) => {
    if (owned.has(key)) return; // existing strategies can't be deselected
    if (newSelected.includes(key)) {
      setNewSelected((prev) => prev.filter((k) => k !== key));
      return;
    }
    if (limitReached) return; // Core: no free slots left
    setNewSelected((prev) => [...prev, key]);
  };

  const onSave = async () => {
    const uid = session?.user.id;
    if (!uid || busy) return;
    setBusy(true);
    try {
      let merged: string[] = activeStrategies;
      if (newSelected.length > 0) {
        // Fresh read + union so we never clobber Business Travel or existing
        // picks with a stale array.
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
        merged = Array.from(new Set([...current, ...newSelected]));
        const { error } = await supabase
          .from('users')
          .update({ active_strategies: merged })
          .eq('id', uid);
        if (error) throw error;
        await refreshProfile();
      }
      // If Real Estate was just added, run the SAME real-estate onboarding flow
      // used at signup (portfolio type → MP test → REPS → properties → grouping
      // → completion) before landing on the dashboard. The completion screen
      // detects this in-app-upgrade context and navigates to the Dashboard
      // itself. Pass the full merged list so the flow persists every strategy.
      if (newSelected.includes('real_estate')) {
        nav.navigate('RealEstateType', { selectedStrategies: merged });
        return;
      }
      // STEP 4: hand off to the dashboard, which refetches fresh data and shows
      // the welcome banner.
      nav.navigate('Tabs', { screen: 'Dashboard', params: { upgradedTo: tier } });
    } catch (e) {
      Alert.alert('Could not save strategies', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveLabel =
    newSelected.length > 0 ? 'Save and Go to Dashboard' : 'Continue to Dashboard';

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Choose Your Additional Strategies</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Business Travel — auto-included, not selectable */}
        <View style={[styles.card, styles.cardSelected, styles.cardStatic]}>
          <View style={styles.cardLeft}>
            <Text style={styles.cardName}>Business Travel</Text>
            <Text style={styles.includedLabel}>Included with {label} — auto-added</Text>
          </View>
          <View style={styles.checkBubble}>
            <Ionicons name="checkmark" size={18} color={colors.white} />
          </View>
        </View>

        {visibleStrategies.map((s) => {
          const isOwned = owned.has(s.key);
          const isNew = newSelected.includes(s.key);
          const selected = isOwned || isNew;
          const locked = !selected && limitReached;

          return (
            <Pressable
              key={s.key}
              onPress={() => toggle(s.key)}
              disabled={isOwned || locked}
              style={({ pressed }) => [
                styles.card,
                selected && styles.cardSelected,
                locked && styles.cardLocked,
                pressed && !isOwned && !locked && { opacity: 0.85 },
              ]}
            >
              <View style={styles.cardLeft}>
                <Text style={[styles.cardName, locked && styles.cardNameDim]} numberOfLines={1}>
                  {s.name}
                </Text>
                <Text style={[styles.cardDesc, locked && styles.cardDescDim]}>
                  {s.description}
                </Text>
                {isOwned ? <Text style={styles.ownedLabel}>Already active</Text> : null}
                {locked ? <Text style={styles.upgradeHint}>Upgrade limit reached</Text> : null}
              </View>
              <View style={styles.cardRight}>
                {selected ? (
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
          disabled={busy}
          onPress={onSave}
          style={[styles.saveBtn, busy && styles.saveBtnDim]}
        >
          {busy ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.saveText}>{saveLabel}</Text>
          )}
        </TouchableOpacity>
      </View>
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
    paddingTop: 16,
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
  cardStatic: {
    opacity: 1,
  },
  cardSelected: {
    borderColor: colors.teal,
    borderWidth: 2,
    backgroundColor: colors.tealLight,
  },
  cardLocked: {
    backgroundColor: colors.amberLight,
    opacity: 0.5,
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
    lineHeight: 18,
    flexShrink: 1,
  },
  cardDescDim: {
    color: colors.subtleText,
  },
  includedLabel: {
    color: colors.teal,
    fontSize: 12,
    fontWeight: '700',
  },
  ownedLabel: {
    marginTop: 2,
    color: colors.teal,
    fontSize: 11,
    fontWeight: '700',
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
  saveBtn: {
    backgroundColor: '#042C53',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  saveBtnDim: {
    opacity: 0.7,
  },
  saveText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
});
