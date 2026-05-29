import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  useNavigation,
  useRoute,
  RouteProp,
  CommonActions,
  useFocusEffect,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, shadow, spacing, typography } from '../theme';
import { ProgressBar } from '../components/ProgressBar';
import { StatusPill } from '../components/StatusPill';
import { AugustaActivityModal } from '../components/AugustaActivityModal';
import { supabase } from '../services/supabase';
import { useBusiness } from '../business/BusinessContext';
import type { RootStackParamList } from '../navigation/types';

type RouteProps = RouteProp<RootStackParamList, 'StrategyDetail'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

const REAL_ESTATE_STRATEGY_IDS = new Set(['s1', 'real_estate']);
const isRealEstateStrategy = (id: string, name: string): boolean =>
  REAL_ESTATE_STRATEGY_IDS.has(id) ||
  /material participation|real estate/i.test(name);

const isAugustaStrategy = (id: string, name: string): boolean =>
  id === 's2' || id === 'augusta_rule' || /augusta/i.test(name);

export const StrategyDetailScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { activeBusinessId } = useBusiness();
  const { params } = useRoute<RouteProps>();
  const { strategy } = params;
  const showProperties = isRealEstateStrategy(strategy.id, strategy.name);
  const isAugusta = isAugustaStrategy(strategy.id, strategy.name);
  const [augustaFormOpen, setAugustaFormOpen] = useState(false);

  // For Augusta, show the same unified count the Dashboard uses: every
  // completed Augusta meeting this tax year, from either the Minutes screen or
  // the Log Activity form. Seeded with the value passed in, then refreshed live.
  const [augustaDays, setAugustaDays] = useState(strategy.progress);

  const loadAugustaCount = useCallback(async () => {
    const year = new Date().getFullYear();
    let q = supabase
      .from('meeting_minutes')
      .select('id', { count: 'exact', head: true })
      .ilike('meeting_type', 'Augusta%')
      .eq('status', 'complete')
      .gte('meeting_date', `${year}-01-01`)
      .lte('meeting_date', `${year}-12-31`);
    if (activeBusinessId) q = q.eq('business_id', activeBusinessId);
    const { count, error } = await q;
    if (!error && count != null) setAugustaDays(count);
  }, [activeBusinessId]);

  useFocusEffect(
    useCallback(() => {
      if (isAugusta) loadAugustaCount().catch(() => undefined);
    }, [isAugusta, loadAugustaCount]),
  );

  const progress = isAugusta ? augustaDays : strategy.progress;
  const pct = Math.round((progress / strategy.total) * 100);
  const accent = strategy.accentColor ?? colors.midNavy;
  const remaining = Math.max(0, strategy.total - progress);

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
            {progress}
            <Text style={styles.progressTotal}>
              {' / '}
              {strategy.total} {strategy.unit}
            </Text>
          </Text>
          <Text style={[styles.pctText, { color: accent }]}>{pct}%</Text>
        </View>
        <ProgressBar
          value={progress}
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

      {showProperties ? (
        <>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Properties')}
            style={styles.linkCard}
          >
            <View style={[styles.icon, styles.linkIcon]}>
              <Ionicons name="home-outline" size={20} color={colors.midNavy} />
            </View>
            <View style={styles.linkText}>
              <Text style={styles.linkTitle}>Manage Properties</Text>
              <Text style={styles.linkBody}>
                Track per-property hours, grouping elections, and material
                participation status.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.mutedText} />
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigation.navigate('RealEstateActivityLog')}
            style={styles.linkCard}
          >
            <View style={[styles.icon, styles.linkIcon]}>
              <Ionicons name="list-outline" size={20} color={colors.midNavy} />
            </View>
            <View style={styles.linkText}>
              <Text style={styles.linkTitle}>Activity Log</Text>
              <Text style={styles.linkBody}>
                Review every logged activity in an audit-ready table and export
                it for your tax advisor.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.mutedText} />
          </TouchableOpacity>
        </>
      ) : null}

      <View style={styles.actions}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => {
            if (isAugusta) {
              setAugustaFormOpen(true);
              return;
            }
            Alert.alert('Log activity', `Logging activity for ${strategy.name}…`);
          }}
          style={[styles.btn, styles.btnPrimary]}
        >
          <Ionicons name="add-circle-outline" size={18} color={colors.white} />
          <Text style={styles.btnPrimaryText}>Log activity</Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() =>
            navigation.dispatch(
              CommonActions.navigate({ name: 'Tabs', params: { screen: 'Docs' } }),
            )
          }
          style={[styles.btn, styles.btnOutline]}
        >
          <Ionicons name="document-text-outline" size={18} color={colors.navy} />
          <Text style={styles.btnOutlineText}>View documents</Text>
        </TouchableOpacity>
      </View>

      {isAugusta ? (
        <AugustaActivityModal
          visible={augustaFormOpen}
          onClose={() => setAugustaFormOpen(false)}
          onSaved={() => loadAugustaCount().catch(() => undefined)}
        />
      ) : null}
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
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    ...shadow.card,
  },
  linkIcon: {
    backgroundColor: colors.lightBlue,
  },
  linkText: {
    flex: 1,
  },
  linkTitle: {
    ...typography.h3,
    color: colors.bodyText,
    fontSize: 15,
  },
  linkBody: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 2,
  },
});
