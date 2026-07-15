import React, { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';
import { supabase, type RegulatoryAlertRow } from '../../services/supabase';
import { listPendingAlerts } from '../../services/regulatoryAlerts';
import { useAuth } from '../../auth/AuthContext';
import { logAdminAction } from '../../services/auditLog';
import {
  AdminButton,
  AdminCard,
  AdminEmpty,
  AdminLoading,
  SourceTag,
  listStyles,
} from './_shared';

interface RegulatoryAlertsInboxProps {
  onJumpToRules: (ruleKeys: string[], values: Record<string, string>) => void;
}

export const RegulatoryAlertsInbox: React.FC<RegulatoryAlertsInboxProps> = ({
  onJumpToRules,
}) => {
  const { session } = useAuth();
  const [rows, setRows] = useState<RegulatoryAlertRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = async () => {
    try {
      const list = await listPendingAlerts();
      setRows(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    }
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel('admin-alerts-inbox-stream-' + Date.now())
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'regulatory_alerts' },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const approve = async (row: RegulatoryAlertRow) => {
    const ruleKeys = row.affected_rule_keys ?? [];
    const values: Record<string, string> = {};
    if (row.suggested_values && typeof row.suggested_values === 'object') {
      for (const [k, v] of Object.entries(row.suggested_values)) {
        values[k] = String(v);
      }
    }
    setBusy((b) => ({ ...b, [row.id]: true }));
    const { error: e } = await supabase
      .from('regulatory_alerts')
      .update({
        status: 'approved',
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    setBusy((b) => ({ ...b, [row.id]: false }));
    if (e) {
      Alert.alert('Approve failed', e.message);
      return;
    }
    await logAdminAction({
      action: 'approve_regulatory_alert',
      tableAffected: 'regulatory_alerts',
      recordKey: row.id,
      oldValue: { status: row.status },
      newValue: { status: 'approved' },
      adminEmail: session?.user.email ?? null,
    });
    onJumpToRules(ruleKeys, values);
  };

  const dismiss = async (row: RegulatoryAlertRow) => {
    Alert.alert(
      'Dismiss alert',
      `Mark "${row.document_title ?? 'this alert'}" as dismissed?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Dismiss',
          style: 'destructive',
          onPress: async () => {
            setBusy((b) => ({ ...b, [row.id]: true }));
            const { error: e } = await supabase
              .from('regulatory_alerts')
              .update({
                status: 'dismissed',
                reviewed_at: new Date().toISOString(),
              })
              .eq('id', row.id);
            setBusy((b) => ({ ...b, [row.id]: false }));
            if (e) {
              Alert.alert('Dismiss failed', e.message);
              return;
            }
            await logAdminAction({
              action: 'dismiss_regulatory_alert',
              tableAffected: 'regulatory_alerts',
              recordKey: row.id,
              oldValue: { status: row.status },
              newValue: { status: 'dismissed' },
              adminEmail: session?.user.email ?? null,
            });
          },
        },
      ],
    );
  };

  const openUrl = (url: string | null) => {
    if (!url) return;
    Linking.openURL(url).catch(() => Alert.alert('Could not open link', url));
  };

  if (!rows && !error) return <AdminLoading label="Loading regulatory alerts…" />;
  if (error) {
    return <AdminEmpty icon="alert-circle-outline" title="Could not load alerts" hint={error} />;
  }
  if (rows && rows.length === 0) {
    return (
      <AdminEmpty
        icon="checkmark-done-outline"
        title="Inbox zero"
        hint="No regulatory alerts pending review."
      />
    );
  }

  return (
    <ScrollView style={listStyles.scroll} contentContainerStyle={listStyles.content}>
      {rows!.map((row) => {
        const suggested = row.suggested_values && typeof row.suggested_values === 'object'
          ? Object.entries(row.suggested_values)
          : [];
        return (
          <AdminCard key={row.id}>
            <View style={styles.topRow}>
              <SourceTag source={row.source} />
              <Text style={styles.date}>
                {row.published_date ?? new Date(row.created_at).toLocaleDateString()}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => openUrl(row.document_url)}
              disabled={!row.document_url}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.title,
                  row.document_url ? styles.titleLink : null,
                ]}
              >
                {row.document_title ?? 'Untitled document'}
                {row.document_url ? (
                  <Text>  <Ionicons name="open-outline" size={13} color={colors.midNavy} /></Text>
                ) : null}
              </Text>
            </TouchableOpacity>

            {row.ai_summary ? (
              <Text style={styles.summary}>{row.ai_summary}</Text>
            ) : null}

            {(row.affected_strategies?.length ?? 0) > 0 && (
              <View style={styles.metaSection}>
                <Text style={styles.metaLabel}>Affected strategies</Text>
                <View style={styles.chipRow}>
                  {row.affected_strategies!.map((s) => (
                    <View key={s} style={styles.chip}>
                      <Text style={styles.chipText}>{s}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {(row.affected_rule_keys?.length ?? 0) > 0 && (
              <View style={styles.metaSection}>
                <Text style={styles.metaLabel}>Affected rule keys</Text>
                <View style={styles.chipRow}>
                  {row.affected_rule_keys!.map((k) => (
                    <View key={k} style={[styles.chip, styles.chipAmber]}>
                      <Text style={[styles.chipText, styles.chipTextAmber]}>{k}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {suggested.length > 0 && (
              <View style={styles.metaSection}>
                <Text style={styles.metaLabel}>Suggested values</Text>
                <View style={styles.kvBlock}>
                  {suggested.map(([k, v]) => (
                    <View key={k} style={styles.kvRow}>
                      <Text style={styles.kvKey}>{k}</Text>
                      <Text style={styles.kvVal}>{String(v)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            <View style={[listStyles.rowActions, { marginTop: spacing.lg }]}>
              <AdminButton
                label="Approve"
                icon="checkmark-circle-outline"
                onPress={() => approve(row)}
                loading={busy[row.id]}
              />
              <AdminButton
                label="Dismiss"
                variant="danger"
                icon="close-circle-outline"
                onPress={() => dismiss(row)}
                loading={busy[row.id]}
              />
            </View>
          </AdminCard>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  date: {
    ...typography.micro,
    color: colors.subtleText,
    fontSize: 10,
    letterSpacing: 0.5,
  },
  title: {
    ...typography.h3,
    color: colors.bodyText,
    fontSize: 15,
    marginTop: spacing.sm,
  },
  titleLink: { color: colors.midNavy, textDecorationLine: 'underline' },
  summary: {
    ...typography.body,
    color: colors.bodyText,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.sm,
  },
  metaSection: { marginTop: spacing.md, gap: 6 },
  metaLabel: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.lightBlue,
  },
  chipAmber: { backgroundColor: colors.amberLight },
  chipText: {
    ...typography.micro,
    color: colors.midNavy,
    fontSize: 11,
  },
  chipTextAmber: { color: colors.amber },
  kvBlock: {
    backgroundColor: colors.background,
    borderRadius: radius.card,
    padding: spacing.sm,
    gap: 4,
  },
  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  kvKey: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 12,
  },
  kvVal: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 13,
    fontWeight: '700',
  },
});
