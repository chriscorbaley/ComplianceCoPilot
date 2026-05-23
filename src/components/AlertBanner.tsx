import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../theme';

interface AlertBannerProps {
  title: string;
  detail: string;
  onPress?: () => void;
}

export const AlertBanner: React.FC<AlertBannerProps> = ({ title, detail, onPress }) => {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      style={styles.container}
    >
      <View style={styles.iconCircle}>
        <Ionicons name="warning" size={16} color={colors.white} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.detail} numberOfLines={2}>
          {detail}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.orangeAlert} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.orangeAlertBg,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: 'rgba(231, 111, 44, 0.25)',
    padding: spacing.md,
    gap: spacing.md,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.orangeAlert,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
  },
  title: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontWeight: '700',
    marginBottom: 2,
  },
  detail: {
    ...typography.body,
    color: colors.bodyText,
    opacity: 0.75,
    fontSize: 13,
  },
});
