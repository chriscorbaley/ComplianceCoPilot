// One required-document slot used by the strategy compliance screens.
// Renders a title + description above either:
//   - an empty dashed-border "Tap to upload" tile, or
//   - a green-checkmark row showing the uploaded filename, date, and a
//     "Replace" link.

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography } from '../theme';
import { scaled } from '../constants/layout';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const formatUploadDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};

interface UploadedDoc {
  fileName: string;
  uploadedAt: string;
}

interface DocumentUploadRowProps {
  title: string;
  description?: string;
  uploaded: UploadedDoc | null;
  onUpload: () => void;
  onReplace?: () => void;
  onView?: () => void;
}

export const DocumentUploadRow: React.FC<DocumentUploadRowProps> = ({
  title,
  description,
  uploaded,
  onUpload,
  onReplace,
  onView,
}) => {
  return (
    <View style={styles.section}>
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}

      {uploaded ? (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onView}
          style={styles.uploadedRow}
        >
          <View style={styles.checkIcon}>
            <Ionicons name="checkmark-circle" size={22} color={colors.teal} />
          </View>
          <View style={styles.uploadedText}>
            <Text style={styles.fileName} numberOfLines={1}>
              {uploaded.fileName}
            </Text>
            <Text style={styles.fileMeta}>
              Uploaded {formatUploadDate(uploaded.uploadedAt)}
            </Text>
          </View>
          {onReplace ? (
            <TouchableOpacity onPress={onReplace} hitSlop={8}>
              <Text style={styles.replaceLink}>Replace</Text>
            </TouchableOpacity>
          ) : null}
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={onUpload}
          style={styles.uploadTile}
        >
          <Ionicons
            name="cloud-upload-outline"
            size={22}
            color={colors.subtleText}
            style={styles.uploadIcon}
          />
          <Text style={styles.uploadText}>Tap to upload</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  title: {
    ...typography.bodyMedium,
    color: colors.navy,
    fontSize: 14,
    fontWeight: '700',
  },
  description: {
    ...typography.caption,
    color: '#888888',
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
  },
  uploadTile: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#CCCCCC',
    paddingVertical: scaled(22),
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadIcon: {
    marginBottom: 4,
  },
  uploadText: {
    fontSize: 12,
    color: '#AAAAAA',
    fontWeight: '500',
  },
  uploadedRow: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.tealLight,
    backgroundColor: colors.tealLight,
    paddingVertical: scaled(12),
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkIcon: {
    width: 26,
    alignItems: 'center',
  },
  uploadedText: {
    flex: 1,
  },
  fileName: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 13,
    fontWeight: '600',
  },
  fileMeta: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    marginTop: 2,
  },
  replaceLink: {
    color: '#888888',
    fontSize: 12,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
