import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, CommonActions } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, spacing } from '../theme';
import { Header } from '../components/Header';
import { AlertBanner } from '../components/AlertBanner';
import { AnnouncementBanner } from '../components/AnnouncementBanner';
import { MetricCard } from '../components/MetricCard';
import { StrategyCard, Strategy } from '../components/StrategyCard';
import { DocumentItem, DocumentRow } from '../components/DocumentItem';
import { SectionHeader } from '../components/SectionHeader';
import { VoiceLogStrip } from '../components/VoiceLogStrip';
import { Card } from '../components/Card';
import type { RootStackParamList } from '../navigation/types';
import {
  supabase,
  type AnnouncementRow,
  type DocumentRow as DbDocumentRow,
} from '../services/supabase';
import {
  loadComplianceRules,
  subscribeToRules,
  type ComplianceRules,
} from '../services/complianceRules';

type DashboardNavigationProp = NativeStackNavigationProp<RootStackParamList>;

const BUSINESS_TRAVEL_STRATEGY_ID = 's3';

const MONTH_DAY = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
};

const docRowToCard = (row: DbDocumentRow): DocumentRow => ({
  id: row.id,
  title: row.name ?? 'Untitled document',
  meta: `Uploaded ${MONTH_DAY(row.created_at)}${row.file_type ? ' · ' + row.file_type : ''}`,
  status: 'Saved',
  statusVariant: 'success',
  icon: 'document-text-outline',
});

interface DashboardData {
  hoursYTD: number;
  augustaDays: number;
  tripsThisYear: number;
  docsCount: number;
  recentDocs: DocumentRow[];
  augustaMax: number;
  hoursRequired: number;
}

const EMPTY_DATA: DashboardData = {
  hoursYTD: 0,
  augustaDays: 0,
  tripsThisYear: 0,
  docsCount: 0,
  recentDocs: [],
  augustaMax: 14,
  hoursRequired: 750,
};

const ruleNumber = (rules: ComplianceRules | null, strategy: string, key: string, fallback: number): number => {
  const row = rules?.rawDb.find((r) => r.strategy_name === strategy && r.rule_key === key);
  if (!row) return fallback;
  const n = parseFloat(row.rule_value);
  return Number.isFinite(n) ? n : fallback;
};

const isAnnouncementActive = (row: AnnouncementRow): boolean => {
  if (!row.expires_at) return true;
  return new Date(row.expires_at).getTime() > Date.now();
};

