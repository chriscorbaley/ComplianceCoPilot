import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../../theme';
import { supabase, type ComplianceRuleRow } from '../../services/supabase';
import { useAuth } from '../../auth/AuthContext';
import { logAdminAction } from '../../services/auditLog';
import {
  AdminButton,
  AdminCard,
  AdminEmpty,
  AdminInput,
  AdminLoading,
  listStyles,
} from './_shared';

interface RulesEditorProps {
  prefill?: { ruleKeys: string[]; values: Record<string, string> };
}

export const RulesEditor: React.FC<RulesEditorProps> = ({ prefill }) => {
  const { session } = useAuth();
  const [rows, setRows] = useState<ComplianceRuleRow[] | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const { data, error: e } = await supabase
      .from('compliance_rules')
      .select('*')
      .order('strategy_name', { ascending: true })
      .order('rule_key', { ascending: true });
    if (e) {
      setError(e.message);
      return;
    }
    setRows((data ?? []) as ComplianceRuleRow[]);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel('admin-rules-stream-' + Date.now())
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'compliance_rules' },
        () => {
          load();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!prefill || !rows) return;
    const next: Record<string, string> = {};
    for (const row of rows) {
      if (prefill.ruleKeys.includes(row.rule_key) && prefill.values[row.rule_key] != null) {
        next[row.id] = String(prefill.values[row.rule_key]);
      }
    }
    if (Object.keys(next).length > 0) {
      setEdits((cur) => ({ ...next, ...cur }));
    }
  }, [prefill, rows]);

  const grouped = useMemo(() => {
    if (!rows) return [];
    const map = new Map<string, ComplianceRuleRow[]>();
    for (const r of rows) {
      const arr = map.get(r.strategy_name) ?? [];
      arr.push(r);
      map.set(r.strategy_name, arr);
    }
    return Array.from(map.entries()).map(([strategy, list]) => ({ strategy, list }));
  }, [rows]);

  const saveRow = async (row: ComplianceRuleRow) => {
    const draft = edits[row.id];
    if (draft == null || draft === row.rule_value) return;
    setSaving((s) => ({ ...s, [row.id]: true }));
    const { error: e } = await supabase
      .from('compliance_rules')
      .update({ rule_value: draft, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    setSaving((s) => ({ ...s, [row.id]: false }));
    if (e) {
      Alert.alert('Save failed', e.message);
      return;
    }
    await logAdminAction({
      action: 'update_compliance_rule',
      tableAffected: 'compliance_rules',
      recordKey: row.rule_key,
      oldValue: { rule_value: row.rule_value },
      newValue: { rule_value: draft },
      adminEmail: session?.user.email ?? null,
    });
    setEdits((cur) => {
      const { [row.id]: _drop, ...rest } = cur;
      return rest;
    });
  };

  if (!rows && !error) return <AdminLoading label="Loading compliance rules…" />;
  if (error) return <AdminEmpty icon="alert-circle-outline" title="Could not load rules" hint={error} />;
  if (rows && rows.length === 0) {
    return <AdminEmpty icon="list-outline" title="No compliance rules" hint="Seed the compliance_rules table to begin." />;
  }

  return (
    <ScrollView style={listStyles.scroll} contentContainerStyle={listStyles.content}>
      {prefill && (
        <View style={styles.prefillBanner}>
          <Text style={styles.prefillTitle}>Pre-filled from regulatory alert</Text>
          <Text style={styles.prefillBody}>
            Review the suggested values for {prefill.ruleKeys.join(', ')} and tap Save to apply.
          </Text>
        </View>
      )}

      {grouped.map((g) => (
        <View key={g.strategy} style={styles.group}>
          <Text style={styles.groupHeader}>{g.strategy}</Text>
          {g.list.map((row) => {
            const draft = edits[row.id] ?? row.rule_value;
            const dirty = draft !== row.rule_value;
            return (
              <AdminCard key={row.id} style={styles.ruleCard}>
                <View style={listStyles.rowHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={listStyles.rowTitle}>{row.display_label ?? row.rule_key}</Text>
                    <Text style={listStyles.rowSubtitle}>
                      {row.strategy_name} · {row.rule_key}
                    </Text>
                  </View>
                </View>
                <View style={{ marginTop: spacing.md }}>
                  <AdminInput
                    label="rule_value"
                    value={draft}
                    onChangeText={(t) => setEdits((cur) => ({ ...cur, [row.id]: t }))}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
                <Text style={listStyles.rowMeta}>
                  Updated {new Date(row.updated_at).toLocaleString()}
                </Text>
                <View style={listStyles.rowActions}>
                  <AdminButton
                    label={dirty ? 'Save' : 'Saved'}
                    icon={dirty ? 'cloud-upload-outline' : 'checkmark-outline'}
                    onPress={() => saveRow(row)}
                    disabled={!dirty}
                    loading={saving[row.id]}
                  />
                  {dirty && (
                    <AdminButton
                      label="Reset"
                      variant="ghost"
                      onPress={() =>
                        setEdits((cur) => {
                          const { [row.id]: _drop, ...rest } = cur;
                          return rest;
                        })
                      }
                    />
                  )}
                </View>
              </AdminCard>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  groupHeader: {
    ...typography.caption,
    color: colors.midNavy,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontSize: 11,
    paddingHorizontal: spacing.xs,
  },
  ruleCard: { gap: 0 },
  prefillBanner: {
    backgroundColor: colors.amberLight,
    borderRadius: 12,
    padding: spacing.md,
    gap: 4,
  },
  prefillTitle: {
    ...typography.bodyMedium,
    color: colors.amber,
    fontWeight: '700',
  },
  prefillBody: {
    ...typography.caption,
    color: colors.bodyText,
  },
});
