import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../../theme';
import { supabase, type AnnouncementRow } from '../../services/supabase';
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

export const AnnouncementPublisher: React.FC = () => {
  const { session } = useAuth();
  const [rows, setRows] = useState<AnnouncementRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [publishing, setPublishing] = useState(false);

  const load = async () => {
    const { data, error: e } = await supabase
      .from('announcements')
      .select('*')
      .order('published_at', { ascending: false })
      .limit(20);
    if (e) {
      setError(e.message);
      return;
    }
    setRows((data ?? []) as AnnouncementRow[]);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel('admin-announce-stream-' + Date.now())
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'announcements' },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const publish = async () => {
    const msg = draft.trim();
    if (!msg) {
      Alert.alert('Empty message', 'Type a message before publishing.');
      return;
    }
    setPublishing(true);
    const { error: e } = await supabase.from('announcements').insert({
      message: msg,
      published_at: new Date().toISOString(),
    });
    setPublishing(false);
    if (e) {
      Alert.alert('Publish failed', e.message);
      return;
    }
    await logAdminAction({
      action: 'publish_announcement',
      tableAffected: 'announcements',
      recordKey: msg.slice(0, 80),
      oldValue: null,
      newValue: { message: msg },
      adminEmail: session?.user.email ?? null,
    });
    setDraft('');
    Alert.alert('Published', 'All active client sessions will see this within 60 seconds.');
  };

  const removeOne = async (row: AnnouncementRow) => {
    Alert.alert('Remove announcement', 'Remove this announcement?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const { error: e } = await supabase
            .from('announcements')
            .delete()
            .eq('id', row.id);
          if (e) {
            Alert.alert('Remove failed', e.message);
            return;
          }
          await logAdminAction({
            action: 'delete_announcement',
            tableAffected: 'announcements',
            recordKey: row.id,
            oldValue: { message: row.message },
            newValue: null,
            adminEmail: session?.user.email ?? null,
          });
        },
      },
    ]);
  };

  return (
    <ScrollView style={listStyles.scroll} contentContainerStyle={listStyles.content}>
      <AdminCard>
        <Text style={listStyles.rowTitle}>New announcement</Text>
        <Text style={listStyles.rowSubtitle}>
          Pushed to all active client sessions via realtime within 60 seconds.
        </Text>
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          <AdminInput
            label="Message"
            value={draft}
            onChangeText={setDraft}
            multiline
            style={styles.bigInput}
            textAlignVertical="top"
            placeholder="e.g. New IRS regulation goes into effect Jan 1 — review S-Corp salaries."
          />
          <View style={listStyles.rowActions}>
            <AdminButton
              label="Publish"
              icon="megaphone-outline"
              onPress={publish}
              loading={publishing}
              disabled={!draft.trim()}
            />
          </View>
        </View>
      </AdminCard>

      <Text style={styles.groupHeader}>Recent announcements</Text>
      {!rows && !error && <AdminLoading label="Loading…" />}
      {error && (
        <AdminEmpty icon="alert-circle-outline" title="Could not load announcements" hint={error} />
      )}
      {rows && rows.length === 0 && (
        <AdminEmpty icon="megaphone-outline" title="No announcements yet" hint="Publish one above to get started." />
      )}
      {rows?.map((row) => (
        <AdminCard key={row.id}>
          <Text style={styles.msg}>{row.message}</Text>
          <Text style={listStyles.rowMeta}>
            Published {new Date(row.published_at).toLocaleString()}
          </Text>
          <View style={listStyles.rowActions}>
            <AdminButton
              label="Remove"
              variant="danger"
              icon="trash-outline"
              onPress={() => removeOne(row)}
            />
          </View>
        </AdminCard>
      ))}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  bigInput: { minHeight: 90, fontSize: 14, lineHeight: 20 },
  groupHeader: {
    ...typography.caption,
    color: colors.midNavy,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontSize: 11,
    paddingHorizontal: spacing.xs,
    marginTop: spacing.md,
  },
  msg: {
    ...typography.body,
    color: colors.bodyText,
    fontSize: 14,
    lineHeight: 20,
  },
});
