import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, shadow, typography } from '../theme';
import { scaled } from '../constants/layout';
import { ProgressBar } from './ProgressBar';
import { StatusPill, StatusVariant } from './StatusPill';

export interface Strategy {
  id: string;
  name: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  progress: number;
  total: number;
  unit: string;
  status: string;
  statusVariant: StatusVariant;
  accentColor?: string;
  // When true the card shows a plain "{progress} {unit} this year" count with a
  // full bar and no percentage — for strategies with no required target/maximum
  // (e.g. Business Travel, where any number of documented trips is fine).
  hideTarget?: boolean;
}

interface StrategyCardProps {
  strategy: Strategy;
  onPress?: () => void;
}

export const StrategyCard: React.FC<StrategyCardProps> = ({ strategy, onPress }) => {
  const hideTarget = strategy.hideTarget ?? false;
  const pct = hideTarget ? 100 : Math.round((strategy.progress / strategy.total) * 100);
  const accent = strategy.accentColor ?? colors.midNavy;

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.iconWrap, { backgroundColor: colors.lightBlue }]}>
          <Ionicons name={strategy.icon} size={18} color={colors.midNavy} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.name} numberOfLines={1}>
            {strategy.name}
          </Text>
          <Text style={styles.description}>
            {strategy.description}
          </Text>
        </View>
        <StatusPill label={strategy.status} variant={strategy.statusVariant} />
      </View>

      <View style={styles.progressRow}>
        <Text style={styles.progressValue}>
          {strategy.progress}
          <Text style={styles.progressTotal}>
            {hideTarget
              ? ` ${strategy.unit} this year`
              : ` / ${strategy.total} ${strategy.unit}`}
          </Text>
        </Text>
        {hideTarget ? null : <Text style={styles.pctText}>{pct}%</Text>}
      </View>

      <ProgressBar
        value={hideTarget ? 1 : strategy.progress}
        total={hideTarget ? 1 : strategy.total}
        color={accent}
        trackColor={colors.lightBlue}
        height={8}
      />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    // Tablet touch-target scaling: overrides top/bottom padding only (the
    // `padding` shorthand above still supplies horizontal padding). No-op on
    // phones — scaled(spacing.lg) === spacing.lg there.
    paddingVertical: scaled(spacing.lg),
    ...shadow.card,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  name: {
    ...typography.h3,
    color: colors.bodyText,
    fontSize: 15,
  },
  description: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 20,
    marginTop: 1,
    flexWrap: 'wrap',
    flexShrink: 1,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing.sm,
  },
  progressValue: {
    ...typography.h2,
    color: colors.bodyText,
    fontSize: 16,
    fontWeight: '700',
  },
  progressTotal: {
    ...typography.body,
    color: colors.mutedText,
    fontWeight: '500',
    fontSize: 13,
  },
  pctText: {
    ...typography.bodyMedium,
    color: colors.midNavy,
    fontWeight: '700',
    fontSize: 13,
  },
});
