import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { colors, radius, shadow, spacing } from '../theme';

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}

export const Card: React.FC<CardProps> = ({ children, style, padded = true }) => {
  return (
    <View style={[styles.card, padded && styles.padded, style]}>{children}</View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    ...shadow.card,
  },
  padded: {
    padding: spacing.lg,
  },
});