export const DashboardScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<DashboardNavigationProp>();
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [rules, setRules] = useState<ComplianceRules | null>(null);
  const [announcement, setAnnouncement] = useState<AnnouncementRow | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());

  const loadLatestAnnouncement = useCallback(async () => {
    const { data: rows } = await supabase
      .from('announcements')
      .select('*')
      .order('published_at', { ascending: false })
      .limit(10);
    const next = ((rows ?? []) as AnnouncementRow[]).find(isAnnouncementActive) ?? null;
    setAnnouncement(next);
  }, []);

  useEffect(() => {
    loadLatestAnnouncement().catch(() => undefined);
    const channel = supabase
      .channel('client-announcements')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'announcements' },
        () => {
          loadLatestAnnouncement().catch(() => undefined);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadLatestAnnouncement]);

  const visibleAnnouncement =
    announcement && !dismissedIds.has(announcement.id) ? announcement : null;

  const refresh = useCallback(async () => {
    const yearStart = `${new Date().getFullYear()}-01-01`;
    const yearEnd = `${new Date().getFullYear()}-12-31`;

    const [hoursRes, augustaRes, tripsRes, docsCountRes, recentDocsRes] = await Promise.all([
      supabase
        .from('hours_log')
        .select('hours')
        .gte('activity_date', yearStart)
        .lte('activity_date', yearEnd),
      supabase
        .from('meeting_minutes')
        .select('id, meeting_date', { count: 'exact' })
        .ilike('meeting_type', 'Augusta%')
        .gte('meeting_date', yearStart)
        .lte('meeting_date', yearEnd),
      supabase
        .from('business_trips')
        .select('id', { count: 'exact', head: true })
        .gte('departure_date', yearStart)
        .lte('departure_date', yearEnd),
      supabase
        .from('documents')
        .select('id', { count: 'exact', head: true }),
      supabase
        .from('documents')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(3),
    ]);

    const hoursYTD = (hoursRes.data ?? []).reduce((sum, r) => sum + (Number(r.hours) || 0), 0);
    const augustaDays = augustaRes.count ?? (augustaRes.data?.length ?? 0);
    const tripsThisYear = tripsRes.count ?? 0;
    const docsCount = docsCountRes.count ?? 0;
    const recentDocs = ((recentDocsRes.data ?? []) as DbDocumentRow[]).map(docRowToCard);

    setData((prev) => ({
      ...prev,
      hoursYTD,
      augustaDays,
      tripsThisYear,
      docsCount,
      recentDocs,
    }));
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => undefined);
    }, [refresh]),
  );

  useEffect(() => {
    loadComplianceRules().then(setRules).catch(() => undefined);
    return subscribeToRules(setRules);
  }, []);

  const hoursRequired = ruleNumber(rules, 'real_estate', 'hours_required', 750);
  const augustaMax = ruleNumber(rules, 'augusta_rule', 'max_days', 14);

  const strategies: Strategy[] = [
    {
      id: 's1',
      name: 'Material Participation',
      description: `${hoursRequired}-hour test for active losses`,
      icon: 'time-outline',
      progress: Math.round(data.hoursYTD),
      total: hoursRequired,
      unit: 'hrs',
      status: data.hoursYTD >= hoursRequired ? 'On Track' : 'Behind',
      statusVariant: data.hoursYTD >= hoursRequired ? 'success' : 'warning',
      accentColor: data.hoursYTD >= hoursRequired ? colors.teal : colors.amber,
    },
    {
      id: 's2',
      name: 'Augusta Rule',
      description: `Rent home to business — ${augustaMax} days max`,
      icon: 'home-outline',
      progress: data.augustaDays,
      total: augustaMax,
      unit: 'days',
      status: data.augustaDays <= augustaMax ? 'On Track' : 'Behind',
      statusVariant: data.augustaDays <= augustaMax ? 'success' : 'warning',
      accentColor: colors.teal,
    },
    {
      id: 's3',
      name: 'Business Travel',
      description: 'Documented business trips',
      icon: 'airplane-outline',
      progress: data.tripsThisYear,
      total: Math.max(data.tripsThisYear, 6),
      unit: 'trips',
      status: 'On Track',
      statusVariant: 'success',
      accentColor: colors.midNavy,
    },
  ];

  const hoursPct = Math.min(100, Math.round((data.hoursYTD / Math.max(1, hoursRequired)) * 100));
  const augustaPct = Math.min(100, Math.round((data.augustaDays / Math.max(1, augustaMax)) * 100));
  const hoursRemaining = Math.max(0, hoursRequired - Math.round(data.hoursYTD));

  return (
    <View style={styles.root}>
      <Header year={2026} />

      {visibleAnnouncement && (
        <AnnouncementBanner
          message={visibleAnnouncement.message}
          onDismiss={() =>
            setDismissedIds((prev) => {
              const next = new Set(prev);
              next.add(visibleAnnouncement.id);
              return next;
            })
          }
        />
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 96 + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <AlertBanner
          title={
            hoursRemaining === 0
              ? 'Material participation goal hit'
              : `${hoursRemaining} hours to material participation goal`
          }
          detail={
            hoursRemaining === 0
              ? 'You are at or past the threshold for this year.'
              : `Log ${hoursRemaining} more hours by Dec 31 to hit the ${hoursRequired}-hour threshold.`
          }
        />

        <View style={styles.metricsGrid}>
          <View style={styles.metricsRow}>
            <MetricCard
              label="Hours Logged"
              value={Math.round(data.hoursYTD).toString()}
              sublabel={`of ${hoursRequired} goal`}
              icon="time-outline"
              variant={data.hoursYTD >= hoursRequired ? 'teal' : 'amber'}
              progress={hoursPct}
            />
            <View style={styles.gap} />
            <MetricCard
              label="Augusta Days"
              value={data.augustaDays.toString()}
              sublabel={`of ${augustaMax} max`}
              icon="home-outline"
              variant="teal"
              progress={augustaPct}
            />
          </View>
          <View style={styles.gap} />
          <View style={styles.metricsRow}>
            <MetricCard
              label="Business Trips"
              value={data.tripsThisYear.toString()}
              sublabel="this year"
              icon="airplane-outline"
              variant="navy"
            />
            <View style={styles.gap} />
            <MetricCard
              label="Documents"
              value={data.docsCount.toString()}
              sublabel="in vault"
              icon="checkmark-done-outline"
              variant="info"
            />
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeader title="Strategies" action="View all" />
          <View style={styles.strategyList}>
            {strategies.map((s) => (
              <StrategyCard
                key={s.id}
                strategy={s}
                onPress={() => {
                  if (s.id === BUSINESS_TRAVEL_STRATEGY_ID) {
                    navigation.dispatch(
                      CommonActions.navigate({
                        name: 'Tabs',
                        params: { screen: 'Trips' },
                      }),
                    );
                    return;
                  }
                  navigation.navigate('StrategyDetail', { strategy: s });
                }}
              />
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeader title="Recent Documents" action="See all" />
          <Card padded>
            {data.recentDocs.map((d, i) => (
              <DocumentItem
                key={d.id}
                doc={d}
                isLast={i === data.recentDocs.length - 1}
                onPress={() =>
                  navigation.navigate('DocumentDetail', {
                    title: d.title,
                    meta: d.meta,
                    status: d.status,
                    statusVariant: d.statusVariant,
                  })
                }
              />
            ))}
          </Card>
        </View>
      </ScrollView>

      <View style={styles.voiceWrap}>
        <VoiceLogStrip />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.xl,
  },
  metricsGrid: {
    gap: 0,
  },
  metricsRow: {
    flexDirection: 'row',
  },
  gap: {
    width: spacing.md,
    height: spacing.md,
  },
  section: {
    gap: spacing.md,
  },
  strategyList: {
    gap: spacing.md,
  },
  voiceWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
