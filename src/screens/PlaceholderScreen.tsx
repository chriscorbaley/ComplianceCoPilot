import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '../theme';
import { Header } from '../components/Header';

interface PlaceholderScreenProps {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  description: string;
}

export const PlaceholderScreen: React.FC<PlaceholderScreenProps> = ({
  title,
  icon,
  description,
}) => {
  return (
    <View style={styles.root}>
      <Header year={2026} />
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={40} color={colors.midNavy} />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    gap: spacing.md,
  },
  iconWrap: {
    width: 84,
    height: 84,
    borderRadius: 24,
    backgroundColor: colors.lightBlue,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.h1,
    color: colors.bodyText,
    textAlign: 'center',
  },
  description: {
    ...typography.body,
    color: colors.mutedText,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 20,
  },
});
