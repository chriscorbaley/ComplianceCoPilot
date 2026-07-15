import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';
import { supabase, type DocumentTemplateRow } from '../../services/supabase';
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

export const TemplatesEditor: React.FC = () => {
  const { session } = useAuth();
  const [rows, setRows] = useState<DocumentTemplateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const load = async () => {
    const { data, error: e } = await supabase
      .from('document_templates')
      .select('*')
      .order('strategy_name', { ascending: true })
      .order('template_key', { ascending: true });
    if (e) {
      setError(e.message);
      return;
    }
    setRows((data ?? []) as DocumentTemplateRow[]);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel('admin-templates-stream-' + Date.now())
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'document_templates' },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const grouped = useMemo(() => {
    if (!rows) return [];
    const map = new Map<string, DocumentTemplateRow[]>();
    for (const r of rows) {
      const arr = map.get(r.strategy_name) ?? [];
      arr.push(r);
      map.set(r.strategy_name, arr);
    }
    return Array.from(map.entries()).map(([strategy, list]) => ({ strategy, list }));
  }, [rows]);

  const saveRow = async (row: DocumentTemplateRow) => {
    const draft = drafts[row.id];
    if (draft == null || draft === row.template_content) return;
    setSaving((s) => ({ ...s, [row.id]: true }));
    const { error: e } = await supabase
      .from('document_templates')
      .update({ template_content: draft, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    setSaving((s) => ({ ...s, [row.id]: false }));
    if (e) {
      Alert.alert('Save failed', e.message);
      return;
    }
    await logAdminAction({
      action: 'update_document_template',
      tableAffected: 'document_templates',
      recordKey: row.template_key,
      oldValue: { template_content: row.template_content },
      newValue: { template_content: draft },
      adminEmail: session?.user.email ?? null,
    });
    setDrafts((cur) => {
      const { [row.id]: _drop, ...rest } = cur;
      return rest;
    });
  };

  if (!rows && !error) return <AdminLoading label="Loading templates…" />;
  if (error) return <AdminEmpty icon="alert-circle-outline" title="Could not load templates" hint={error} />;
  if (rows && rows.length === 0) {
    return <AdminEmpty icon="document-text-outline" title="No templates" hint="Seed the document_templates table to begin." />;
  }

  return (
    <ScrollView style={listStyles.scroll} contentContainerStyle={listStyles.content}>
      {grouped.map((g) => (
        <View key={g.strategy} style={styles.group}>
          <Text style={styles.groupHeader}>{g.strategy}</Text>
          {g.list.map((row) => {
            const isOpen = expandedId === row.id;
            const draft = drafts[row.id] ?? row.template_content;
            const dirty = draft !== row.template_content;
            return (
              <AdminCard key={row.id} style={styles.tplCard}>
                <TouchableOpacity
                  onPress={() => setExpandedId(isOpen ? null : row.id)}
                  activeOpacity={0.85}
                  style={listStyles.rowHeader}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={listStyles.rowTitle}>
                      {row.display_label ?? row.template_key}
                    </Text>
                    <Text style={listStyles.rowSubtitle}>
                      {row.template_key} · {row.template_content.length} chars
                    </Text>
                  </View>
                  <Ionicons
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={colors.mutedText}
                  />
                </TouchableOpacity>
                {isOpen && (
                  <View style={{ marginTop: spacing.md }}>
                    <AdminInput
                      label="Template content"
                      value={draft}
                      onChangeText={(t) => setDrafts((cur) => ({ ...cur, [row.id]: t }))}
                      multiline
                      style={styles.bigInput}
                      textAlignVertical="top"
                    />
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
                            setDrafts((cur) => {
                              const { [row.id]: _drop, ...rest } = cur;
                              return rest;
                            })
                          }
                        />
                      )}
                    </View>
                  </View>
                )}
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
  tplCard: { gap: 0 },
  bigInput: {
    minHeight: 180,
    fontFamily: 'Courier',
    fontSize: 12,
    lineHeight: 18,
    borderRadius: radius.card,
  },
});
