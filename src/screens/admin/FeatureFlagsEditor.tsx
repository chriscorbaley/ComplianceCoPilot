import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '../../theme';
import { useAuth } from '../../auth/AuthContext';
import { supabase } from '../../services/supabase';
import {
  featureFlagLabel,
  fetchAllFeatureFlags,
  REVIEW_MODE_FLAG_KEY,
  REVIEW_MODE_LABEL,
  updateFeatureFlag,
  type FeatureFlagRow,
} from '../../services/featureFlags';
import { AdminCard, AdminEmpty, AdminLoading, listStyles } from './_shared';

// Admin → Flags. Lists every global feature flag with its description and an
// on/off toggle. Toggling asks for confirmation, writes to feature_flags, and
// the realtime subscription in FeatureFlagContext pushes the change to every
// client app within seconds.
export const FeatureFlagsEditor: React.FC = () => {
  const { session } = useAuth();
  const [rows, setRows] = useState<FeatureFlagRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = async () => {
    try {
      const data = await fetchAllFeatureFlags();
      setRows(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void load();
    const channel = supabase
      .channel('admin-feature-flags-stream-' + Date.now())
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'feature_flags' },
        () => void load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const applyToggle = async (row: FeatureFlagRow, next: boolean) => {
    setBusy((b) => ({ ...b, [row.flag_key]: true }));
    // Optimistic update.
    setRows((cur) =>
      cur
        ? cur.map((r) =>
            r.flag_key === row.flag_key ? { ...r, is_enabled: next } : r,
          )
        : cur,
    );
    try {
      await updateFeatureFlag(row.flag_key, next, session?.user.email ?? null);
    } catch (e) {
      Alert.alert('Toggle failed', e instanceof Error ? e.message : String(e));
      // Roll back.
      setRows((cur) =>
        cur
          ? cur.map((r) =>
              r.flag_key === row.flag_key
                ? { ...r, is_enabled: row.is_enabled }
                : r,
            )
          : cur,
      );
    } finally {
      setBusy((b) => ({ ...b, [row.flag_key]: false }));
    }
  };

  const confirmToggle = (row: FeatureFlagRow, next: boolean) => {
    const label = featureFlagLabel(row.flag_key);
    const verb = next ? 'enable' : 'disable';
    Alert.alert(
      next ? 'Enable feature' : 'Disable feature',
      `This will ${verb} ${label} for all users immediately. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: next ? 'Enable' : 'Disable',
          style: next ? 'default' : 'destructive',
          onPress: () => void applyToggle(row, next),
        },
      ],
    );
  };

  // Review mode gets its own, stronger confirmation: enabling it bypasses live
  // billing and unlocks every feature for ALL users, so we spell out the blast
  // radius and require an explicit tap. Disabling (returning to normal, safe
  // operation) applies immediately with no barrier — turning it off should be
  // as frictionless as possible.
  const confirmReviewMode = (row: FeatureFlagRow, next: boolean) => {
    if (!next) {
      void applyToggle(row, false);
      return;
    }
    Alert.alert(
      'Enable Review Mode?',
      'This bypasses live billing for ALL users until you turn it off. Only use during active App Store review.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Enable Review Mode',
          style: 'destructive',
          onPress: () => void applyToggle(row, true),
        },
      ],
    );
  };

  if (!rows && !error) return <AdminLoading label="Loading feature flags…" />;
  if (error) {
    return (
      <AdminEmpty
        icon="alert-circle-outline"
        title="Could not load feature flags"
        hint={error}
      />
    );
  }
  if (rows && rows.length === 0) {
    return (
      <AdminEmpty
        icon="flag-outline"
        title="No feature flags"
        hint="Run supabase/feature_flags.sql to seed them."
      />
    );
  }

  // Review mode is an operational kill switch, not a normal feature flag, so it
  // is pulled out of the list and rendered on its own with a distinct warning
  // treatment below the feature flags.
  const reviewRow = rows!.find((r) => r.flag_key === REVIEW_MODE_FLAG_KEY);
  const featureRows = rows!.filter((r) => r.flag_key !== REVIEW_MODE_FLAG_KEY);

  return (
    <ScrollView style={listStyles.scroll} contentContainerStyle={listStyles.content}>
      <Text style={styles.intro}>
        Global on/off switches. A feature must be enabled here AND allowed by the
        user's plan to appear. Changes reach every client app within 60 seconds.
      </Text>
      {featureRows.map((row) => (
        <AdminCard key={row.flag_key}>
          <View style={listStyles.rowHeader}>
            <View style={{ flex: 1 }}>
              <Text style={listStyles.rowTitle}>
                {featureFlagLabel(row.flag_key)}
              </Text>
              {row.description ? (
                <Text style={listStyles.rowSubtitle}>{row.description}</Text>
              ) : null}
              <Text style={listStyles.rowMeta}>
                {row.flag_key} · {row.is_enabled ? 'ENABLED' : 'DISABLED'}
              </Text>
            </View>
            <Switch
              value={row.is_enabled}
              onValueChange={(v) => confirmToggle(row, v)}
              disabled={busy[row.flag_key]}
            />
          </View>
        </AdminCard>
      ))}

      {reviewRow ? (
        <AdminCard style={styles.warningCard}>
          <View style={listStyles.rowHeader}>
            <View style={{ flex: 1 }}>
              <View style={styles.warningTitleRow}>
                <Ionicons name="warning-outline" size={16} color={colors.amber} />
                <Text style={styles.warningTitle}>{REVIEW_MODE_LABEL}</Text>
              </View>
              <Text style={styles.warningText}>
                Enable ONLY during App Store review. This bypasses live billing
                and unlocks all features for every user. Remember to disable
                immediately after approval.
              </Text>
              <Text style={[listStyles.rowMeta, styles.warningMeta]}>
                {reviewRow.flag_key} ·{' '}
                {reviewRow.is_enabled ? 'ENABLED' : 'DISABLED'}
              </Text>
            </View>
            <Switch
              value={reviewRow.is_enabled}
              onValueChange={(v) => confirmReviewMode(reviewRow, v)}
              disabled={busy[reviewRow.flag_key]}
              trackColor={{ true: colors.amber, false: undefined }}
            />
          </View>
        </AdminCard>
      ) : null}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  intro: {
    ...typography.caption,
    color: colors.mutedText,
    paddingHorizontal: spacing.xs,
  },
  warningCard: {
    backgroundColor: colors.amberLight,
    borderColor: colors.amber,
    borderWidth: 1,
  },
  warningTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  warningTitle: {
    ...typography.h3,
    color: colors.amber,
    fontSize: 14,
  },
  warningText: {
    ...typography.caption,
    color: colors.amber,
    fontSize: 12,
    marginTop: 4,
  },
  warningMeta: {
    color: colors.amber,
    opacity: 0.8,
  },
});
