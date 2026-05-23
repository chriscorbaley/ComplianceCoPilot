import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors, radius, typography } from '../theme';

export type StatusVariant = 'success' | 'warning' | 'info' | 'neutral';

interface StatusPillProps {
  label: string;
  variant?: StatusVariant;
  style?: ViewStyle;
}

const variantStyles: Record<StatusVariant, { bg: string; fg: string }> = {
  success: { bg: colors.tealLight, fg: colors.teal },
  warning: { bg: colors.amberLight, fg: colors.amber },
  info: { bg: colors.lightBlue, fg: colors.midNavy },
  neutral: { bg: '#F1F3F5', fg: colors.bodyText },
};

export const StatusPill: React.FC<StatusPillProps> = ({
  label,
  variant = 'info',
  style,
}) => {
  const v = variantStyles[variant];
  return (
    <View style={[styles.pill, { backgroundColor: v.bg }, style]}>
      <Text style={[styles.text, { color: v.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  text: {
    ...typography.micro,
    fontSize: 11,
    letterSpacing: 0.2,
  },
});
