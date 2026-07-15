import React, { useEffect, useState } from 'react';
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
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { colors, radius, spacing, typography } from '../../theme';
import { useAuth } from '../../auth/AuthContext';
import type { EmailTemplateKey } from '../../services/supabase';
import {
  fetchAllEmailTemplates,
  updateEmailTemplate,
  renderTemplate,
  sampleVariables,
  type EmailTemplate,
} from '../../services/emailTemplates';
import {
  AdminButton,
  AdminCard,
  AdminEmpty,
  AdminInput,
  AdminLoading,
  listStyles,
} from './_shared';

// Human-friendly labels for each seeded template key.
const TEMPLATE_LABELS: Record<EmailTemplateKey, string> = {
  welcome: 'Welcome / Trial Started',
  verification: 'Email Verification',
  deletion_warning: 'Deletion Warning',
  cancellation_confirm: 'Cancellation Confirmation',
};

const TEMPLATE_ICONS: Record<EmailTemplateKey, keyof typeof Ionicons.glyphMap> = {
  welcome: 'sparkles-outline',
  verification: 'checkmark-circle-outline',
  deletion_warning: 'warning-outline',
  cancellation_confirm: 'close-circle-outline',
};

// Which text field last held the cursor, so a tapped variable chip inserts into
// the right place.
type FocusedField = 'subject' | 'body';

interface EditorState {
  template_key: EmailTemplateKey;
  subject: string;
  body_html: string;
  available_variables: string[];
}

const toEditor = (t: EmailTemplate): EditorState => ({
  template_key: t.template_key,
  subject: t.subject,
  body_html: t.body_html,
  available_variables: t.available_variables,
});

