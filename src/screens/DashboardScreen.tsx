import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute, CommonActions } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../theme';
import { contentContainerStyle } from '../constants/layout';
import { Header } from '../components/Header';
import { AlertBanner } from '../components/AlertBanner';
import { AnnouncementBanner } from '../components/AnnouncementBanner';
import { RetentionBanner } from '../components/RetentionBanner';
import { useDocumentRetention } from '../hooks/useDocumentRetention';
import { MetricCard } from '../components/MetricCard';
import { StrategyCard, Strategy } from '../components/StrategyCard';
import { DocumentItem, DocumentRow } from '../components/DocumentItem';
import { SectionHeader } from '../components/SectionHeader';
import { VoiceLogStrip } from '../components/VoiceLogStrip';
import { Card } from '../components/Card';
import { LockedStrategySheet } from '../components/LockedStrategySheet';
import { useStrategyAccess, DASHBOARD_STRATEGY_KEYS } from '../hooks/useStrategyAccess';
import { useFeatureFlags } from '../context/FeatureFlagContext';
import type { RootStackParamList } from '../navigation/types';
import {
  supabase,
  requireUserId,
  type AnnouncementRow,
  type DocumentRow as DbDocumentRow,
  type HoursLogRow,
  type PropertyRow,
  type RePropertyType,
  type SubscriptionTier,
} from '../services/supabase';
import { useBusiness } from '../business/BusinessContext';
import { useAuth } from '../auth/AuthContext';
import {
  loadComplianceRules,
  subscribeToRules,
  type ComplianceRules,
} from '../services/complianceRules';
import {
  findShortfalls,
  MP_TEST_FROM_INT,
  type PropertyShortfall,
} from '../services/properties';
import {
  aggregateHours,
  readThresholds,
  mpHourThreshold,
  paceFor,
  type Pace,
} from '../services/realEstate';
import {
  calculateEffectiveMinHours,
  buildRepsRulesRecord,
} from '../utils/repsCalculations';
import {
  listAllStrategyDocuments,
  type StrategyDocumentRow,
} from '../services/strategyDocuments';
import {
  STRATEGY_COMPLIANCE_ROUTE,
  computeStrategyCompletion,
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
  properties: PropertyRow[];
  yearHours: HoursLogRow[];
  complianceDocs: StrategyDocumentRow[];
  // REPS Gate 1 inputs for the effective-target alert + weakest-link status.
  repsPursuitActive: boolean | null;
  totalWorkHours: number | null;
  rePropertyType: RePropertyType | null;
  reGroupingElection: boolean | null;
}

