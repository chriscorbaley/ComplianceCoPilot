import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, radius, spacing, typography } from '../../theme';
import { useAuth } from '../../auth/AuthContext';
import {
  fetchAllAppContent,
  updateAppContent,
  GROUP_LABELS,
  GROUP_ORDER,
  type AppContentGroup,
  type AppContentRow,
} from '../../services/appContent';
import {
  AdminButton,
  AdminCard,
  AdminEmpty,
  AdminLoading,
  listStyles,
} from './_shared';

// Editable onboarding & marketing copy (app_content table). Rows are grouped by
// screen (content_type) and edited inline. Legal text, pricing, compliance rule
// text, and email templates are intentionally NOT here — they have their own
// editors.
export const AppContentEditor: React.FC = () => {
  const { session } = useAuth();
  const [rows, setRows] = useState<AppContentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Per-key working draft and in-flight save flag.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await fetchAllAppContent();
      setError(null);
      setRows(data);
      setDrafts(Object.fromEntries(data.map((r) => [r.content_key, r.content_value])));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Group rows by content_type in the defined display order. Any unexpected
  // group value falls through to the end so nothing is silently hidden.
  const grouped = useMemo(() => {
    if (!rows) return [];
    const byGroup = new Map<string, AppContentRow[]>();
    for (const r of rows) {
      const list = byGroup.get(r.content_type) ?? [];
      list.push(r);
      byGroup.set(r.content_type, list);
    }
    const ordered: { group: string; label: string; items: AppContentRow[] }[] = [];
    for (const g of GROUP_ORDER) {
      const items = byGroup.get(g);
      if (items?.length) {
        ordered.push({ group: g, label: GROUP_LABELS[g], items });
        byGroup.delete(g);
      }
    }
    // Anything not in GROUP_ORDER (future groups) still shown, labelled by key.
    for (const [group, items] of byGroup) {
      ordered.push({ group, label: GROUP_LABELS[group as AppContentGroup] ?? group, items });
    }
    return ordered;
  }, [rows]);

  const save = async (row: AppContentRow) => {
    const value = drafts[row.content_key] ?? '';
    if (!value.trim()) {
      Alert.alert('Value required', 'Content cannot be empty. Enter some text before saving.');
      return;
    }
    setSavingKey(row.content_key);
    try {
      await updateAppContent(row.content_key, value, session?.user.email ?? null);
      // Reflect the saved value locally without a full refetch.
      setRows((prev) =>
        prev
          ? prev.map((r) =>
              r.content_key === row.content_key ? { ...r, content_value: value } : r,
            )
          : prev,
      );
      Alert.alert('Saved', 'This copy is updated. It appears the next time the screen loads.');
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : String(e));
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <ScrollView style={listStyles.scroll} contentContainerStyle={listStyles.content}>
      {!rows && !error && <AdminLoading label="Loading app content…" />}

      {error && (
        <AdminEmpty
          icon="alert-circle-outline"
          title="Could not load app content"
          hint={error}
        />
      )}

      {rows && rows.length === 0 && !error && (
        <AdminEmpty
          icon="document-text-outline"
          title="No app content found"
          hint="Run seed_app_content.sql in Supabase to populate the app_content table."
        />
      )}

      {grouped.map((section) => (
        <View key={section.group} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.label}</Text>

          {section.items.map((row) => {
            const draft = drafts[row.content_key] ?? '';
            const dirty = draft !== row.content_value;
            const saving = savingKey === row.content_key;
            return (
              <AdminCard key={row.content_key} style={styles.card}>
                {row.description ? (
                  <Text style={styles.description}>{row.description}</Text>
                ) : null}
                <View style={styles.keyPill}>
                  <Text style={styles.keyPillText}>{row.content_key}</Text>
                </View>

                <TextInput
                  value={draft}
                  onChangeText={(t) =>
                    setDrafts((prev) => ({ ...prev, [row.content_key]: t }))
                  }
                  multiline
                  textAlignVertical="top"
                  style={styles.input}
                  placeholder="Enter copy…"
                  placeholderTextColor={colors.subtleText}
                />

                <View style={styles.footerRow}>
                  <Text style={styles.charCount}>{draft.length} characters</Text>
                  <AdminButton
                    label={dirty ? 'Save' : 'Saved'}
                    icon={dirty ? 'save-outline' : 'checkmark'}
                    onPress={() => save(row)}
                    disabled={!dirty}
                    loading={saving}
                    style={styles.saveBtn}
                  />
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
  section: { gap: spacing.md },
  sectionTitle: {
    ...typography.h3,
    color: colors.bodyText,
    fontSize: 15,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  card: { gap: spacing.sm },
  description: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
  },
  keyPill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.lightBlue,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  keyPillText: {
    ...typography.micro,
    color: colors.midNavy,
    fontSize: 10,
    fontWeight: '700',
  },
  input: {
    ...typography.body,
    color: colors.bodyText,
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    padding: spacing.md,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 72,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  charCount: {
    ...typography.caption,
    color: colors.subtleText,
    fontSize: 11,
  },
  saveBtn: { paddingHorizontal: spacing.lg },
});
