import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../theme';
import { StatusPill, StatusVariant } from './StatusPill';

export interface DocumentRow {
  id: string;
  title: string;
  meta: string;
  status: string;
  statusVariant: StatusVariant;
  icon?: keyof typeof Ionicons.glyphMap;
}

interface DocumentItemProps {
  doc: DocumentRow;
  onPress?: () => void;
  isLast?: boolean;
}

export const DocumentItem: React.FC<DocumentItemProps> = ({ doc, onPress, isLast }) => {
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      style={[styles.row, !isLast && styles.borderBottom]}
    >
      <View style={styles.iconWrap}>
        <Ionicons
          name={doc.icon ?? 'document-text-outline'}
          size={18}
          color={colors.midNavy}
        />
      </View>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {doc.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {doc.meta}
        </Text>
      </View>
      <StatusPill label={doc.status} variant={doc.statusVariant} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  borderBottom: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.lightBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
  },
  title: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 14,
    fontWeight: '600',
  },
  meta: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 1,
  },
});
