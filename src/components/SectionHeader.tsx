import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, typography } from '../theme';

interface SectionHeaderProps {
  title: string;
  action?: string;
  onAction?: () => void;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  action,
  onAction,
}) => {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      {action ? (
        <TouchableOpacity onPress={onAction} hitSlop={8}>
          <Text style={styles.action}>{action}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: {
    ...typography.h2,
    color: colors.bodyText,
    fontSize: 17,
  },
  action: {
    ...typography.bodyMedium,
    color: colors.midNavy,
    fontSize: 13,
    fontWeight: '600',
  },
});
