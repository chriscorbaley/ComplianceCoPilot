import React from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography } from '../theme';
import { scaled } from '../constants/layout';

interface EditFormSheetProps {
  title: string;
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  onSave: () => void;
  onDelete?: () => void;
  saveLabel?: string;
  deleteLabel?: string;
  showDelete?: boolean;
  // Disables the Save button and shows a spinner — set while an update or
  // delete request is in flight so the user can't double-submit.
  saving?: boolean;
  saveDisabled?: boolean;
  // Confirmation copy shown before onDelete fires. The sheet owns the
  // confirm/cancel dialog so callers only supply the message.
  deleteConfirmTitle?: string;
  deleteConfirmMessage?: string;
  // Optional extra action(s) rendered above the standard Save button — used for
  // the trip-draft "Finalize Trip" button and the minutes Regenerate/Share row.
  extraActions?: React.ReactNode;
}

// Red used for the destructive delete button outline + label (matches the
// app's not-deductible red).
const DELETE_RED = '#B33A3A';

/**
 * A bottom-sheet modal for edit forms. Renders a titled header with a close
 * (Cancel) button, a scrollable body for the caller's form fields, and a
 * footer with Save / Delete actions. Delete routes through a confirmation
 * dialog. Reused by every "tap a row to edit it" flow in the app.
 */
export const EditFormSheet: React.FC<EditFormSheetProps> = ({
  title,
  visible,
  onClose,
  children,
  onSave,
  onDelete,
  saveLabel = 'Save Changes',
  deleteLabel = 'Delete',
  showDelete = true,
  saving = false,
  saveDisabled = false,
  deleteConfirmTitle = 'Delete this item?',
  deleteConfirmMessage = 'This cannot be undone.',
  extraActions,
}) => {
  const insets = useSafeAreaInsets();
  const confirmDelete = () => {
    if (!onDelete) return;
    Alert.alert(deleteConfirmTitle, deleteConfirmMessage, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onDelete },
    ]);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              <TouchableOpacity
                onPress={onClose}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel="Cancel"
              >
                <Ionicons name="close" size={24} color={colors.mutedText} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>

            <View
              style={[
                styles.footer,
                { paddingBottom: spacing.xl + insets.bottom },
              ]}
            >
              {extraActions}
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={onSave}
                disabled={saving || saveDisabled}
                style={[
                  styles.saveBtn,
                  (saving || saveDisabled) && styles.btnDim,
                ]}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Ionicons name="save-outline" size={18} color={colors.white} />
                )}
                <Text style={styles.saveBtnText}>{saveLabel}</Text>
              </TouchableOpacity>

              {showDelete && onDelete ? (
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={confirmDelete}
                  disabled={saving}
                  style={[styles.deleteBtn, saving && styles.btnDim]}
                >
                  <Ionicons name="trash-outline" size={18} color={DELETE_RED} />
                  <Text style={styles.deleteBtnText}>{deleteLabel}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  title: {
    ...typography.h2,
    color: colors.bodyText,
    flex: 1,
    marginRight: spacing.md,
  },
  body: {
    flexGrow: 0,
  },
  bodyContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    backgroundColor: colors.navy,
    borderRadius: radius.card,
    paddingVertical: scaled(14),
    minHeight: scaled(44),
  },
  saveBtnText: {
    ...typography.bodyMedium,
    color: colors.white,
    fontWeight: '700',
    fontSize: 15,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: DELETE_RED,
    paddingVertical: 12,
  },
  deleteBtnText: {
    ...typography.bodyMedium,
    color: DELETE_RED,
    fontWeight: '700',
    fontSize: 14,
  },
  btnDim: {
    opacity: 0.6,
  },
});
