import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography } from '../theme';

export interface ViewerDocument {
  name: string;
  // The full text content of the document. For generated minutes / activity
  // logs this is the editable body; for read-only uploads it can be a short
  // description.
  content: string;
  meta?: string;
}

interface DocumentViewerProps {
  document: ViewerDocument;
  // Persists the edited text. Should resolve once the write succeeds so the
  // viewer can drop back to read mode and show the "Saved" confirmation.
  onSave: (newContent: string) => Promise<void> | void;
  onShare: () => void;
  onClose: () => void;
  // Read-only mode (e.g. uploaded PDFs) hides the Edit affordance entirely and
  // shows only Share.
  editable?: boolean;
}

const stripBold = (s: string): string => s.replace(/\*\*(.*?)\*\*/g, '$1');

// Lightweight read-mode renderer: bolds markdown headings / bold-only lines so
// generated minutes read as a formatted document, while plain activity-log
// "key: value" lines render as paragraphs.
const renderFormatted = (text: string): React.ReactNode =>
  text.split(/\r?\n/).map((raw, i) => {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) return <View key={i} style={styles.readSpacer} />;
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const txt = heading[2].replace(/\*\*/g, '');
      return (
        <Text
          key={i}
          style={level === 1 ? styles.readH1 : level === 2 ? styles.readH2 : styles.readH3}
        >
          {txt}
        </Text>
      );
    }
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      return (
        <View key={i} style={styles.readBulletRow}>
          <Text style={styles.readBulletDot}>•</Text>
          <Text style={styles.readBulletText}>{stripBold(bullet[1])}</Text>
        </View>
      );
    }
    const boldOnly = /^\*\*(.+)\*\*:?\s*$/.exec(line.trim());
    if (boldOnly) {
      return (
        <Text key={i} style={styles.readH3}>
          {boldOnly[1]}
        </Text>
      );
    }
    return (
      <Text key={i} style={styles.readParagraph}>
        {stripBold(line)}
      </Text>
    );
  });

/**
 * The editable document viewer. Opens in READ mode showing formatted text with
 * a pencil in the title bar; tapping it switches to EDIT mode (large editable
 * text area, pencil becomes a save icon, a Cancel button appears). Saving
 * persists via onSave, flashes a "Saved" banner, and returns to read mode.
 * Uploaded files pass editable={false} to show a read-only viewer with Share.
 */
export const DocumentViewer: React.FC<DocumentViewerProps> = ({
  document,
  onSave,
  onShare,
  onClose,
  editable = true,
}) => {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'read' | 'edit'>('read');
  const [draft, setDraft] = useState(document.content);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-seed the draft if a different document is opened into the same mounted
  // viewer (e.g. parent swaps the selected doc without unmounting).
  useEffect(() => {
    setDraft(document.content);
    setMode('read');
  }, [document.content, document.name]);

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  const enterEdit = () => {
    setDraft(document.content);
    setMode('edit');
  };

  const cancelEdit = () => {
    setDraft(document.content);
    setMode('read');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      setMode('read');
      setJustSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setJustSaved(false), 1800);
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent={false} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.topBtn}>
            <Ionicons name="close" size={26} color={colors.bodyText} />
          </TouchableOpacity>
          <Text style={styles.topTitle} numberOfLines={1}>
            {document.name}
          </Text>
          {editable ? (
            mode === 'read' ? (
              <TouchableOpacity onPress={enterEdit} hitSlop={12} style={styles.topBtn}>
                <Ionicons name="pencil" size={22} color={colors.navy} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={handleSave}
                disabled={saving}
                hitSlop={12}
                style={styles.topBtn}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={colors.navy} />
                ) : (
                  <Ionicons name="checkmark" size={26} color={colors.navy} />
                )}
              </TouchableOpacity>
            )
          ) : (
            <View style={styles.topBtn} />
          )}
        </View>

        {justSaved ? (
          <View style={styles.savedBanner}>
            <Ionicons name="checkmark-circle" size={16} color={colors.teal} />
            <Text style={styles.savedText}>Saved</Text>
          </View>
        ) : null}

        {mode === 'read' ? (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.readContent,
              { paddingBottom: 32 + insets.bottom },
            ]}
            showsVerticalScrollIndicator
          >
            {document.meta ? (
              <Text style={styles.metaLine}>{document.meta}</Text>
            ) : null}
            {document.content.trim()
              ? renderFormatted(document.content)
              : (
                <Text style={styles.readParagraph}>
                  This document has no editable text content.
                </Text>
              )}
          </ScrollView>
        ) : (
          <TextInput
            style={[styles.editArea, { paddingBottom: 32 + insets.bottom }]}
            value={draft}
            onChangeText={setDraft}
            multiline
            textAlignVertical="top"
            autoFocus
            placeholder="Document text"
            placeholderTextColor={colors.subtleText}
          />
        )}

        <View style={[styles.footer, { paddingBottom: spacing.md + insets.bottom }]}>
          {mode === 'edit' ? (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={cancelEdit}
              disabled={saving}
              style={[styles.btn, styles.btnOutline]}
            >
              <Ionicons name="arrow-undo-outline" size={18} color={colors.navy} />
              <Text style={styles.btnOutlineText}>Cancel</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={onShare}
              style={[styles.btn, styles.btnPrimary]}
            >
              <Ionicons
                name={Platform.OS === 'ios' ? 'share-outline' : 'share-social-outline'}
                size={18}
                color={colors.white}
              />
              <Text style={styles.btnPrimaryText}>Share</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.white,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  topBtn: {
    minWidth: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: {
    ...typography.h3,
    color: colors.bodyText,
    flex: 1,
    textAlign: 'center',
    marginHorizontal: spacing.sm,
  },
  savedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.tealLight,
    paddingVertical: spacing.sm,
  },
  savedText: {
    ...typography.bodyMedium,
    color: colors.teal,
    fontWeight: '700',
    fontSize: 13,
  },
  scroll: {
    flex: 1,
  },
  readContent: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  metaLine: {
    ...typography.caption,
    color: colors.mutedText,
    marginBottom: spacing.md,
  },
  readH1: {
    ...typography.h1,
    color: colors.navy,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  readH2: {
    ...typography.h2,
    color: colors.navy,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    fontSize: 17,
  },
  readH3: {
    ...typography.h3,
    color: colors.bodyText,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  readParagraph: {
    ...typography.body,
    color: colors.bodyText,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 4,
  },
  readBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: 4,
    paddingLeft: spacing.sm,
  },
  readBulletDot: {
    ...typography.body,
    color: colors.navy,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
    minWidth: 14,
  },
  readBulletText: {
    ...typography.body,
    color: colors.bodyText,
    fontSize: 15,
    lineHeight: 22,
    flex: 1,
  },
  readSpacer: {
    height: spacing.xs,
  },
  editArea: {
    flex: 1,
    ...typography.body,
    color: colors.bodyText,
    fontSize: 15,
    lineHeight: 22,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    textAlignVertical: 'top',
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    borderRadius: radius.card,
    paddingVertical: 14,
  },
  btnPrimary: {
    backgroundColor: colors.navy,
  },
  btnPrimaryText: {
    ...typography.bodyMedium,
    color: colors.white,
    fontWeight: '700',
    fontSize: 15,
  },
  btnOutline: {
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.navy,
  },
  btnOutlineText: {
    ...typography.bodyMedium,
    color: colors.navy,
    fontWeight: '700',
    fontSize: 15,
  },
});
