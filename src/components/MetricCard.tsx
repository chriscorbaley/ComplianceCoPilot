import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ViewStyle, TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, shadow, typography } from '../theme';

export type MetricVariant = 'amber' | 'teal' | 'navy' | 'info';

interface MetricCardProps {
  label: string;
  value: string;
  sublabel?: string;
  icon: keyof typeof Ionicons.glyphMap;
  variant?: MetricVariant;
  progress?: number;
  onPress?: () => void;
  style?: ViewStyle;
  sublabelStyle?: TextStyle;
}

const variantStyles: Record<
  MetricVariant,
  { bg: string; fg: string; iconBg: string; iconFg: string }
> = {
  amber: {
    bg: colors.amberLight,
    fg: colors.amber,
    iconBg: colors.amber,
    iconFg: colors.white,
  },
  teal: {
    bg: colors.tealLight,
    fg: colors.teal,
    iconBg: colors.teal,
    iconFg: colors.white,
  },
  navy: {
    bg: colors.white,
    fg: colors.navy,
    iconBg: colors.navy,
    iconFg: colors.white,
  },
  info: {
    bg: colors.white,
    fg: colors.midNavy,
    iconBg: colors.lightBlue,
    iconFg: colors.midNavy,
  },
};

export const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  sublabel,
  icon,
  variant = 'navy',
  progress,
  onPress,
  style,
  sublabelStyle,
}) => {
  const v = variantStyles[variant];
  const isAccentBg = variant === 'amber' || variant === 'teal';

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      style={[
        styles.card,
        { backgroundColor: v.bg },
        isAccentBg && { borderColor: 'rgba(0,0,0,0.06)' },
        style,
      ]}
    >
      <View style={styles.topRow}>
        <View style={[styles.iconWrap, { backgroundColor: v.iconBg }]}>
          <Ionicons name={icon} size={16} color={v.iconFg} />
        </View>
      </View>

      <Text
        style={[
          styles.value,
          { color: isAccentBg ? v.fg : colors.bodyText },
        ]}
      >
        {value}
      </Text>

      <Text
        style={[
          styles.label,
          { color: isAccentBg ? v.fg : colors.mutedText },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>

      {sublabel ? (
        <Text
          style={[
            styles.sublabel,
            { color: isAccentBg ? v.fg : colors.subtleText },
            sublabelStyle,
          ]}
          numberOfLines={1}
        >
          {sublabel}
        </Text>
      ) : null}

      {typeof progress === 'number' ? (
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${Math.max(0, Math.min(100, progress))}%`,
                backgroundColor: v.fg,
              },
            ]}
          />
        </View>
      ) : null}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    minHeight: 132,
    ...shadow.card,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    ...typography.metric,
    marginBottom: 2,
  },
  label: {
    ...typography.bodyMedium,
    fontWeight: '600',
    fontSize: 13,
  },
  sublabel: {
    ...typography.caption,
    marginTop: 2,
    fontSize: 11,
    fontWeight: '500',
  },
  progressTrack: {
    marginTop: spacing.sm,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.08)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
});
