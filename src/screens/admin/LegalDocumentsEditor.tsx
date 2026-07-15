import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';
import {
  supabase,
  type LegalDocumentRow,
  type LegalDocumentType,
} from '../../services/supabase';
import { formatEffectiveDate } from '../../services/legalDocuments';
import { useAuth } from '../../auth/AuthContext';
import { logAdminAction } from '../../services/auditLog';
import { DateInputField } from '../../components/DateInputField';
import {
  AdminButton,
  AdminCard,
  AdminEmpty,
  AdminInput,
  AdminLoading,
  listStyles,
} from './_shared';

const DOC_META: { type: LegalDocumentType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { type: 'tos', label: 'Terms of Service', icon: 'document-text-outline' },
  { type: 'privacy', label: 'Privacy Policy', icon: 'lock-closed-outline' },
];

// Parse a 'YYYY-MM-DD' date string to a local Date, avoiding the UTC shift a
// bare `new Date('2026-05-23')` would introduce.
const parseISODateLocal = (iso: string | null): Date | null => {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

// Format a Date to 'YYYY-MM-DD' for the Postgres date column.
const toISODate = (d: Date): string => {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
};

interface EditorState {
  type: LegalDocumentType;
  version: string;
  content: string;
  effectiveDate: Date | null;
}

export const LegalDocumentsEditor: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const [rows, setRows] = useState<LegalDocumentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [publishing, setPublishing] = useState(false);

  const load = async () => {
    const { data, error: e } = await supabase
      .from('legal_documents')
      .select('*')
      .order('effective_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (e) {
      setError(e.message);
      return;
    }
    setError(null);
    setRows((data ?? []) as LegalDocumentRow[]);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel('admin-legal-stream-' + Date.now())
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'legal_documents' },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Group rows by type: active row (current) + full history.
  const byType = useMemo(() => {
    const map: Record<LegalDocumentType, { active: LegalDocumentRow | null; history: LegalDocumentRow[] }> = {
      tos: { active: null, history: [] },
      privacy: { active: null, history: [] },
    };
    for (const row of rows ?? []) {
      if (row.document_type !== 'tos' && row.document_type !== 'privacy') continue;
      map[row.document_type].history.push(row);
      if (row.is_active) map[row.document_type].active = row;
    }
    return map;
  }, [rows]);

  const openEditor = (type: LegalDocumentType) => {
    const active = byType[type].active;
    setEditor({
      type,
      version: '',
      content: active?.content ?? '',
      effectiveDate: null,
    });
  };

  const publish = async () => {
    if (!editor) return;
    const version = editor.version.trim();
    const content = editor.content.trim();
    if (!version) {
      Alert.alert('Version required', 'Enter a version number for this document (e.g. 1.1).');
      return;
    }
    if (!content) {
      Alert.alert('Content required', 'The document text cannot be empty.');
      return;
    }
    if (!editor.effectiveDate) {
      Alert.alert('Effective date required', 'Choose an effective date for this version.');
      return;
    }
    // A version string is the key the app compares for re-acceptance — reusing
    // one for the same document type would break that comparison.
    const duplicate = byType[editor.type].history.some((r) => r.version === version);
    if (duplicate) {
      Alert.alert(
        'Version already exists',
        `Version ${version} already exists for this document. Use a new version number.`,
      );
      return;
    }

    const label = DOC_META.find((d) => d.type === editor.type)?.label ?? 'document';
    Alert.alert(
      'Publish new version',
      `Publish version ${version} of the ${label}? It becomes the active version everyone must accept. The previous version is kept in history.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Publish',
          onPress: async () => {
            setPublishing(true);
            try {
              // Deactivate the current active row first so the one-active-per-type
              // unique index stays satisfied, then insert the new active version.
              const { error: deErr } = await supabase
                .from('legal_documents')
                .update({ is_active: false })
                .eq('document_type', editor.type)
                .eq('is_active', true);
              if (deErr) throw deErr;

              const { error: insErr } = await supabase.from('legal_documents').insert({
                document_type: editor.type,
                version,
                content,
                effective_date: toISODate(editor.effectiveDate as Date),
                is_active: true,
              });
              if (insErr) throw insErr;

              const prevActive = byType[editor.type].active;
              await logAdminAction({
                action: 'publish_legal_document',
                tableAffected: 'legal_documents',
                recordKey: `${editor.type}/${version}`,
                oldValue: prevActive
                  ? { version: prevActive.version, effective_date: prevActive.effective_date }
                  : null,
                newValue: {
                  document_type: editor.type,
                  version,
                  effective_date: toISODate(editor.effectiveDate as Date),
                },
                adminEmail: session?.user.email ?? null,
              });

              setEditor(null);
              await load();
              Alert.alert('Published', `Version ${version} is now active.`);
            } catch (err) {
              Alert.alert('Publish failed', err instanceof Error ? err.message : String(err));
            } finally {
              setPublishing(false);
            }
          },
        },
      ],
    );
  };

  return (
    <>
      <ScrollView style={listStyles.scroll} contentContainerStyle={listStyles.content}>
        {!rows && !error && <AdminLoading label="Loading legal documents…" />}
        {error && (
          <AdminEmpty
            icon="alert-circle-outline"
            title="Could not load legal documents"
            hint={error}
          />
        )}

        {rows &&
          DOC_META.map(({ type, label, icon }) => {
            const active = byType[type].active;
            const history = byType[type].history;
            return (
              <AdminCard key={type}>
                <View style={styles.cardHead}>
                  <View style={styles.cardTitleRow}>
                    <Ionicons name={icon} size={18} color={colors.midNavy} />
                    <Text style={listStyles.rowTitle}>{label}</Text>
                  </View>
                </View>

                {active ? (
                  <View style={styles.metaBlock}>
                    <View style={styles.metaRow}>
                      <View style={styles.versionPill}>
                        <Text style={styles.versionPillText}>v{active.version}</Text>
                      </View>
                      <View style={styles.activePill}>
                        <Ionicons name="checkmark-circle" size={12} color={colors.teal} />
                        <Text style={styles.activePillText}>ACTIVE</Text>
                      </View>
                    </View>
                    <Text style={listStyles.rowSubtitle}>
                      {formatEffectiveDate(active.effective_date)}
                    </Text>
                  </View>
                ) : (
                  <Text style={[listStyles.rowSubtitle, { marginTop: spacing.sm }]}>
                    No active version published yet.
                  </Text>
                )}

                <View style={listStyles.rowActions}>
                  <AdminButton
                    label="Edit"
                    icon="create-outline"
                    onPress={() => openEditor(type)}
                  />
                </View>

                {history.length > 0 && (
                  <View style={styles.historyBlock}>
                    <Text style={styles.historyHeader}>Version history</Text>
                    {history.map((row) => (
                      <View key={row.id} style={styles.historyRow}>
                        <Text style={styles.historyVersion}>
                          v{row.version}
                          {row.is_active ? ' · active' : ''}
                        </Text>
                        <Text style={styles.historyDate}>
                          {formatEffectiveDate(row.effective_date).replace('Effective Date: ', '')}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </AdminCard>
            );
          })}
      </ScrollView>

      <Modal
        visible={editor !== null}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setEditor(null)}
      >
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.modalHeader, { paddingTop: insets.top + spacing.sm }]}>
            <TouchableOpacity onPress={() => setEditor(null)} hitSlop={12}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {editor ? DOC_META.find((d) => d.type === editor.type)?.label : ''}
            </Text>
            <View style={{ width: 52 }} />
          </View>

          {editor && (
            <ScrollView
              style={styles.modalBody}
              contentContainerStyle={styles.modalContent}
              keyboardShouldPersistTaps="handled"
            >
              <AdminInput
                label="Version"
                value={editor.version}
                onChangeText={(t) => setEditor({ ...editor, version: t })}
                placeholder="e.g. 1.1"
                autoCapitalize="none"
              />

              <DateInputField
                label="Effective date"
                value={editor.effectiveDate}
                onChange={(d) => setEditor({ ...editor, effectiveDate: d })}
              />

              <Text style={styles.contentLabel}>Document text</Text>
              <TextInput
                value={editor.content}
                onChangeText={(t) => setEditor({ ...editor, content: t })}
                multiline
                textAlignVertical="top"
                style={styles.contentInput}
                placeholder="Full document text…"
                placeholderTextColor={colors.subtleText}
              />

              <View style={{ marginTop: spacing.lg }}>
                <AdminButton
                  label="Publish new version"
                  icon="cloud-upload-outline"
                  onPress={publish}
                  loading={publishing}
                />
                <Text style={styles.publishHint}>
                  Publishing sets this as the active version everyone must accept. The
                  current version is preserved in history and never deleted.
                </Text>
              </View>
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  metaBlock: {
    marginTop: spacing.sm,
    gap: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  versionPill: {
    backgroundColor: colors.lightBlue,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  versionPillText: {
    ...typography.micro,
    color: colors.midNavy,
    fontSize: 11,
    fontWeight: '700',
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.tealLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  activePillText: {
    ...typography.micro,
    color: colors.teal,
    fontSize: 10,
    letterSpacing: 0.5,
  },
  historyBlock: {
    marginTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    paddingTop: spacing.sm,
    gap: 4,
  },
  historyHeader: {
    ...typography.micro,
    color: colors.mutedText,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontSize: 10,
    marginBottom: 2,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  historyVersion: {
    ...typography.caption,
    color: colors.bodyText,
    fontSize: 12,
  },
  historyDate: {
    ...typography.caption,
    color: colors.subtleText,
    fontSize: 12,
  },
  // ── Editor modal ──
  modalRoot: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  modalCancel: {
    ...typography.bodyMedium,
    color: colors.midNavy,
    fontSize: 15,
  },
  modalTitle: {
    ...typography.h3,
    color: colors.bodyText,
    fontSize: 16,
  },
  modalBody: {
    flex: 1,
  },
  modalContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  contentLabel: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  contentInput: {
    ...typography.body,
    color: colors.bodyText,
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    padding: spacing.md,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 320,
  },
  publishHint: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: spacing.sm,
    lineHeight: 17,
  },
});
