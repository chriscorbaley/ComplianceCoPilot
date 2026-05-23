import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, shadow, spacing, typography } from '../theme';
import { ProgressBar } from '../components/ProgressBar';
import { StatusPill } from '../components/StatusPill';
import type { RootStackParamList } from '../navigation/types';

type RouteProps = RouteProp<RootStackParamList, 'StrategyDetail'>;

export const StrategyDetailScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { params } = useRoute<RouteProps>();
  const { strategy } = params;
  const pct = Math.round((strategy.progress / strategy.total) * 100);
  const accent = strategy.accentColor ?? colors.midNavy;
  const remaining = Math.max(0, strategy.total - strategy.progress);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.card}>
        <View style={styles.header}>
          <View style={[styles.icon, { backgroundColor: colors.lightBlue }]}>
            <Ionicons name={strategy.icon} size={26} color={colors.midNavy} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.title}>{strategy.name}</Text>
            <Text style={styles.description}>{strategy.description}</Text>
          </View>
          <StatusPill label={strategy.status} variant={strategy.statusVariant} />
        </View>

        <View style={styles.divider} />

        <Text style={styles.sectionLabel}>Progress</Text>
        <View style={styles.progressRow}>
          <Text style={styles.progressValue}>
            {strategy.progress}
            <Text style={styles.progressTotal}>
              {' / '}
              {strategy.total} {strategy.unit}
            </Text>
          </Text>
          <Text style={[styles.pctText, { color: accent }]}>{pct}%</Text>
        </View>
        <ProgressBar
          value={strategy.progress}
          total={strategy.total}
          color={accent}
          trackColor={colors.lightBlue}
          height={10}
        />
        <Text style={styles.remaining}>
          {remaining} {strategy.unit} remaining to hit goal
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>About this strategy</Text>
        <Text style={styles.body}>
          {strategy.description}. Track activity throughout the year and keep
          substantiating documents in your vault so you can defend the
          deduction at audit time.
        </Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => Alert.alert('Log activity', `Logging activity for ${strategy.name}…`)}
          style={[styles.btn, styles.btnPrimary]}
        >
          <Ionicons name="add-circle-outline" size={18} color={colors.white} />
          <Text style={styles.btnPrimaryText}>Log activity</Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() =>
            Alert.alert('View documents', `Filtering documents for ${strategy.name}…`)
          }
          style={[styles.btn, styles.btnOutline]}
        >
          <Ionicons name="document-text-outline" size={18} color={colors.navy} />
          <Text style={styles.btnOutlineText}>View documents</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadow.card,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  title: {
    ...typography.h2,
    color: colors.bodyText,
    fontSize: 17,
    fontWeight: '700',
  },
  description: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginVertical: spacing.xs,
  },
  sectionLabel: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  progressValue: {
    ...typography.h2,
    color: colors.bodyText,
    fontSize: 22,
    fontWeight: '700',
  },
  progressTotal: {
    ...typography.body,
    color: colors.mutedText,
    fontWeight: '500',
    fontSize: 14,
  },
  pctText: {
    ...typography.bodyMedium,
    fontWeight: '700',
    fontSize: 15,
  },
  remaining: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: spacing.sm,
  },
  body: {
    ...typography.body,
    color: colors.bodyText,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    borderRadius: radius.card,
    paddingVertical: 14,
  },
  btnPrimary: {
    backgroundColor: colors.navy,
    ...shadow.raised,
  },
  btnPrimaryText: {
    ...typography.bodyMedium,
    color: colors.white,
    fontWeight: '700',
    fontSize: 14,
  },
  btnOutline: {
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.navy,
  },
  btnOutlineText: {
    ...typography.bodyMedium,
    color: colors.navy,
    fontWeight: '700',
    fontSize: 14,
  },
});
