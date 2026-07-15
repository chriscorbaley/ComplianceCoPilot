import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../../theme';
import { supabase, type IrcReferenceRow } from '../../services/supabase';
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

interface Draft {
  irc_section?: string;
  citation?: string;
}

export const IrcReferencesEditor: React.FC = () => {
  const { session } = useAuth();
  const [rows, setRows] = useState<IrcReferenceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const load = async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    console.log('[IrcReferencesEditor] auth before query', {
      hasSession: !!sessionData.session,
      userId: sessionData.session?.user?.id ?? null,
      role: sessionData.session?.user?.role ?? null,
      tokenExpiresAt: sessionData.session?.expires_at ?? null,
    });

    const response = await supabase
      .from('irc_references')
      .select('*')
      .order('strategy_name', { ascending: true })
      .order('irc_section', { ascending: true });
    const { data, error: e, status, statusText, count } = response;
    console.log('[IrcReferencesEditor] query response', {
      status,
      statusText,
      count,
      rowsReturned: data?.length ?? 0,
      error: e,
      fullResponse: response,
    });
    if (e) {
      console.log('[IrcReferencesEditor] supabase error object', {
        message: e.message,
        code: (e as { code?: string }).code,
        details: (e as { details?: string }).details,
        hint: (e as { hint?: string }).hint,
        name: e.name,
        stack: e.stack,
      });
      setError(e.message);
      return;
    }
    setRows((data ?? []) as IrcReferenceRow[]);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel('admin-irc-stream-' + Date.now())
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'irc_references' },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const grouped = useMemo(() => {
    if (!rows) return [];
    const map = new Map<string, IrcReferenceRow[]>();
    for (const r of rows) {
      const arr = map.get(r.strategy_name) ?? [];
      arr.push(r);
      map.set(r.strategy_name, arr);
    }
    return Array.from(map.entries()).map(([strategy, list]) => ({ strategy, list }));
  }, [rows]);

  const draftFor = (row: IrcReferenceRow) => {
    const d = drafts[row.id] ?? {};
    return {
      irc_section: d.irc_section ?? row.irc_section,
      citation: d.citation ?? row.citation,
    };
  };

  const isDirty = (row: IrcReferenceRow): boolean => {
    const d = draftFor(row);
    return d.irc_section !== row.irc_section || d.citation !== row.citation;
  };

  const save = async (row: IrcReferenceRow) => {
    const d = draftFor(row);
    if (!d.irc_section.trim()) {
      Alert.alert('Missing value', 'IRC section is required.');
      return;
    }
    setSaving((s) => ({ ...s, [row.id]: true }));
    const { error: e } = await supabase
      .from('irc_references')
      .update({
        irc_section: d.irc_section.trim(),
        citation: d.citation,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    setSaving((s) => ({ ...s, [row.id]: false }));
    if (e) {
      Alert.alert('Save failed', e.message);
      return;
    }
    await logAdminAction({
      action: 'update_irc_reference',
      tableAffected: 'irc_references',
      recordKey: row.id,
      oldValue: { irc_section: row.irc_section, citation: row.citation },
      newValue: { irc_section: d.irc_section.trim(), citation: d.citation },
      adminEmail: session?.user.email ?? null,
    });
    setDrafts((cur) => {
      const { [row.id]: _drop, ...rest } = cur;
      return rest;
    });
  };

  if (!rows && !error) return <AdminLoading label="Loading IRC references…" />;
  if (error) return <AdminEmpty icon="alert-circle-outline" title="Could not load references" hint={error} />;
  if (rows && rows.length === 0) {
    return <AdminEmpty icon="book-outline" title="No IRC references" hint="Seed irc_references to begin." />;
  }

  return (
    <ScrollView style={listStyles.scroll} contentContainerStyle={listStyles.content}>
      {grouped.map((g) => (
        <View key={g.strategy} style={styles.group}>
          <Text style={styles.groupHeader}>{g.strategy}</Text>
          {g.list.map((row) => {
            const d = draftFor(row);
            const dirty = isDirty(row);
            return (
              <AdminCard key={row.id}>
                <View style={listStyles.rowHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={listStyles.rowTitle}>
                      {row.display_label ?? row.irc_section}
                    </Text>
                  </View>
                </View>
                <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
                  <AdminInput
                    label="IRC section"
                    value={d.irc_section}
                    onChangeText={(t) =>
                      setDrafts((cur) => ({
                        ...cur,
                        [row.id]: { ...(cur[row.id] ?? {}), irc_section: t },
                      }))
                    }
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <AdminInput
                    label="Citation"
                    value={d.citation}
                    onChangeText={(t) =>
                      setDrafts((cur) => ({
                        ...cur,
                        [row.id]: { ...(cur[row.id] ?? {}), citation: t },
                      }))
                    }
                    multiline
                    style={styles.bigInput}
                    textAlignVertical="top"
                  />
                </View>
                <Text style={listStyles.rowMeta}>
                  Updated {new Date(row.updated_at).toLocaleString()}
                </Text>
                <View style={listStyles.rowActions}>
                  <AdminButton
                    label={dirty ? 'Save' : 'Saved'}
                    icon={dirty ? 'cloud-upload-outline' : 'checkmark-outline'}
                    onPress={() => save(row)}
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
  bigInput: { minHeight: 70, fontSize: 13, lineHeight: 18 },
});