export const EmailTemplatesEditor: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const [templates, setTemplates] = useState<EmailTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);

  // Cursor tracking for variable-chip insertion.
  const [focused, setFocused] = useState<FocusedField>('body');
  const [subjectSel, setSubjectSel] = useState({ start: 0, end: 0 });
  const [bodySel, setBodySel] = useState({ start: 0, end: 0 });

  // Rendered-with-sample-data HTML shown in the preview modal (null = closed).
  const [preview, setPreview] = useState<{ subject: string; bodyHtml: string } | null>(null);

  const load = async () => {
    try {
      const rows = await fetchAllEmailTemplates();
      setError(null);
      setTemplates(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openEditor = (t: EmailTemplate) => {
    setFocused('body');
    setSubjectSel({ start: t.subject.length, end: t.subject.length });
    setBodySel({ start: t.body_html.length, end: t.body_html.length });
    setEditor(toEditor(t));
  };

  // Insert `{variable}` into whichever field currently holds the cursor.
  const insertVariable = (variable: string) => {
    if (!editor) return;
    const token = `{${variable}}`;
    if (focused === 'subject') {
      const { start, end } = subjectSel;
      const next = editor.subject.slice(0, start) + token + editor.subject.slice(end);
      const pos = start + token.length;
      setEditor({ ...editor, subject: next });
      setSubjectSel({ start: pos, end: pos });
    } else {
      const { start, end } = bodySel;
      const next = editor.body_html.slice(0, start) + token + editor.body_html.slice(end);
      const pos = start + token.length;
      setEditor({ ...editor, body_html: next });
      setBodySel({ start: pos, end: pos });
    }
  };

  const onSubjectSelectionChange = (
    e: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
  ) => setSubjectSel(e.nativeEvent.selection);

  const onBodySelectionChange = (
    e: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
  ) => setBodySel(e.nativeEvent.selection);

  const openPreview = () => {
    if (!editor) return;
    const rendered = renderTemplate(
      { subject: editor.subject, body_html: editor.body_html },
      sampleVariables(editor.available_variables),
    );
    setPreview({ subject: rendered.subject, bodyHtml: rendered.bodyHtml });
  };

  const save = async () => {
    if (!editor) return;
    const subject = editor.subject.trim();
    const body = editor.body_html.trim();
    if (!subject) {
      Alert.alert('Subject required', 'Enter a subject line for this email.');
      return;
    }
    if (!body) {
      Alert.alert('Body required', 'The email body cannot be empty.');
      return;
    }
    setSaving(true);
    try {
      await updateEmailTemplate(
        editor.template_key,
        subject,
        body,
        session?.user.email ?? null,
      );
      setEditor(null);
      await load();
      Alert.alert(
        'Saved',
        `${TEMPLATE_LABELS[editor.template_key]} template updated. It will be used the next time this email is sent.`,
      );
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ScrollView style={listStyles.scroll} contentContainerStyle={listStyles.content}>
        {!templates && !error && <AdminLoading label="Loading email templates…" />}
        {error && (
          <AdminEmpty
            icon="alert-circle-outline"
            title="Could not load email templates"
            hint={error}
          />
        )}

        {templates && templates.length === 0 && !error && (
          <AdminEmpty
            icon="mail-outline"
            title="No email templates found"
            hint="Seed the email_templates table to manage transactional emails here."
          />
        )}

        {templates &&
          templates.map((t) => (
            <AdminCard key={t.template_key}>
              <View style={styles.cardHead}>
                <View style={styles.cardTitleRow}>
                  <Ionicons name={TEMPLATE_ICONS[t.template_key]} size={18} color={colors.midNavy} />
                  <Text style={listStyles.rowTitle}>{TEMPLATE_LABELS[t.template_key]}</Text>
                </View>
                <View style={styles.keyPill}>
                  <Text style={styles.keyPillText}>{t.template_key}</Text>
                </View>
              </View>

              <Text style={styles.subjectLabel}>SUBJECT</Text>
              <Text style={styles.subjectText} numberOfLines={2}>
                {t.subject}
              </Text>

              {t.available_variables.length > 0 && (
                <View style={styles.varRow}>
                  {t.available_variables.map((v) => (
                    <View key={v} style={styles.varChipStatic}>
                      <Text style={styles.varChipStaticText}>{`{${v}}`}</Text>
                    </View>
                  ))}
                </View>
              )}

              <View style={listStyles.rowActions}>
                <AdminButton label="Edit" icon="create-outline" onPress={() => openEditor(t)} />
              </View>
            </AdminCard>
          ))}
      </ScrollView>

      {/* ── Editor modal ── */}
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
              {editor ? TEMPLATE_LABELS[editor.template_key] : ''}
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
                label="Subject line"
                value={editor.subject}
                onChangeText={(t) => setEditor({ ...editor, subject: t })}
                onFocus={() => setFocused('subject')}
                onSelectionChange={onSubjectSelectionChange}
                placeholder="e.g. Welcome to Compliance Co-Pilot"
              />

              <Text style={styles.contentLabel}>Body HTML</Text>
              <TextInput
                value={editor.body_html}
                onChangeText={(t) => setEditor({ ...editor, body_html: t })}
                onFocus={() => setFocused('body')}
                onSelectionChange={onBodySelectionChange}
                multiline
                textAlignVertical="top"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.contentInput}
                placeholder="Full HTML body…"
                placeholderTextColor={colors.subtleText}
              />

              <Text style={styles.varsLabel}>Available variables</Text>
              <Text style={styles.varsHint}>
                Tap to insert at the cursor in the {focused === 'subject' ? 'subject' : 'body'}.
              </Text>
              <View style={styles.varRow}>
                {editor.available_variables.length === 0 ? (
                  <Text style={styles.noVars}>No variables defined for this template.</Text>
                ) : (
                  editor.available_variables.map((v) => (
                    <TouchableOpacity
                      key={v}
                      onPress={() => insertVariable(v)}
                      style={styles.varChip}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="add" size={12} color={colors.midNavy} />
                      <Text style={styles.varChipText}>{`{${v}}`}</Text>
                    </TouchableOpacity>
                  ))
                )}
              </View>

              <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
                <AdminButton
                  label="Preview with sample data"
                  icon="eye-outline"
                  variant="secondary"
                  onPress={openPreview}
                />
                <AdminButton
                  label="Save changes"
                  icon="save-outline"
                  onPress={save}
                  loading={saving}
                />
                <Text style={styles.saveHint}>
                  The subject and body are used the next time this email is sent. Placeholders
                  like {'{user_name}'} are filled with real values at send time.
                </Text>
              </View>
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Preview modal ── */}
      <Modal
        visible={preview !== null}
        animationType="slide"
        onRequestClose={() => setPreview(null)}
      >
        <View style={[styles.previewRoot, { paddingTop: insets.top }]}>
          <View style={styles.previewHeader}>
            <TouchableOpacity onPress={() => setPreview(null)} hitSlop={12}>
              <Ionicons name="close" size={24} color={colors.navy} />
            </TouchableOpacity>
            <Text style={styles.previewTitle} numberOfLines={1}>
              Preview
            </Text>
            <View style={{ width: 24 }} />
          </View>
          {preview && (
            <>
              <View style={styles.previewSubjectBar}>
                <Text style={styles.previewSubjectLabel}>SUBJECT</Text>
                <Text style={styles.previewSubjectText}>{preview.subject}</Text>
              </View>
              <WebView
                originWhitelist={['*']}
                source={{ html: preview.bodyHtml }}
                style={styles.previewWeb}
              />
            </>
          )}
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  keyPill: {
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
  subjectLabel: {
    ...typography.micro,
    color: colors.mutedText,
    fontSize: 10,
    letterSpacing: 0.6,
    marginTop: spacing.md,
  },
  subjectText: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 14,
    marginTop: 2,
  },
  varRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.md,
  },
  varChipStatic: {
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  varChipStaticText: {
    ...typography.micro,
    color: colors.mutedText,
    fontSize: 11,
  },
  // ── Editor modal ──
  modalRoot: { flex: 1, backgroundColor: colors.background },
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
  modalBody: { flex: 1 },
  modalContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
    gap: spacing.md,
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
    fontSize: 13,
    lineHeight: 19,
    minHeight: 280,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  varsLabel: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.sm,
  },
  varsHint: {
    ...typography.caption,
    color: colors.subtleText,
    fontSize: 12,
    marginTop: -6,
  },
  noVars: {
    ...typography.caption,
    color: colors.subtleText,
    fontSize: 12,
    fontStyle: 'italic',
  },
  varChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.lightBlue,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  varChipText: {
    ...typography.micro,
    color: colors.midNavy,
    fontSize: 11,
    fontWeight: '700',
  },
  saveHint: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: spacing.xs,
    lineHeight: 17,
  },
  // ── Preview modal ──
  previewRoot: { flex: 1, backgroundColor: colors.background },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    backgroundColor: colors.white,
  },
  previewTitle: {
    flex: 1,
    ...typography.h3,
    color: colors.bodyText,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  previewSubjectBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  previewSubjectLabel: {
    ...typography.micro,
    color: colors.mutedText,
    fontSize: 10,
    letterSpacing: 0.6,
  },
  previewSubjectText: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 14,
    marginTop: 2,
  },
  previewWeb: { flex: 1, backgroundColor: colors.white },
});
