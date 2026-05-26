import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, CommonActions } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
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
import { LockedStrategySheet } from '../components/LockedStrategySheet';
import { useStrategyAccess, DASHBOARD_STRATEGY_KEYS } from '../hooks/useStrategyAccess';
import type { RootStackParamList } from '../navigation/types';
import {
  supabase,
  type AnnouncementRow,
  type DocumentRow as DbDocumentRow,
  type HoursLogRow,
  type PropertyRow,
} from '../services/supabase';
import { useBusiness } from '../business/BusinessContext';
import {
  loadComplianceRules,
  subscribeToRules,
  type ComplianceRules,
} from '../services/complianceRules';
import { findShortfalls, type PropertyShortfall } from '../services/properties';
import {
  listAllStrategyDocuments,
  type StrategyDocumentRow,
} from '../services/strategyDocuments';
import {
  STRATEGY_COMPLIANCE_SLOTS,
  STRATEGY_COMPLIANCE_ROUTE,
} from '../services/strategyComplianceSlots';

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
  properties: PropertyRow[];
  yearHours: HoursLogRow[];
  complianceDocs: StrategyDocumentRow[];
}

const EMPTY_DATA: DashboardData = {
  hoursYTD: 0,
  augustaDays: 0,
  tripsThisYear: 0,
  docsCount: 0,
  recentDocs: [],
  augustaMax: 14,
  hoursRequired: 750,
  properties: [],
  yearHours: [],
  complianceDocs: [],
};

