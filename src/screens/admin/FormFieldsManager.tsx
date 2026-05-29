import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';
import { supabase, type FormFieldRow, type StrategyRow } from '../../services/supabase';
import {
  AdminButton,
  AdminCard,
  AdminEmpty,
  AdminInput,
  AdminLoading,
  listStyles,
} from './_shared';

interface FieldDraft {
  field_key: string;
  field_label: string;
  field_type: string;
  required: boolean;
}

const EMPTY_DRAFT: FieldDraft = {
  field_key: '',
  field_label: '',
  field_type: 'text',
  required: false,
};

export const FormFieldsManager: React.FC = () => {
  const [strategies, setStrategies] = useState<StrategyRow[]>([]);
  const [rows, setRows] = useState<FormFieldRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeStrategy, setActiveStrategy] = useState<string | null>(null);
  const [draft, setDraft] = useState<FieldDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = async () => {
    const [stratRes, fieldsRes] = await Promise.all([
      supabase.from('strategies').select('*').order('sort_order', { ascending: true }),
      supabase
        .from('form_fields')
        .select('*')
        .order('strategy_name', { ascending: true })
        .order('sort_order', { ascending: true }),
    ]);
    if (stratRes.error) {
      setError(stratRes.error.message);
      return;
    }
    if (fieldsRes.error) {
      setError(fieldsRes.error.message);
      return;
    }
    const strats = (stratRes.data ?? []) as StrategyRow[];
    setStrategies(strats);
    setRows((fieldsRes.data ?? []) as FormFieldRow[]);
    if (!activeStrategy && strats.length > 0) {
      setActiveStrategy(strats[0].id);
    }
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel('admin-fields-stream-' + Date.now())
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'form_fields' },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fieldsForActive = useMemo(() => {
    if (!rows || !activeStrategy) return [];
    return rows
      .filter((r) => r.strategy_name === activeStrategy)
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [rows, activeStrategy]);

  const move = async (row: FormFieldRow, direction: -1 | 1) => {
    const sibs = fieldsForActive;
    const idx = sibs.findIndex((r) => r.id === row.id);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= sibs.length) return;
    const other = sibs[swapIdx];
    setBusy((b) => ({ ...b, [row.id]: true, [other.id]: true }));
    const [r1, r2] = await Promise.all([
      supabase
        .from('form_fields')
        .update({ sort_order: other.sort_order, updated_at: new Date().toISOString() })
        .eq('id', row.id),
      supabase
        .from('form_fields')
        .update({ sort_order: row.sort_order, updated_at: new Date().toISOString() })
        .eq('id', other.id),
    ]);
    setBusy((b) => ({ ...b, [row.id]: false, [other.id]: false }));
    if (r1.error || r2.error) {
      Alert.alert('Reorder failed', r1.error?.message ?? r2.error?.message ?? 'Unknown error');
    }
  };

  const removeField = async (row: FormFieldRow) => {
    Alert.alert(
      'Remove field',
      `Remove "${row.field_label}" from ${row.strategy_name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setBusy((b) => ({ ...b, [row.id]: true }));
            const { error: e } = await supabase
              .from('form_fields')
              .delete()
              .eq('id', row.id);
            setBusy((b) => ({ ...b, [row.id]: false }));
            if (e) Alert.alert('Remove failed', e.message);
          },
        },
      ],
    );
  };

  const addField = async () => {
    if (!activeStrategy) return;
    const key = draft.field_key.trim();
    const label = draft.field_label.trim();
    if (!key || !label) {
      Alert.alert('Missing values', 'Field key and label are required.');
      return;
    }
    const maxSort = fieldsForActive.reduce((m, f) => Math.max(m, f.sort_order), 0);
    setBusy((b) => ({ ...b, __add__: true }));
    const { error: e } = await supabase.from('form_fields').insert({
      strategy_name: activeStrategy,
      field_key: key,
      field_label: label,
      field_type: draft.field_type || 'text',
      required: draft.required,
      sort_order: maxSort + 1,
    });
    setBusy((b) => ({ ...b, __add__: false }));
    if (e) {
      Alert.alert('Add failed', e.message);
      return;
    }
    setDraft(EMPTY_DRAFT);
  };

  if (!rows && !error) return <AdminLoading label="Loading form fields…" />;
  if (error) return <AdminEmpty icon="alert-circle-outline" title="Could not load form fields" hint={error} />;

  return (
    <ScrollView style={listStyles.scroll} contentContainerStyle={listStyles.content}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillRow}
      >
        {strategies.map((s) => {
          const active = s.id === activeStrategy;
          return (
            <TouchableOpacity
              key={s.id}
              onPress={() => setActiveStrategy(s.id)}
              activeOpacity={0.85}
              style={[styles.pill, active && styles.pillActive]}
            >
              <Text style={[styles.pillText, active && styles.pillTextActive]}>
                {s.display_name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <AdminCard>
        <Text style={listStyles.rowTitle}>Add field</Text>
        <Text style={listStyles.rowSubtitle}>
          New fields appear immediately for clients on this strategy.
        </Text>
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          <AdminInput
            label="Field key (machine name)"
            value={draft.field_key}
            onChangeText={(t) => setDraft((d) => ({ ...d, field_key: t }))}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="e.g. property_address"
          />
          <AdminInput
            label="Field label"
            value={draft.field_label}
            onChangeText={(t) => setDraft((d) => ({ ...d, field_label: t }))}
            placeholder="e.g. Property address"
          />
          <AdminInput
            label="Field type"
            value={draft.field_type}
            onChangeText={(t) => setDraft((d) => ({ ...d, field_type: t }))}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="text | number | date | boolean"
          />
          <View style={styles.requiredRow}>
            <Text style={styles.requiredLabel}>Required</Text>
            <Switch
              value={draft.required}
              onValueChange={(v) => setDraft((d) => ({ ...d, required: v }))}
            />
          </View>
          <View style={listStyles.rowActions}>
            <AdminButton
              label="Add field"
              icon="add-outline"
              onPress={addField}
              loading={busy.__add__}
            />
          </View>
        </View>
      </AdminCard>

      <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
        <Text style={styles.groupHeader}>
          {fieldsForActive.length} field{fieldsForActive.length === 1 ? '' : 's'}
        </Text>
        {fieldsForActive.map((row, i) => (
          <AdminCard key={row.id} style={styles.fieldCard}>
            <View style={listStyles.rowHeader}>
              <View style={{ flex: 1 }}>
                <Text style={listStyles.rowTitle}>{row.field_label}</Text>
                <Text style={listStyles.rowSubtitle}>
                  {row.field_key} · {row.field_type}
                  {row.required ? ' · required' : ''}
                </Text>
              </View>
              <View style={styles.orderControls}>
                <TouchableOpacity
                  onPress={() => move(row, -1)}
                  disabled={i === 0 || busy[row.id]}
                  style={[styles.orderBtn, i === 0 && styles.orderBtnDisabled]}
                  hitSlop={8}
                >
                  <Ionicons name="chevron-up" size={16} color={colors.midNavy} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => move(row, 1)}
                  disabled={i === fieldsForActive.length - 1 || busy[row.id]}
                  style={[
                    styles.orderBtn,
                    i === fieldsForActive.length - 1 && styles.orderBtnDisabled,
                  ]}
                  hitSlop={8}
                >
                  <Ionicons name="chevron-down" size={16} color={colors.midNavy} />
                </TouchableOpacity>
              </View>
            </View>
            <View style={listStyles.rowActions}>
              <AdminButton
                label="Remove"
                variant="danger"
                icon="trash-outline"
                onPress={() => removeField(row)}
                loading={busy[row.id]}
              />
            </View>
          </AdminCard>
        ))}
        {fieldsForActive.length === 0 && (
          <Text style={styles.emptyHint}>No fields yet for this strategy.</Text>
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  pillRow: {
    paddingVertical: spacing.xs,
    gap: spacing.sm,
  },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.lightBlue,
  },
  pillActive: { backgroundColor: colors.midNavy },
  pillText: {
    ...typography.caption,
    color: colors.midNavy,
    fontSize: 12,
    fontWeight: '600',
  },
  pillTextActive: { color: colors.white },
  groupHeader: {
    ...typography.caption,
    color: colors.midNavy,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontSize: 11,
    paddingHorizontal: spacing.xs,
  },
  fieldCard: { gap: 0 },
  requiredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.xs,
  },
  requiredLabel: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  orderControls: { flexDirection: 'row', gap: 6 },
  orderBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.lightBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderBtnDisabled: { opacity: 0.4 },
  emptyHint: {
    ...typography.caption,
    color: colors.mutedText,
    textAlign: 'center',
    padding: spacing.lg,
  },
});
