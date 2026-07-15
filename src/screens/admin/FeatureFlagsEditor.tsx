import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { colors, spacing, typography } from '../../theme';
import { useAuth } from '../../auth/AuthContext';
import { supabase } from '../../services/supabase';
import {
  featureFlagLabel,
  fetchAllFeatureFlags,
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
      await updateFeatureFlag(row.flag_key, next, session?.user.id ?? null);
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

  return (
    <ScrollView style={listStyles.scroll} contentContainerStyle={listStyles.content}>
      <Text style={styles.intro}>
        Global on/off switches. A feature must be enabled here AND allowed by the
        user's plan to appear. Changes reach every client app within 60 seconds.
      </Text>
      {rows!.map((row) => (
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
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  intro: {
    ...typography.caption,
    color: colors.mutedText,
    paddingHorizontal: spacing.xs,
  },
});