interface ComplianceCard {
  strategyKey: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  completed: number;
  total: number;
}

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
  const { activeBusinessId } = useBusiness();
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [rules, setRules] = useState<ComplianceRules | null>(null);
  const [announcement, setAnnouncement] = useState<AnnouncementRow | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());
  const access = useStrategyAccess();
  const [lockedSheet, setLockedSheet] = useState<{ key: string; name: string; description: string } | null>(null);

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
    const scope = activeBusinessId;

    let hoursQ = supabase
      .from('hours_log')
      .select('*')
      .gte('activity_date', yearStart)
      .lte('activity_date', yearEnd);
    if (scope) hoursQ = hoursQ.eq('business_id', scope);

    let propertiesQ = supabase.from('properties').select('*');
    if (scope) propertiesQ = propertiesQ.eq('business_id', scope);

    let augustaQ = supabase
      .from('meeting_minutes')
      .select('id, meeting_date', { count: 'exact' })
      .ilike('meeting_type', 'Augusta%')
      .gte('meeting_date', yearStart)
      .lte('meeting_date', yearEnd);
    if (scope) augustaQ = augustaQ.eq('business_id', scope);

    let tripsQ = supabase
      .from('business_trips')
      .select('id', { count: 'exact', head: true })
      .gte('departure_date', yearStart)
      .lte('departure_date', yearEnd);
    if (scope) tripsQ = tripsQ.eq('business_id', scope);

    let docsCountQ = supabase.from('documents').select('id', { count: 'exact', head: true });
    if (scope) docsCountQ = docsCountQ.eq('business_id', scope);

    let recentDocsQ = supabase
      .from('documents')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(3);
    if (scope) recentDocsQ = recentDocsQ.eq('business_id', scope);

    const [hoursRes, augustaRes, tripsRes, docsCountRes, recentDocsRes, propertiesRes, complianceDocs] =
      await Promise.all([
        hoursQ,
        augustaQ,
        tripsQ,
        docsCountQ,
        recentDocsQ,
        propertiesQ,
        listAllStrategyDocuments(scope).catch(() => [] as StrategyDocumentRow[]),
      ]);

    const yearHours = (hoursRes.data ?? []) as HoursLogRow[];
    const hoursYTD = yearHours.reduce((sum, r) => sum + (Number(r.hours) || 0), 0);
    const augustaDays = augustaRes.count ?? (augustaRes.data?.length ?? 0);
    const tripsThisYear = tripsRes.count ?? 0;
    const docsCount = docsCountRes.count ?? 0;
    const recentDocs = ((recentDocsRes.data ?? []) as DbDocumentRow[]).map(docRowToCard);
    const properties = (propertiesRes.data ?? []) as PropertyRow[];

    setData((prev) => ({
      ...prev,
      hoursYTD,
      augustaDays,
      tripsThisYear,
      docsCount,
      recentDocs,
      properties,
      yearHours,
      complianceDocs,
    }));
  }, [activeBusinessId]);

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

  const complianceCardDefs: Pick<ComplianceCard, 'strategyKey' | 'title' | 'icon'>[] = [
    { strategyKey: 's_corp', title: 'S-Corp', icon: 'business-outline' },
    { strategyKey: 'home_office', title: 'Home Office', icon: 'home-outline' },
    { strategyKey: 'family_management', title: 'Family Mgmt', icon: 'people-outline' },
  ];
  const complianceCards: ComplianceCard[] = complianceCardDefs.map((c) => {
    const slots = STRATEGY_COMPLIANCE_SLOTS[c.strategyKey] ?? [];
    const rows = data.complianceDocs.filter(
      (r) => r.strategy_key === c.strategyKey && r.file_url,
    );
    const satisfied = new Set(rows.map((r) => r.document_key));
    // Home Office residence: lease satisfies the closing-disclosure slot.
    if (c.strategyKey === 'home_office' && satisfied.has('lease_agreement')) {
      satisfied.add('closing_disclosure');
    }
    const completed = slots.reduce((n, s) => n + (satisfied.has(s.key) ? 1 : 0), 0);
    return { ...c, completed, total: slots.length };
  });

  const hoursPct = Math.min(100, Math.round((data.hoursYTD / Math.max(1, hoursRequired)) * 100));
  const augustaPct = Math.min(100, Math.round((data.augustaDays / Math.max(1, augustaMax)) * 100));
  const hoursRemaining = Math.max(0, hoursRequired - Math.round(data.hoursYTD));

  // Per-property warnings: any ungrouped property (or grouping-election group)
  // that is behind on the material participation threshold. This fires
  // independently of the overall hoursYTD-vs-threshold check so a user with
  // many small properties cannot hide one that is way behind.
  const propertyShortfalls: PropertyShortfall[] = findShortfalls(
    data.properties,
    data.yearHours,
    hoursRequired,
  );
  const worstShortfall: PropertyShortfall | null =
    propertyShortfalls.length > 0
      ? propertyShortfalls.reduce((worst, s) => (s.hours < worst.hours ? s : worst))
      : null;
  const propertyAlertTitle = worstShortfall
    ? `Warning: ${
        worstShortfall.groupName
          ? `${worstShortfall.groupName} group`
          : worstShortfall.property.property_name
      } has only ${worstShortfall.hours.toFixed(0)} hours`
    : null;
  const propertyAlertDetail = worstShortfall
    ? `Needs ${hoursRequired} to meet material participation${
        worstShortfall.groupName ? ' as a group' : ' individually'
      }${
        propertyShortfalls.length > 1
          ? ` · ${propertyShortfalls.length - 1} more ${
              propertyShortfalls.length - 1 === 1 ? 'property' : 'properties'
            } behind`
          : ''
      }.`
    : null;

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
        {propertyAlertTitle && propertyAlertDetail ? (
          <AlertBanner
            title={propertyAlertTitle}
            detail={propertyAlertDetail}
            onPress={() => navigation.navigate('Properties')}
          />
        ) : null}

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
            {strategies.map((s) => {
              const stratKey = DASHBOARD_STRATEGY_KEYS[s.id];
              const locked = stratKey ? !access.hasStrategy(stratKey) : false;
              const onCardPress = () => {
                if (locked && stratKey) {
                  setLockedSheet({ key: stratKey, name: s.name, description: s.description });
                  return;
                }
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
              };
              if (locked) {
                return (
                  <Pressable key={s.id} onPress={onCardPress} style={styles.lockedWrap}>
                    <View pointerEvents="none" style={styles.lockedInner}>
                      <StrategyCard strategy={s} />
                    </View>
                    <View style={styles.lockedBadge}>
                      <Ionicons name="lock-closed" size={16} color={colors.amber} />
                    </View>
                  </Pressable>
                );
              }
              return <StrategyCard key={s.id} strategy={s} onPress={onCardPress} />;
            })}
          </View>
        </View>

        <View style={styles.section}>
          <SectionHeader title="Compliance Documents" />
          <View style={styles.complianceList}>
            {complianceCards.map((card) => {
              const pct = card.total === 0 ? 0 : Math.round((card.completed / card.total) * 100);
              const done = card.completed === card.total && card.total > 0;
              return (
                <Pressable
                  key={card.strategyKey}
                  onPress={() =>
                    navigation.navigate(STRATEGY_COMPLIANCE_ROUTE[card.strategyKey] as never)
                  }
                  style={({ pressed }) => [
                    styles.complianceCard,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <View style={[styles.complianceIcon, { backgroundColor: done ? colors.tealLight : colors.lightBlue }]}>
                    <Ionicons
                      name={card.icon}
                      size={18}
                      color={done ? colors.teal : colors.midNavy}
                    />
                  </View>
                  <View style={styles.complianceText}>
                    <Text style={styles.complianceTitle}>{card.title}</Text>
                    <Text style={styles.complianceMeta}>
                      {card.completed} of {card.total} documents
                    </Text>
                  </View>
                  <View style={styles.compliancePctWrap}>
                    <Text style={[styles.compliancePct, { color: done ? colors.teal : colors.midNavy }]}>
                      {pct}%
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.mutedText} />
                  </View>
                </Pressable>
              );
            })}
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

      <LockedStrategySheet
        visible={lockedSheet !== null}
        title={lockedSheet?.name ?? ''}
        description={lockedSheet?.description ?? ''}
        requiredTier={access.requiredTierFor(lockedSheet?.key ?? '')}
        onClose={() => setLockedSheet(null)}
      />
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
  lockedWrap: {
    position: 'relative',
  },
  lockedInner: {
    opacity: 0.5,
  },
  lockedBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(186,117,23,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  complianceList: {
    gap: spacing.sm,
  },
  complianceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  complianceIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  complianceText: {
    flex: 1,
  },
  complianceTitle: {
    color: colors.bodyText,
    fontSize: 14,
    fontWeight: '700',
  },
  complianceMeta: {
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 2,
  },
  compliancePctWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  compliancePct: {
    fontSize: 13,
    fontWeight: '700',
  },
});
