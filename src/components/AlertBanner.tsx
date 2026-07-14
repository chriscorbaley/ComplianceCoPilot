import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../theme';
import { scaled } from '../constants/layout';

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
        <Text style={styles.title}>
          {title}
        </Text>
        <Text style={styles.detail}>
          {detail}
        </Text>
      </View>
      {onPress ? (
        <Ionicons name="chevron-forward" size={18} color={colors.orangeAlert} style={styles.chevron} />
      ) : null}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    // Top-align so the icon and chevron stay put as the message wraps to
    // multiple lines and the banner grows to fit the full text.
    alignItems: 'flex-start',
    backgroundColor: colors.orangeAlertBg,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: 'rgba(231, 111, 44, 0.25)',
    padding: spacing.md,
    // Tablet touch-target scaling: overrides top/bottom padding only; the
    // `padding` shorthand still supplies horizontal padding. No-op on phones.
    paddingVertical: scaled(spacing.md),
    gap: spacing.md,
  },
  chevron: {
    marginTop: 2,
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
