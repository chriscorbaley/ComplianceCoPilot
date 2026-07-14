import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../theme';
import { scaled } from '../constants/layout';
import type { RetentionWarning } from '../services/documentRetention';

const DARK_AMBER_TEXT = '#633806';
const URGENT_RED = '#A32D2D';

interface RetentionBannerProps {
  warning: RetentionWarning;
  onDownloadAll: () => void;
  onDismiss?: () => void;
  // { current, total } while a download-all is in progress; null otherwise.
  progress?: { current: number; total: number } | null;
}

// Amber (early, Oct–Dec) or red (urgent, January) retention warning shown on the
// Documents and Dashboard screens when documents are approaching deletion.
export const RetentionBanner: React.FC<RetentionBannerProps> = ({
  warning,
  onDownloadAll,
  onDismiss,
  progress,
}) => {
  const urgent = warning.urgency === 'urgent';
  const busy = progress != null;

  const message = urgent
    ? `⚠️ URGENT: Your ${warning.docYear} documents will be permanently deleted on February 1. ${warning.daysRemaining} days remaining to download.`
    : `Documents from ${warning.docYear} will be permanently deleted on ${warning.deletionDateLabel}. Download them before then to keep copies.`;

  const fg = urgent ? colors.white : DARK_AMBER_TEXT;

  return (
    <View style={[styles.container, urgent ? styles.urgent : styles.early]}>
      <View style={styles.headerRow}>
        <Ionicons
          name={urgent ? 'alert-circle' : 'warning-outline'}
          size={18}
          color={fg}
          style={styles.icon}
        />
        <Text style={[styles.message, { color: fg }]}>{message}</Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onDownloadAll}
          disabled={busy}
          style={[styles.downloadBtn, urgent ? styles.downloadBtnUrgent : styles.downloadBtnEarly]}
        >
          {busy ? (
            <ActivityIndicator color={urgent ? URGENT_RED : DARK_AMBER_TEXT} size="small" />
          ) : (
            <Ionicons
              name="download-outline"
              size={14}
              color={urgent ? URGENT_RED : DARK_AMBER_TEXT}
            />
          )}
          <Text
            style={[styles.downloadText, { color: urgent ? URGENT_RED : DARK_AMBER_TEXT }]}
          >
            {busy
              ? `Downloading document ${progress!.current} of ${progress!.total}...`
              : urgent
                ? 'Download Now'
                : `Download All ${warning.docYear} Docs`}
          </Text>
        </TouchableOpacity>

        {warning.canDismiss && onDismiss && !busy ? (
          <TouchableOpacity onPress={onDismiss} hitSlop={8} style={styles.dismissBtn}>
            <Text style={[styles.dismissText, { color: fg }]}>Dismiss</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  early: {
    backgroundColor: colors.amberLight,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.amber,
  },
  urgent: {
    backgroundColor: URGENT_RED,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  icon: { marginTop: 1 },
  message: {
    ...typography.body,
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingLeft: 26,
  },
  downloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: scaled(12),
    minHeight: scaled(44),
    borderRadius: radius.pill,
  },
  downloadBtnEarly: { backgroundColor: colors.white },
  downloadBtnUrgent: { backgroundColor: colors.white },
  downloadText: { ...typography.caption, fontWeight: '700', fontSize: 12 },
  dismissBtn: { paddingVertical: 4 },
  dismissText: {
    ...typography.caption,
    fontWeight: '700',
    fontSize: 12,
    textDecorationLine: 'underline',
  },
});
