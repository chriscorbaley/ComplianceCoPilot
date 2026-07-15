import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { colors, spacing, typography } from '../../theme';
import { supabase, type StrategyRow } from '../../services/supabase';
import { useAuth } from '../../auth/AuthContext';
import { logAdminAction } from '../../services/auditLog';
import {
  AdminCard,
  AdminEmpty,
  AdminLoading,
  listStyles,
} from './_shared';

export const StrategiesToggle: React.FC = () => {
  const { session } = useAuth();
  const [rows, setRows] = useState<StrategyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = async () => {
    const { data, error: e } = await supabase
      .from('strategies')
      .select('*')
      .order('sort_order', { ascending: true });
    if (e) {
      setError(e.message);
      return;
    }
    setRows((data ?? []) as StrategyRow[]);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel('admin-strategies-stream-' + Date.now())
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'strategies' },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const toggle = async (row: StrategyRow, next: boolean) => {
    setBusy((b) => ({ ...b, [row.id]: true }));
    setRows((cur) =>
      cur ? cur.map((r) => (r.id === row.id ? { ...r, enabled: next } : r)) : cur,
    );
    const { error: e } = await supabase
      .from('strategies')
      .update({ enabled: next, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    setBusy((b) => ({ ...b, [row.id]: false }));
    if (e) {
      Alert.alert('Toggle failed', e.message);
      setRows((cur) =>
        cur ? cur.map((r) => (r.id === row.id ? { ...r, enabled: row.enabled } : r)) : cur,
      );
      return;
    }
    await logAdminAction({
      action: 'toggle_strategy',
      tableAffected: 'strategies',
      recordKey: row.id,
      oldValue: { enabled: row.enabled },
      newValue: { enabled: next },
      adminEmail: session?.user.email ?? null,
    });
  };

  if (!rows && !error) return <AdminLoading label="Loading strategies…" />;
  if (error) return <AdminEmpty icon="alert-circle-outline" title="Could not load strategies" hint={error} />;
  if (rows && rows.length === 0) {
    return <AdminEmpty icon="toggle-outline" title="No strategies" hint="Seed strategies table to begin." />;
  }

  return (
    <ScrollView style={listStyles.scroll} contentContainerStyle={listStyles.content}>
      <Text style={styles.intro}>
        Disabled strategies disappear from all client apps within 60 seconds via realtime sync.
      </Text>
      {rows!.map((row) => (
        <AdminCard key={row.id}>
          <View style={listStyles.rowHeader}>
            <View style={{ flex: 1 }}>
              <Text style={listStyles.rowTitle}>{row.display_name}</Text>
              <Text style={listStyles.rowSubtitle}>{row.id}</Text>
            </View>
            <Switch
              value={row.enabled}
              onValueChange={(v) => toggle(row, v)}
              disabled={busy[row.id]}
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