const EMPTY_DATA: DashboardData = {
  hoursYTD: 0,
  augustaDays: 0,
  tripsThisYear: 0,
  docsCount: 0,
  recentDocs: [],
  augustaMax: 14,
  properties: [],
  yearHours: [],
  complianceDocs: [],
  repsPursuitActive: null,
  totalWorkHours: null,
  rePropertyType: null,
  reGroupingElection: null,
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
  const route = useRoute();
  const { refreshProfile, businessOnboardingCompleted } = useAuth();
  const {
    activeBusinessId,
    businesses,
    loading: businessLoading,
  } = useBusiness();
  const retention = useDocumentRetention(activeBusinessId);

  // Fix 6: first-run business setup. If the user finished onboarding but has no
  // business record and hasn't skipped setup, route them to the setup screen
  // once. Guarded by a ref so returning to the Dashboard doesn't re-trigger it.
  const businessSetupPrompted = useRef(false);
  useEffect(() => {
    if (businessLoading || businessSetupPrompted.current) return;
    if (businesses.length === 0 && !businessOnboardingCompleted) {
      businessSetupPrompted.current = true;
      navigation.navigate('BusinessSetup');
    }
  }, [businessLoading, businesses.length, businessOnboardingCompleted, navigation]);

  // Show a "complete your business profile" prompt for users who skipped setup
  // (marked complete but still have no business record).
  const showBusinessProfilePrompt =
    !businessLoading && businesses.length === 0 && businessOnboardingCompleted;
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [rules, setRules] = useState<ComplianceRules | null>(null);
  const [announcement, setAnnouncement] = useState<AnnouncementRow | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());
  const access = useStrategyAccess();
  // Global feature-flag layer. A strategy/feature turned off here is hidden
  // entirely (on top of tier gating), and its cards never render.
  const { isEnabled: featureEnabled } = useFeatureFlags();
  const [lockedSheet, setLockedSheet] = useState<{ name: string } | null>(null);

  // STEP 4 of the upgrade flow: when we return from UpgradeStrategySelect with
  // an `upgradedTo` param, refetch tier + active_strategies fresh from Supabase
  // (never cached) so every strategy card re-renders with the new gating, then
  // show a 3-second welcome banner.
  const upgradedTo = (route.params as { upgradedTo?: SubscriptionTier } | undefined)?.upgradedTo;
  const [upgradeBannerTier, setUpgradeBannerTier] = useState<SubscriptionTier | null>(null);

  useEffect(() => {
    if (!upgradedTo) return;
    refreshProfile().catch(() => undefined);
    setUpgradeBannerTier(upgradedTo);
    // Clear the param so the banner doesn't reappear on the next focus.
    navigation.setParams({ upgradedTo: undefined } as never);
  }, [upgradedTo, refreshProfile, navigation]);

  useEffect(() => {
    if (!upgradeBannerTier) return;
    const t = setTimeout(() => setUpgradeBannerTier(null), 3000);
    return () => clearTimeout(t);
  }, [upgradeBannerTier]);

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
      .channel('client-announcements-' + Date.now())
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleAnnouncement =
    announcement && !dismissedIds.has(announcement.id) ? announcement : null;

  const refresh = useCallback(async () => {
    const currentYear = new Date().getFullYear();
    const yearStart = `${currentYear}-01-01`;
    const yearEnd = `${currentYear}-12-31`;
    const nextYearStart = `${currentYear + 1}-01-01`;
    const scope = activeBusinessId;

    let hoursQ = supabase
      .from('hours_log')
      .select('*')
      .gte('activity_date', yearStart)
      .lte('activity_date', yearEnd);
    if (scope) hoursQ = hoursQ.eq('business_id', scope);

    let propertiesQ = supabase.from('properties').select('*');
    if (scope) propertiesQ = propertiesQ.eq('business_id', scope);

    // Unified Augusta-day count: every completed Augusta meeting in this tax
    // year, no matter whether it was logged via the Minutes screen
    // ('Augusta Rule business meeting') or the Log Activity form ('augusta_rule')
    // — the case-insensitive 'Augusta%' prefix matches both.
    let augustaQ = supabase
      .from('meeting_minutes')
      .select('id, meeting_date', { count: 'exact' })
      .ilike('meeting_type', 'Augusta%')
      .eq('status', 'complete')
      .gte('meeting_date', yearStart)
      .lte('meeting_date', yearEnd);
    if (scope) augustaQ = augustaQ.eq('business_id', scope);

    // Count a trip toward this tax year if EITHER its departure_date falls in
    // the year OR it was created this year. The created_at fallback catches
    // trips logged from the AI Analyzer without a departure date, which a
    // departure_date-only filter would silently drop (they show in Trip
    // History but never increment this counter). created_at is a timestamp, so
    // its upper bound is the start of next year rather than Dec 31.
    let tripsQ = supabase
      .from('business_trips')
      .select('id', { count: 'exact', head: true })
      // Drafts are future-dated trips not yet finalized — they don't count.
      // `status.is.null` keeps legacy rows (null status) counting, since a
      // bare `neq` would drop them (NULL <> 'draft' is NULL, not true).
      .or('status.is.null,status.neq.draft')
      .or(
        `and(departure_date.gte.${yearStart},departure_date.lte.${yearEnd}),` +
          `and(created_at.gte.${yearStart},created_at.lt.${nextYearStart})`,
      );
    if (scope) tripsQ = tripsQ.eq('business_id', scope);

    let docsCountQ = supabase.from('documents').select('id', { count: 'exact', head: true });
    if (scope) docsCountQ = docsCountQ.eq('business_id', scope);

    let recentDocsQ = supabase
      .from('documents')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(3);
    if (scope) recentDocsQ = recentDocsQ.eq('business_id', scope);

    // User-level REPS settings (not business-scoped).
    const uid = await requireUserId();
    const userQ = supabase
      .from('users')
      .select(
        'reps_pursuit_active, total_work_hours_this_year, re_property_type, re_grouping_election',
      )
      .eq('id', uid)
      .maybeSingle();

    const [hoursRes, augustaRes, tripsRes, docsCountRes, recentDocsRes, propertiesRes, complianceDocs, userRes] =
      await Promise.all([
        hoursQ,
        augustaQ,
        tripsQ,
        docsCountQ,
        recentDocsQ,
        propertiesQ,
        listAllStrategyDocuments(scope).catch(() => [] as StrategyDocumentRow[]),
        userQ,
      ]);

    const userRow = (userRes.data ?? {}) as {
      reps_pursuit_active?: boolean | null;
      total_work_hours_this_year?: number | null;
      re_property_type?: RePropertyType | null;
      re_grouping_election?: boolean | null;
    };

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
      repsPursuitActive: userRow.reps_pursuit_active ?? null,
      totalWorkHours:
        userRow.total_work_hours_this_year != null
          ? Number(userRow.total_work_hours_this_year)
          : null,
      rePropertyType: userRow.re_property_type ?? null,
      reGroupingElection: userRow.re_grouping_election ?? null,
    }));
  }, [activeBusinessId]);

  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => undefined);
    }, [refresh]),
  );

  // Live-update the metric cards (notably Business Trips) when a trip is saved
  // from the AI Analyzer / Log Trip form while the Dashboard is already mounted
  // — useFocusEffect above only refires on navigation, not on a background
  // insert. Mirrors the announcements real-time subscription pattern.
  useEffect(() => {
    const channel = supabase
      .channel('business-trips-count-' + Date.now())
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'business_trips' },
        () => {
          refresh().catch(() => undefined);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  useEffect(() => {
    loadComplianceRules().then(setRules).catch(() => undefined);
    return subscribeToRules(setRules);
  }, []);

  const augustaMax = ruleNumber(rules, 'augusta_rule', 'max_days', 14);

  // Effective REPS target: when the client is pursuing REPS and works enough
  // total hours that "more than 50%" exceeds the 750-hour test, the binding
  // target rises above 750. Thresholds come from compliance_rules.
  const reps750 = ruleNumber(rules, 'real_estate', 'reps_gate1_hours', 750);
  const repsActive = data.repsPursuitActive === true;
  // Shared single source of truth with the Hours screen — both feed the same
  // compliance_rules map + total work hours into calculateEffectiveMinHours,
  // unconditionally (the Hours screen computes its target the same way), so the
  // two screens can never show different targets for the same user data. With no
  // total-work-hours on file this floors at the 750-hour Gate 1 test.
  const effectiveTarget = calculateEffectiveMinHours(
    data.totalWorkHours ?? 0,
    buildRepsRulesRecord(rules?.rawDb ?? []),
  );
  // The 50% rule raises the bar above the 750-hour test only when it yields a
  // higher minimum.
  const fiftyBinds = effectiveTarget > reps750;

  // Weakest-link status for the Real Estate strategy card: the worst pace
  // across the combined REPS tracker (if active), each long-term property or
  // MP-test group, and each short-term property. Needs Attention overrides In
  // Progress overrides On Track.
  const realEstateStatus = (() => {
    const thresholds = readThresholds(rules?.rawDb ?? []);
    const agg = aggregateHours(data.yearHours, data.properties);
    const reHours =
      agg.totals.reps_general +
      agg.totals.material_participation +
      agg.totals.str_participation;
    const paces: Pace[] = [];

    if (repsActive) {
      paces.push(paceFor(effectiveTarget > 0 ? reHours / effectiveTarget : 0).label);
    }

    const longTerm = data.properties.filter((p) => p.property_type === 'long_term');
    const shortTerm = data.properties.filter((p) => p.property_type === 'short_term');
    const grouping = data.reGroupingElection === true;

    const testThreshold = (p: PropertyRow): number | null => {
      const test =
        p.mp_test_selected != null ? MP_TEST_FROM_INT[p.mp_test_selected] ?? null : null;
      return test ? mpHourThreshold(test, thresholds) : null;
    };

    if (grouping) {
      // Combine long-term properties by their selected MP test.
      const byTest = new Map<number, { hours: number; threshold: number | null }>();
      for (const p of longTerm) {
        if (p.mp_test_selected == null) continue;
        const entry = byTest.get(p.mp_test_selected) ?? {
          hours: 0,
          threshold: testThreshold(p),
        };
        entry.hours += agg.perProperty.get(p.id) ?? 0;
        byTest.set(p.mp_test_selected, entry);
      }
      for (const { hours, threshold } of byTest.values()) {
        if (threshold != null) paces.push(paceFor(hours / threshold).label);
      }
    } else {
      for (const p of longTerm) {
        const t = testThreshold(p);
        if (t != null) paces.push(paceFor((agg.perProperty.get(p.id) ?? 0) / t).label);
      }
    }

    for (const p of shortTerm) {
      const t = testThreshold(p);
      if (t != null) paces.push(paceFor((agg.perProperty.get(p.id) ?? 0) / t).label);
    }

    // No real-estate signals (no properties, REPS off) — fall back to the
    // generic material-participation pace so the card still reflects progress.
    if (paces.length === 0) {
      paces.push(paceFor(effectiveTarget > 0 ? data.hoursYTD / effectiveTarget : 0).label);
    }

    const rank: Record<Pace, number> = {
      'At Risk': 0,
      'In Progress': 1,
      'On Track': 2,
    };
    const worst = paces.reduce((acc, p) => (rank[p] < rank[acc] ? p : acc), 'On Track' as Pace);
    if (worst === 'On Track') return { status: 'On Track', variant: 'success' as const };
    if (worst === 'In Progress') return { status: 'In Progress', variant: 'info' as const };
    return { status: 'Needs Attention', variant: 'warning' as const };
  })();

  const strategies: Strategy[] = [
    {
      id: 's1',
      name: 'Material Participation',
      description: `${effectiveTarget}-hour test for active losses`,
      icon: 'time-outline',
      progress: Math.round(data.hoursYTD),
      // Effective REPS target (rises above 750 when the 50% rule binds) so the
      // progress bar + "X / Y hrs" meta match the Hours screen, not a flat 750.
      total: effectiveTarget,
      unit: 'hrs',
      status: realEstateStatus.status,
      statusVariant: realEstateStatus.variant,
      accentColor:
        realEstateStatus.variant === 'warning' ? colors.amber : colors.teal,
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
      // No required target/maximum for business trips — the card shows a plain
      // "X trips this year" count via hideTarget rather than an X/6 ratio.
      total: Math.max(data.tripsThisYear, 1),
      unit: 'trips',
      hideTarget: true,
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
    // Shared source of truth (registry slots + file_url presence, with the
    // Home Office lease→closing alias). Keeps the cards in lockstep with the
    // strategy screens and the Documents tab.
    const { completed, total } = computeStrategyCompletion(
      c.strategyKey,
      data.complianceDocs,
    );
    return { ...c, completed, total };
  });

  const hoursPct = Math.min(100, Math.round((data.hoursYTD / Math.max(1, effectiveTarget)) * 100));
  const augustaPct = Math.min(100, Math.round((data.augustaDays / Math.max(1, augustaMax)) * 100));
  const hoursRemaining = Math.max(0, effectiveTarget - Math.round(data.hoursYTD));

  // Per-property warnings: any ungrouped property (or grouping-election group)
  // that is behind on the material participation threshold. This fires
  // independently of the overall hoursYTD-vs-threshold check so a user with
  // many small properties cannot hide one that is way behind. The threshold and
  // the displayed minimum both come from the shared effective REPS target
  // (calculateEffectiveMinHours) — never a hardcoded 750 — so when the 50% rule
  // binds the warning reflects the higher calculated number.
  const propertyShortfalls: PropertyShortfall[] = findShortfalls(
    data.properties,
    data.yearHours,
    effectiveTarget,
  );
  const worstShortfall: PropertyShortfall | null =
    propertyShortfalls.length > 0
      ? propertyShortfalls.reduce((worst, s) => (s.hours < worst.hours ? s : worst))
      : null;
  // Show the full property_name straight from the properties table — no
  // truncation, no string concatenation — so the banner names the real property.
  const propertyAlertTitle = worstShortfall
    ? `${
        worstShortfall.groupName
          ? `${worstShortfall.groupName} group`
          : worstShortfall.property.property_name
      } has only ${worstShortfall.hours.toFixed(0)} hours`
    : null;
  const otherBehindCount = worstShortfall ? propertyShortfalls.length - 1 : 0;
  const propertyAlertDetail = worstShortfall
    ? `Needs ${effectiveTarget} hours to qualify for REPS${
        worstShortfall.groupName ? ' as a group' : ''
      }.${
        otherBehindCount > 0
          ? ` ${otherBehindCount} more ${
              otherBehindCount === 1 ? 'property' : 'properties'
            } behind pace.`
          : ''
      }`
    : null;

  return (
    <View style={styles.root}>
      <Header year={2026} />

      {featureEnabled('document_retention_warnings') && retention.warning ? (
        <RetentionBanner
          warning={retention.warning}
          onDownloadAll={retention.downloadAll}
          onDismiss={retention.dismiss}
          progress={retention.progress}
        />
      ) : null}

      {upgradeBannerTier && (
        <View style={styles.upgradeBanner}>
          <Ionicons name="checkmark-circle" size={18} color={colors.white} />
          <Text style={styles.upgradeBannerText}>
            Welcome to {upgradeBannerTier === 'pro' ? 'Pro' : 'Core'}! Your new
            strategies are now active.
          </Text>
        </View>
      )}

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

      {showBusinessProfilePrompt && (
        <View style={styles.businessPrompt}>
          <View style={styles.businessPromptText}>
            <Ionicons name="business-outline" size={18} color={colors.navy} />
            <Text style={styles.businessPromptLabel}>
              Complete your business profile to unlock all features
            </Text>
          </View>
          <Pressable
            style={styles.businessPromptBtn}
            onPress={() => navigation.navigate('BusinessSetup')}
          >
            <Text style={styles.businessPromptBtnText}>Set Up Now</Text>
          </Pressable>
        </View>
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 96 + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[contentContainerStyle, styles.contentInner]}>
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
              : `${hoursRemaining} more hours needed by Dec 31`
          }
          detail={
            hoursRemaining === 0
              ? 'You are at or past the threshold for this year.'
              : `${hoursRemaining} more hours needed by Dec 31. Your minimum is ${effectiveTarget} hours${
                  fiftyBinds
                    ? ` because you work ${data.totalWorkHours} hours in non-real-estate activities and need more real estate hours than that to spend more than half your total working time in real estate`
                    : ''
                }.`
          }
        />

        <View style={styles.metricsGrid}>
          <View style={styles.metricsRow}>
            <MetricCard
              label="Hours Logged"
              value={Math.round(data.hoursYTD).toString()}
              sublabel={`of ${effectiveTarget} goal`}
              icon="time-outline"
              variant={data.hoursYTD >= effectiveTarget ? 'teal' : 'amber'}
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
              sublabel="This year"
              sublabelStyle={{ color: '#AAAAAA', fontSize: 10 }}
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
          <SectionHeader
            title="Strategies"
            action="View all"
            onAction={() =>
              navigation.dispatch(
                CommonActions.navigate({ name: 'Tabs', params: { screen: 'Docs' } }),
              )
            }
          />
          <View style={styles.strategyList}>
            {strategies
              .filter((s) => {
                // Hide a strategy card entirely when its global flag is off.
                const key = DASHBOARD_STRATEGY_KEYS[s.id];
                return !key || featureEnabled(key);
              })
              .map((s) => {
              const stratKey = DASHBOARD_STRATEGY_KEYS[s.id];
              // Business Travel is unlocked by tier (Core/Pro), not by an
              // explicit active_strategies entry — it activates automatically.
              const locked = stratKey
                ? stratKey === 'business_travel'
                  ? !(access.isAdmin || access.tier === 'core' || access.tier === 'pro')
                  : !access.hasStrategy(stratKey)
                : false;
              const onCardPress = () => {
                if (locked && stratKey) {
                  setLockedSheet({ name: s.name });
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
                      <Ionicons name="lock-closed" size={20} color={colors.amber} />
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
            {complianceCards
              .filter((card) => featureEnabled(card.strategyKey))
              .map((card) => {
              const pct = card.total === 0 ? 0 : Math.round((card.completed / card.total) * 100);
              const done = card.completed === card.total && card.total > 0;
              // Document generator cards follow the same gating as the strategy
              // cards above: if the strategy isn't in active_strategies the card
              // is grayed with an amber padlock and tapping opens the upgrade
              // sheet instead of navigating. Admins (hasStrategy returns true)
              // are never locked.
              const locked = !access.hasStrategy(card.strategyKey);
              const onPress = () => {
                if (locked) {
                  setLockedSheet({ name: card.title });
                  return;
                }
                navigation.navigate(STRATEGY_COMPLIANCE_ROUTE[card.strategyKey] as never);
              };
              const inner = (
                <>
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
                </>
              );
              if (locked) {
                return (
                  <Pressable key={card.strategyKey} onPress={onPress} style={styles.lockedWrap}>
                    <View pointerEvents="none" style={[styles.complianceCard, styles.lockedInner]}>
                      {inner}
                    </View>
                    <View style={styles.lockedBadge}>
                      <Ionicons name="lock-closed" size={20} color={colors.amber} />
                    </View>
                  </Pressable>
                );
              }
              return (
                <Pressable
                  key={card.strategyKey}
                  onPress={onPress}
                  style={({ pressed }) => [
                    styles.complianceCard,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  {inner}
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
        </View>
      </ScrollView>

      <View style={styles.voiceWrap}>
        <VoiceLogStrip />
      </View>

      <LockedStrategySheet
        visible={lockedSheet !== null}
        strategyName={lockedSheet?.name ?? ''}
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
  // The tablet max-width wrapper is a single child of the ScrollView content, so
  // the content container's `gap` no longer spaces the real children — the
  // wrapper reproduces that spacing itself. No-op difference on phones.
  contentInner: {
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
  upgradeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.teal,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  upgradeBannerText: {
    flex: 1,
    color: colors.white,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  businessPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.amberLight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  businessPromptText: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  businessPromptLabel: {
    flex: 1,
    color: colors.navy,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  businessPromptBtn: {
    backgroundColor: colors.navy,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  businessPromptBtnText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '700',
  },
});
