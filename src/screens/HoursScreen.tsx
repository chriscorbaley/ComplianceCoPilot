import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Audio } from 'expo-av';
import { BarChart as RawBarChart } from 'react-native-chart-kit';
import type { BarChartProps } from 'react-native-chart-kit/dist/BarChart';

const BarChart = RawBarChart as unknown as React.ComponentType<BarChartProps>;
import { colors, radius, shadow, spacing, typography } from '../theme';
import { Header } from '../components/Header';
import { AlertBanner } from '../components/AlertBanner';
import { MetricCard } from '../components/MetricCard';
import { Card } from '../components/Card';
import { ProgressBar } from '../components/ProgressBar';
import { SectionHeader } from '../components/SectionHeader';
import { EditableListRow } from '../components/EditableListRow';
import { EditFormSheet } from '../components/EditFormSheet';
import { DatePickerModal } from '../components/DateInputField';
import { type ActivityHoursType } from '../services/activityLog';
import {
  classifyFromRecording,
  ensureMicPermission,
  startRecording,
  MissingProxyError,
  ProxyUnreachableError,
  type ClassifiedNote,
} from '../services/openai';
import { consume, peek } from '../services/voiceInbox';
import {
  supabase,
  requireUserId,
  type HoursLogRow,
  type PropertyRow,
} from '../services/supabase';
import {
  listProperties,
  MP_TEST_FROM_INT,
  MP_TEST_SHORT_LABEL,
  MP_TEST_SETUP_ORDER,
} from '../services/properties';
import {
  aggregateHours,
  readThresholds,
  mpHourThreshold,
  paceFor,
} from '../services/realEstate';
import {
  calculateEffectiveMinHours,
  buildRepsRulesRecord,
} from '../utils/repsCalculations';
import { StatusPill, type StatusVariant } from '../components/StatusPill';
import {
  loadComplianceRules,
  subscribeToRules,
  type ComplianceRules,
} from '../services/complianceRules';
import { saveActivityDocument, deriveHoursType } from '../services/activityLog';
import { useBusiness } from '../business/BusinessContext';
import { useAuth } from '../auth/AuthContext';
import { generateRealEstateReport } from '../services/realEstateReport';
import { useKeepAwakeWhile } from '../hooks/useKeepAwakeWhile';
import { KeepAwakeIndicator } from '../components/KeepAwakeIndicator';
import { useStrategyAccess } from '../hooks/useStrategyAccess';
import { LockedScreen } from '../components/LockedScreen';

const FUTURE_PLACEHOLDER = 32;

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

interface ActivityEntry {
  id: string;
  title: string;
  category: string;
  hours: number;
  date: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const STRATEGY_TO_CATEGORY: Record<string, { category: string; icon: keyof typeof Ionicons.glyphMap }> = {
  real_estate: { category: 'Property Management', icon: 'home-outline' },
  augusta_rule: { category: 'Augusta Rule', icon: 'home-outline' },
  s_corp: { category: 'Admin', icon: 'briefcase-outline' },
  business_travel: { category: 'Travel', icon: 'airplane-outline' },
  home_office: { category: 'Admin', icon: 'desktop-outline' },
  family_management: { category: 'Family Mgmt', icon: 'people-outline' },
  str: { category: 'Short-term Rental', icon: 'bed-outline' },
};

const CATEGORY_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  'Property Management': 'home-outline',
  Admin: 'document-text-outline',
  Maintenance: 'construct-outline',
  Leasing: 'call-outline',
  Travel: 'airplane-outline',
  'Augusta Rule': 'home-outline',
  'Family Mgmt': 'people-outline',
  'Short-term Rental': 'bed-outline',
};

const iconForCategory = (cat: string | null | undefined): keyof typeof Ionicons.glyphMap =>
  (cat && CATEGORY_ICON[cat]) || 'time-outline';

const rowToActivity = (row: HoursLogRow): ActivityEntry => ({
  id: row.id,
  title: row.description ?? 'Logged activity',
  category: row.category ?? 'Admin',
  hours: row.hours ?? 0,
  date: row.activity_date ? formatDateLabel(row.activity_date) : '',
  icon: iconForCategory(row.category),
});

const hexToRgb = (hex: string): string => {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r}, ${g}, ${b}`;
};

const CHART_PAST_RGB = hexToRgb(colors.midNavy);
const CHART_FUTURE_RGB = hexToRgb(colors.lightBlue);

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const formatDateLabel = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
};

const noteToInsert = (
  note: ClassifiedNote,
  userId: string,
  businessId: string | null,
  property: PropertyRow | null,
) => {
  const map = STRATEGY_TO_CATEGORY[note.strategy_category] ?? {
    category: 'Admin',
  };
  return {
    user_id: userId,
    business_id: businessId,
    property_id: property?.id ?? null,
    description: note.description || note.business_purpose || 'Voice-logged activity',
    category: map.category,
    hours: note.duration_hours ?? 0,
    activity_date: note.date,
    // Record the participation bucket so the audit table/export can show it.
    hours_type: deriveHoursType(property?.property_type ?? null),
  };
};

// ── Date helpers (shared by the filter sheet + edit sheet) ──────────────────

// Local-time YYYY-MM-DD for a Date — matches how hours_log.activity_date is
// stored, so string comparisons in the filter never drift across time zones.
const toISODateLocal = (date: Date): string => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

// Parse a stored ISO calendar date (YYYY-MM-DD) into a local Date with no
// time-zone shift.
const parseISODateLocal = (iso: string | null): Date | null => {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

// MM/DD/YYYY display for the edit-sheet date field.
const formatDateMMDDYYYY = (date: Date): string => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}/${date.getFullYear()}`;
};

const MIN_ACTIVITY_DATE = new Date('2020-01-01');

// ── Filter model ────────────────────────────────────────────────────────────

type DateRangeKey = 'week' | 'month' | 'quarter' | 'year' | 'custom';
type HoursTypeFilter = 'all' | ActivityHoursType;
// propertyFilter sentinel values: 'all' (every property), '__general__' (rows
// with no property), or a concrete property id.
const GENERAL_FILTER_KEY = '__general__';

interface HoursFilters {
  dateRange: DateRangeKey;
  customStart: Date | null;
  customEnd: Date | null;
  propertyFilter: string;
  hoursType: HoursTypeFilter;
}

const DEFAULT_FILTERS: HoursFilters = {
  dateRange: 'year',
  customStart: null,
  customEnd: null,
  propertyFilter: 'all',
  hoursType: 'all',
};

const DATE_RANGE_OPTIONS: Array<{ key: DateRangeKey; label: string }> = [
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'year', label: 'This year' },
  { key: 'custom', label: 'Custom range' },
];

const HOURS_TYPE_OPTIONS: Array<{ key: HoursTypeFilter; label: string }> = [
  { key: 'all', label: 'All types' },
  { key: 'reps_general', label: 'REPS General' },
  { key: 'material_participation', label: 'Material Participation' },
  { key: 'str_participation', label: 'STR Participation' },
];

// The three editable hours_type buckets (no "all" — every row has one).
const HOURS_TYPE_EDIT_OPTIONS: Array<{ key: ActivityHoursType; label: string }> = [
  { key: 'reps_general', label: 'REPS General' },
  { key: 'material_participation', label: 'Material Participation' },
  { key: 'str_participation', label: 'STR Participation' },
];

// Resolve a filter into inclusive YYYY-MM-DD bounds (null = open-ended).
const computeDateRange = (
  filters: HoursFilters,
  now: Date = new Date(),
): { start: string | null; end: string | null } => {
  const y = now.getFullYear();
  switch (filters.dateRange) {
    case 'week': {
      const start = new Date(now);
      start.setDate(now.getDate() - now.getDay()); // back to Sunday
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return { start: toISODateLocal(start), end: toISODateLocal(end) };
    }
    case 'month': {
      const start = new Date(y, now.getMonth(), 1);
      const end = new Date(y, now.getMonth() + 1, 0);
      return { start: toISODateLocal(start), end: toISODateLocal(end) };
    }
    case 'quarter': {
      const q = Math.floor(now.getMonth() / 3);
      const start = new Date(y, q * 3, 1);
      const end = new Date(y, q * 3 + 3, 0);
      return { start: toISODateLocal(start), end: toISODateLocal(end) };
    }
    case 'year':
      return { start: `${y}-01-01`, end: `${y}-12-31` };
    case 'custom':
      return {
        start: filters.customStart ? toISODateLocal(filters.customStart) : null,
        end: filters.customEnd ? toISODateLocal(filters.customEnd) : null,
      };
  }
};

const countActiveFilters = (f: HoursFilters): number => {
  let n = 0;
  if (f.dateRange !== 'year') n += 1;
  if (f.propertyFilter !== 'all') n += 1;
  if (f.hoursType !== 'all') n += 1;
  return n;
};

export const HoursScreen: React.FC = () => {
  const access = useStrategyAccess();
  if (!access.hasAnyStrategy(['real_estate', 'str'])) {
    return (
      <LockedScreen
        title="Hours tracking"
        description="The Hours tab tracks material participation for Real Estate Professional Status and Short-Term Rentals. Activate one of those strategies to unlock it."
        requiredTier={access.tier === 'starter' ? 'Core' : 'Pro'}
      />
    );
  }
  return <HoursScreenInner />;
};

const HoursScreenInner: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useBusiness();
  const { session, fullName } = useAuth();
  const [reportGenerating, setReportGenerating] = useState(false);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [rows, setRows] = useState<HoursLogRow[]>([]);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  // REPS Gate 1 inputs: portfolio shape + pursuit flag + total annual work
  // hours from the users row, and the live compliance_rules snapshot.
  const [repsSettings, setRepsSettings] = useState<{
    rePropertyType: string | null;
    repsPursuitActive: boolean | null;
    totalWorkHours: number | null;
    reGroupingElection: boolean | null;
  }>({
    rePropertyType: null,
    repsPursuitActive: null,
    totalWorkHours: null,
    reGroupingElection: null,
  });
  const [rules, setRules] = useState<ComplianceRules | null>(null);
  const [lastLoggedHours, setLastLoggedHours] = useState<number | null>(null);
  const [pendingNote, setPendingNote] = useState<ClassifiedNote | null>(null);
  const [expandedPropertyKeys, setExpandedPropertyKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [repsInfoOpen, setRepsInfoOpen] = useState(false);
  const [filters, setFilters] = useState<HoursFilters>(DEFAULT_FILTERS);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<HoursLogRow | null>(null);
  const recRef = useRef<Audio.Recording | null>(null);
  const pulse = useRef(new Animated.Value(0)).current;

  useKeepAwakeWhile(recording, 'hours-screen');

  const loadHours = useCallback(async () => {
    try {
      const userId = await requireUserId();
      const year = new Date().getFullYear();
      let query = supabase
        .from('hours_log')
        .select('*')
        .eq('user_id', userId)
        .gte('activity_date', `${year}-01-01`)
        .lte('activity_date', `${year}-12-31`)
        .order('activity_date', { ascending: false });
      if (activeBusinessId) query = query.eq('business_id', activeBusinessId);
      const { data, error } = await query;
      if (error) throw error;
      setRows((data ?? []) as HoursLogRow[]);
    } catch (e) {
      console.warn('[hours] loadHours failed', e);
      Alert.alert('Could not load hours', e instanceof Error ? e.message : String(e));
    }
  }, [activeBusinessId]);

  const loadProperties = useCallback(async () => {
    try {
      const list = await listProperties(activeBusinessId);
      setProperties(list);
    } catch (e) {
      console.warn('[hours] loadProperties failed', e);
    }
  }, [activeBusinessId]);

  const loadRepsSettings = useCallback(async () => {
    try {
      const userId = await requireUserId();
      const { data, error } = await supabase
        .from('users')
        .select(
          're_property_type, reps_pursuit_active, total_work_hours_this_year, re_grouping_election',
        )
        .eq('id', userId)
        .maybeSingle();
      if (error) throw error;
      const row = (data ?? {}) as {
        re_property_type?: string | null;
        reps_pursuit_active?: boolean | null;
        total_work_hours_this_year?: number | null;
        re_grouping_election?: boolean | null;
      };
      setRepsSettings({
        rePropertyType: row.re_property_type ?? null,
        repsPursuitActive: row.reps_pursuit_active ?? null,
        totalWorkHours:
          row.total_work_hours_this_year != null
            ? Number(row.total_work_hours_this_year)
            : null,
        reGroupingElection: row.re_grouping_election ?? null,
      });
    } catch (e) {
      console.warn('[hours] loadRepsSettings failed', e);
    }
  }, []);

  useEffect(() => {
    loadComplianceRules().then(setRules).catch(() => undefined);
    return subscribeToRules(setRules);
  }, []);

  // Generate the Real Estate Compliance Report PDF. Reuses the shared report
  // service, which re-runs the same queries + calculateEffectiveMinHours this
  // screen uses, so the PDF always matches what is shown above.
  const onGenerateReport = useCallback(async () => {
    if (reportGenerating) return;
    const userId = session?.user?.id;
    if (!userId) {
      Alert.alert('Not signed in', 'Sign in to generate a compliance report.');
      return;
    }
    setReportGenerating(true);
    try {
      await generateRealEstateReport({
        userId,
        businessId: activeBusinessId,
        clientName: fullName ?? 'Client',
      });
    } catch (e) {
      Alert.alert('Report failed', e instanceof Error ? e.message : String(e));
    } finally {
      setReportGenerating(false);
    }
  }, [reportGenerating, session?.user?.id, activeBusinessId, fullName]);

  const persistNote = useCallback(
    async (note: ClassifiedNote, propertyId: string | null) => {
      const userId = await requireUserId();
      const property = propertyId
        ? properties.find((p) => p.id === propertyId) ?? null
        : null;
      const insert = noteToInsert(note, userId, activeBusinessId, property);
      const { error } = await supabase.from('hours_log').insert(insert);
      if (error) throw new Error(error.message);
      setLastLoggedHours(note.duration_hours);
      // Mirror this activity into the documents vault so it appears in the
      // Documents screen under the Real Estate filter as an audit record.
      // Best-effort: a failure here must not block the hours log itself.
      try {
        await saveActivityDocument({
          userId,
          businessId: activeBusinessId,
          propertyName: property ? property.property_name : 'General / Administrative',
          activityDate: insert.activity_date,
          description: insert.description,
          hours: insert.hours,
          hoursType: insert.hours_type,
        });
      } catch (e) {
        console.warn('[hours] activity document save failed', e);
      }
      await loadHours();
    },
    [loadHours, activeBusinessId, properties],
  );

  // Routes a fresh hours-log note through the property-picker modal when the
  // user has any properties; otherwise saves it straight as general/admin.
  const handleNote = useCallback(
    async (note: ClassifiedNote) => {
      if (properties.length === 0) {
        await persistNote(note, null);
        return;
      }
      setPendingNote(note);
    },
    [persistNote, properties.length],
  );

  const consumeIfHoursLog = useCallback(() => {
    const pending = peek();
    if (pending && pending.activity_type === 'hours_log') {
      const note = consume();
      if (note) {
        handleNote(note).catch((e) =>
          Alert.alert('Could not save hours', e instanceof Error ? e.message : String(e)),
        );
      }
    }
  }, [handleNote]);

  useFocusEffect(
    useCallback(() => {
      consumeIfHoursLog();
      loadHours();
      loadProperties();
      loadRepsSettings();
    }, [consumeIfHoursLog, loadHours, loadProperties, loadRepsSettings]),
  );

  // The Activity Log list honors the filter sheet. Filters only affect this
  // list — the metrics and per-property breakdown above always reflect the
  // full year so the goal math stays stable.
  const filteredRows = useMemo(() => {
    const { start, end } = computeDateRange(filters);
    return rows.filter((r) => {
      if (filters.propertyFilter !== 'all') {
        const target =
          filters.propertyFilter === GENERAL_FILTER_KEY
            ? null
            : filters.propertyFilter;
        if ((r.property_id ?? null) !== target) return false;
      }
      if (filters.hoursType !== 'all' && (r.hours_type ?? '') !== filters.hoursType) {
        return false;
      }
      const d = r.activity_date ?? '';
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });
  }, [rows, filters]);

  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters]);

  // Group hours_log rows by property (null → general/administrative). Sort
  // groups by total hours desc so the busiest properties surface first.
  const propertyBreakdown = useMemo(() => {
    const GENERAL_KEY = '__general__';
    const propertyMap = new Map(properties.map((p) => [p.id, p]));
    const buckets = new Map<
      string,
      {
        key: string;
        property: PropertyRow | null;
        hours: number;
        entries: ActivityEntry[];
      }
    >();
    for (const r of rows) {
      const key = r.property_id ?? GENERAL_KEY;
      const property = r.property_id ? propertyMap.get(r.property_id) ?? null : null;
      const bucket = buckets.get(key) ?? {
        key,
        property,
        hours: 0,
        entries: [] as ActivityEntry[],
      };
      bucket.hours += Number(r.hours) || 0;
      bucket.entries.push(rowToActivity(r));
      buckets.set(key, bucket);
    }
    // Surface every known property too — even when no hours are logged yet —
    // so the user sees a 0-hour row instead of the property vanishing.
    for (const p of properties) {
      if (!buckets.has(p.id)) {
        buckets.set(p.id, { key: p.id, property: p, hours: 0, entries: [] });
      }
    }
    return Array.from(buckets.values()).sort((a, b) => b.hours - a.hours);
  }, [rows, properties]);

  const togglePropertyExpanded = (key: string) => {
    setExpandedPropertyKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const { hoursThisYear, hoursThisMonth, monthlyHours, currentMonthIndex } = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const monthIdx = now.getMonth();
    const monthly = new Array(12).fill(0) as number[];
    let yearSum = 0;
    let monthSum = 0;
    for (const r of rows) {
      if (!r.activity_date || r.hours == null) continue;
      const d = new Date(r.activity_date);
      if (d.getFullYear() !== year) continue;
      const m = d.getMonth();
      monthly[m] += r.hours;
      yearSum += r.hours;
      if (m === monthIdx) monthSum += r.hours;
    }
    return {
      hoursThisYear: yearSum,
      hoursThisMonth: monthSum,
      monthlyHours: monthly,
      currentMonthIndex: monthIdx,
    };
  }, [rows]);

  // ── Real estate v2 tracker model ───────────────────────────────────────
  // Drives the three Hours-screen sections (REPS Qualification, Long-Term,
  // Short-Term). All thresholds come from compliance_rules. The single REPS
  // tracker's minimum is the greater of the 750-hour test and "more than 50%
  // of total annual work hours"; every logged hour counts toward it.
  const reView = useMemo(() => {
    const thresholds = readThresholds(rules?.rawDb ?? []);
    const reps750 = thresholds.reps_gate1_hours;
    const majorityPct = thresholds.reps_majority_services_pct;
    const total = repsSettings.totalWorkHours;
    // Shared single source of truth with the Dashboard — same compliance_rules
    // map + total work hours through calculateEffectiveMinHours.
    const effectiveMin = calculateEffectiveMinHours(
      total ?? 0,
      buildRepsRulesRecord(rules?.rawDb ?? []),
    );
    // The 50% rule raises the bar above the 750-hour test only when it yields a
    // higher minimum.
    const fiftyBinds = effectiveMin > reps750;

    const agg = aggregateHours(rows, properties);
    // Every logged hour counts toward REPS qualification — general, material
    // participation, and STR participation buckets all aggregate here.
    const reHours =
      agg.totals.reps_general +
      agg.totals.material_participation +
      agg.totals.str_participation;

    const portfolio = repsSettings.rePropertyType;
    const repsActive = repsSettings.repsPursuitActive === true;
    const showLongTerm = portfolio === 'long_term' || portfolio === 'both';
    const showShortTerm = portfolio === 'short_term' || portfolio === 'both';
    const grouping = repsSettings.reGroupingElection === true;

    const describe = (p: PropertyRow) => {
      const test =
        p.mp_test_selected != null ? MP_TEST_FROM_INT[p.mp_test_selected] ?? null : null;
      const threshold = test ? mpHourThreshold(test, thresholds) : null;
      const hours = agg.perProperty.get(p.id) ?? 0;
      const testName = test ? MP_TEST_SHORT_LABEL[test] : null;
      return { property: p, test, threshold, hours, testName };
    };

    const longTerm = properties
      .filter((p) => p.property_type === 'long_term')
      .map(describe);
    const shortTerm = properties
      .filter((p) => p.property_type === 'short_term')
      .map(describe);

    // Grouped long-term view: combine LT properties by their selected MP test,
    // since grouped properties may still use different tests.
    const longTermGroups = MP_TEST_SETUP_ORDER.flatMap((test) => {
      const members = longTerm.filter((r) => r.test === test);
      if (members.length === 0) return [];
      const hours = members.reduce((s, r) => s + r.hours, 0);
      const threshold = mpHourThreshold(test, thresholds);
      return [
        {
          test,
          testName: MP_TEST_SHORT_LABEL[test],
          names: members.map((m) => m.property.property_name).join(' + '),
          hours,
          threshold,
        },
      ];
    });

    return {
      reps750,
      majorityPct,
      total,
      effectiveMin,
      fiftyBinds,
      reHours,
      repsActive,
      showLongTerm,
      showShortTerm,
      grouping,
      longTerm,
      shortTerm,
      longTermGroups,
      strMaxDays: thresholds.str_avg_period_max_days,
    };
  }, [rows, properties, rules, repsSettings]);

  // Status for a REPS-style tracker: On Track / In Progress / Needs Attention.
  const repsStatusFor = (hours: number, target: number): {
    label: string;
    variant: StatusVariant;
  } => {
    const p = paceFor(target > 0 ? hours / target : 0);
    return {
      label: p.label === 'At Risk' ? 'Needs Attention' : p.label,
      variant: p.variant,
    };
  };

  useEffect(() => {
    return () => {
      const r = recRef.current;
      if (r) r.stopAndUnloadAsync().catch(() => undefined);
    };
  }, []);

  const onMicPress = async () => {
    if (processing) return;
    if (recording) {
      const rec = recRef.current;
      recRef.current = null;
      if (!rec) {
        setRecording(false);
        return;
      }
      setRecording(false);
      setProcessing(true);
      try {
        const { note } = await classifyFromRecording(rec);
        await handleNote(note);
      } catch (e) {
        console.warn('[hours] voice log failed', e);
        if (e instanceof MissingProxyError) {
          Alert.alert('Proxy not configured', e.message);
        } else if (e instanceof ProxyUnreachableError) {
          Alert.alert('Proxy unreachable', e.message);
        } else {
          Alert.alert('Voice log failed', e instanceof Error ? e.message : String(e));
        }
      } finally {
        setProcessing(false);
      }
      return;
    }

    try {
      const granted = await ensureMicPermission();
      if (!granted) {
        Alert.alert(
          'Microphone access needed',
          'Enable microphone access in Settings to record hours.',
        );
        return;
      }
      const rec = await startRecording();
      recRef.current = rec;
      setRecording(true);
    } catch (e) {
      Alert.alert('Could not start recording', e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    if (!recording) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 700,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [recording, pulse]);

  // The annual goal is the effective REPS minimum (the higher of the 750-hour
  // test and the 50% calculation), read from compliance_rules — not a hardcoded
  // 500. So the banner + "Hours This Year" card track the real target.
  const goalHours = reView.effectiveMin;
  const hoursRemaining = Math.max(0, goalHours - hoursThisYear);
  const yearProgress = goalHours > 0 ? Math.round((hoursThisYear / goalHours) * 100) : 0;
  const yearUnderGoal = hoursThisYear < goalHours;

  // Combined REPS tracker display values.
  const repsRemaining = Math.max(0, reView.effectiveMin - reView.reHours);
  const repsStatus = repsStatusFor(reView.reHours, reView.effectiveMin);
  const repsBarColor = repsStatus.variant === 'success' ? colors.teal : colors.amber;
  const repsTooltip =
    reView.total != null && reView.total > 0
      ? `Your REPS minimum is the higher of ${reView.reps750} hours or more than ${reView.majorityPct}% of your total annual work hours. With ${reView.total} total work hours your minimum is ${reView.effectiveMin} hours.`
      : `Your REPS minimum is the higher of ${reView.reps750} hours or more than ${reView.majorityPct}% of your total annual work hours. Add your total annual work hours in Settings to apply the ${reView.majorityPct}% rule.`;

  const chartWidth = Dimensions.get('window').width - spacing.lg * 2 - spacing.lg * 2;

  const chartSeries = monthlyHours.map((h, i) =>
    i <= currentMonthIndex ? h : FUTURE_PLACEHOLDER,
  );

  const chartData = {
    labels: MONTH_LABELS,
    datasets: [
      {
        data: chartSeries,
        colors: chartSeries.map((_, i) =>
          i <= currentMonthIndex
            ? (opacity: number) => `rgba(${CHART_PAST_RGB}, ${opacity})`
            : (_opacity: number) => `rgba(${CHART_FUTURE_RGB}, 1)`,
        ),
      },
    ],
  };

  const monthLabel = `${MONTH_LABELS[currentMonthIndex]} ${new Date().getFullYear()}`;

  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.18],
  });
  const pulseHaloOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0],
  });
  const pulseHaloScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.9],
  });

  return (
    <View style={styles.root}>
      <Header year={2026} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 120 + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <AlertBanner
          title={`${hoursRemaining} hours remaining to goal`}
          detail={`Log ${hoursRemaining} more hours by Dec 31 to hit your ${goalHours}-hour material participation threshold.`}
        />

        <View style={styles.reportRow}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={onGenerateReport}
            disabled={reportGenerating}
            style={[styles.reportBtn, reportGenerating && styles.reportBtnDisabled]}
          >
            {reportGenerating ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Ionicons name="download-outline" size={18} color={colors.white} />
            )}
            <Text style={styles.reportBtnText}>
              {reportGenerating
                ? 'Preparing your compliance report…'
                : 'Generate Report'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.metricsRow}>
          <MetricCard
            label="Hours This Year"
            value={hoursThisYear.toFixed(0)}
            sublabel={`of ${goalHours} goal`}
            icon="time-outline"
            variant={yearUnderGoal ? 'amber' : 'teal'}
            progress={yearProgress}
          />
          <View style={styles.gap} />
          <MetricCard
            label="Hours This Month"
            value={hoursThisMonth.toFixed(0)}
            sublabel={monthLabel}
            icon="calendar-outline"
            variant="navy"
          />
        </View>

        {/* SECTION 1 — REPS Qualification (taxpayer-level, not per-property) */}
        {reView.repsActive ? (
          <View style={styles.section}>
            <Text style={styles.reSectionHeader}>REPS Qualification</Text>
            <Card padded>
              <View style={styles.repsLabelRow}>
                <Text style={styles.gateLabel}>REPS Qualification Hours</Text>
                <TouchableOpacity
                  onPress={() => setRepsInfoOpen((v) => !v)}
                  hitSlop={8}
                  accessibilityLabel="About REPS qualification hours"
                >
                  <Ionicons
                    name="information-circle-outline"
                    size={18}
                    color={colors.midNavy}
                  />
                </TouchableOpacity>
              </View>

              {reView.fiftyBinds ? (
                <Text style={styles.repsSubAmber}>
                  50% rule raises your minimum to {reView.effectiveMin} hours
                  based on {reView.total} total annual work hours
                </Text>
              ) : (
                <Text style={styles.repsSubMuted}>
                  {reView.reps750}-hour test is your binding requirement
                </Text>
              )}

              {repsInfoOpen ? (
                <View style={styles.repsTooltip}>
                  <Text style={styles.repsTooltipText}>{repsTooltip}</Text>
                </View>
              ) : null}

              <View style={styles.gateRow}>
                <Text style={styles.gateValue}>
                  {reView.reHours.toFixed(0)}
                  <Text style={styles.gateTotal}> / {reView.effectiveMin} hrs</Text>
                </Text>
                <StatusPill label={repsStatus.label} variant={repsStatus.variant} />
              </View>
              <ProgressBar
                value={reView.reHours}
                total={reView.effectiveMin}
                color={repsBarColor}
                trackColor={colors.lightBlue}
                height={10}
              />
              <Text style={styles.gateHint}>
                {reView.reHours.toFixed(0)} of {reView.effectiveMin} hours (
                {repsRemaining.toFixed(0)} remaining)
              </Text>
            </Card>
          </View>
        ) : null}

        {/* SECTION 2 — Long-Term Rental Properties */}
        {reView.showLongTerm ? (
          <View style={styles.section}>
            <Text style={styles.reSectionHeader}>Long-Term Rental Properties</Text>
            <Card padded>
              {reView.longTerm.length === 0 ? (
                <Text style={styles.reEmpty}>No long-term properties yet.</Text>
              ) : reView.grouping ? (
                reView.longTermGroups.map((g, i) => (
                  <ReTrackerRow
                    key={g.test}
                    title={g.names}
                    subtitle={g.testName}
                    hours={g.hours}
                    threshold={g.threshold}
                    noteWhenNoThreshold="Based on prior year history"
                    status={
                      g.threshold != null ? repsStatusFor(g.hours, g.threshold) : null
                    }
                    divider={i < reView.longTermGroups.length - 1}
                  />
                ))
              ) : (
                reView.longTerm.map((r, i) => (
                  <ReTrackerRow
                    key={r.property.id}
                    title={r.property.property_name}
                    subtitle={r.testName}
                    hours={r.hours}
                    threshold={r.threshold}
                    noteWhenNoThreshold="Based on prior year history"
                    status={
                      r.threshold != null ? repsStatusFor(r.hours, r.threshold) : null
                    }
                    divider={i < reView.longTerm.length - 1}
                  />
                ))
              )}
            </Card>
          </View>
        ) : null}

        {/* SECTION 3 — Short-Term Rental Properties (never grouped) */}
        {reView.showShortTerm ? (
          <View style={styles.section}>
            <Text style={styles.reSectionHeader}>Short-Term Rental Properties</Text>
            <Card padded>
              {reView.shortTerm.length === 0 ? (
                <Text style={styles.reEmpty}>No short-term properties yet.</Text>
              ) : (
                reView.shortTerm.map((r, i) => (
                  <ReTrackerRow
                    key={r.property.id}
                    title={r.property.property_name}
                    subtitle={r.testName}
                    hours={r.hours}
                    threshold={r.threshold}
                    noteWhenNoThreshold="Based on prior year history"
                    status={
                      r.threshold != null ? repsStatusFor(r.hours, r.threshold) : null
                    }
                    divider={i < reView.shortTerm.length - 1}
                    showAvgPeriod
                    strMaxDays={reView.strMaxDays}
                    avgRentalDays={null}
                  />
                ))
              )}
            </Card>
          </View>
        ) : null}

        <View style={styles.section}>
          <SectionHeader title="Monthly Pace" />
          <Card padded>
            <BarChart
              data={chartData}
              width={chartWidth}
              height={200}
              yAxisLabel=""
              yAxisSuffix=""
              fromZero
              withInnerLines={false}
              withHorizontalLabels={false}
              showBarTops={false}
              withCustomBarColorFromData
              flatColor
              segments={3}
              chartConfig={{
                backgroundColor: colors.white,
                backgroundGradientFrom: colors.white,
                backgroundGradientTo: colors.white,
                decimalPlaces: 0,
                color: (opacity = 1) => `rgba(${CHART_PAST_RGB}, ${opacity})`,
                labelColor: () => colors.mutedText,
                barPercentage: 0.55,
                barRadius: 4,
                propsForBackgroundLines: { stroke: 'transparent' },
                propsForLabels: {
                  fontSize: '10',
                  fontWeight: '600',
                },
              }}
              style={styles.chart}
            />
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View
                  style={[styles.legendSwatch, { backgroundColor: colors.midNavy }]}
                />
                <Text style={styles.legendText}>Logged</Text>
              </View>
              <View style={styles.legendItem}>
                <View
                  style={[styles.legendSwatch, { backgroundColor: colors.lightBlue }]}
                />
                <Text style={styles.legendText}>Remaining</Text>
              </View>
            </View>
          </Card>
        </View>

        {propertyBreakdown.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader title="Hours by Property" />
            <Card padded>
              {propertyBreakdown.map((bucket, i) => {
                const expanded = expandedPropertyKeys.has(bucket.key);
                const name = bucket.property
                  ? bucket.property.property_name
                  : 'General / Administrative';
                const subtitle = bucket.property
                  ? null
                  : 'Hours not tied to a specific property';
                const last = i === propertyBreakdown.length - 1;
                return (
                  <View
                    key={bucket.key}
                    style={[
                      styles.breakdownGroup,
                      !last && !expanded && styles.breakdownGroupDivider,
                    ]}
                  >
                    <TouchableOpacity
                      activeOpacity={0.7}
                      style={styles.breakdownRow}
                      onPress={() => togglePropertyExpanded(bucket.key)}
                    >
                      <View style={styles.breakdownIcon}>
                        <Ionicons
                          name={bucket.property ? 'home-outline' : 'briefcase-outline'}
                          size={18}
                          color={colors.midNavy}
                        />
                      </View>
                      <View style={styles.breakdownText}>
                        <Text style={styles.breakdownTitle} numberOfLines={1}>
                          {name}
                        </Text>
                        {subtitle ? (
                          <Text style={styles.breakdownSubtitle} numberOfLines={1}>
                            {subtitle}
                          </Text>
                        ) : null}
                      </View>
                      <Text style={styles.breakdownHours}>
                        {bucket.hours.toFixed(0)}
                        <Text style={styles.breakdownHoursUnit}> hr</Text>
                      </Text>
                      <Ionicons
                        name={expanded ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color={colors.mutedText}
                        style={styles.breakdownChevron}
                      />
                    </TouchableOpacity>
                    {expanded ? (
                      <View style={styles.breakdownEntries}>
                        {bucket.entries.length === 0 ? (
                          <Text style={styles.breakdownEmpty}>
                            No hours logged yet.
                          </Text>
                        ) : (
                          bucket.entries.map((entry) => (
                            <View key={entry.id} style={styles.breakdownEntryRow}>
                              <Ionicons
                                name={entry.icon}
                                size={14}
                                color={colors.midNavy}
                              />
                              <Text style={styles.breakdownEntryTitle} numberOfLines={1}>
                                {entry.title}
                              </Text>
                              <Text style={styles.breakdownEntryMeta} numberOfLines={1}>
                                {entry.date}
                              </Text>
                              <Text style={styles.breakdownEntryHours}>
                                {entry.hours.toFixed(1)} hr
                              </Text>
                            </View>
                          ))
                        )}
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </Card>
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.activityHeaderRow}>
            <Text style={styles.activityHeaderTitle}>Activity Log</Text>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setFilterSheetOpen(true)}
              hitSlop={8}
              style={styles.filterBtn}
            >
              <Ionicons name="options-outline" size={15} color={colors.midNavy} />
              <Text style={styles.filterBtnText}>Filter</Text>
              {activeFilterCount > 0 ? (
                <View style={styles.filterBadge}>
                  <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          </View>
          <Card padded>
            {filteredRows.length === 0 ? (
              <Text style={styles.activityEmpty}>
                {rows.length === 0
                  ? 'No hours logged yet. Use the voice log below to add one.'
                  : 'No activities match your filters.'}
              </Text>
            ) : (
              filteredRows.map((r, i) => {
                const entry = rowToActivity(r);
                return (
                  <EditableListRow
                    key={r.id}
                    onPress={() => setEditingRow(r)}
                    contentStyle={styles.activityContent}
                    style={[
                      styles.activityRow,
                      i !== filteredRows.length - 1 && styles.activityRowDivider,
                    ]}
                  >
                    <View style={styles.activityIcon}>
                      <Ionicons name={entry.icon} size={18} color={colors.midNavy} />
                    </View>
                    <View style={styles.activityText}>
                      <Text style={styles.activityTitle} numberOfLines={1}>
                        {entry.title}
                      </Text>
                      <Text style={styles.activityMeta} numberOfLines={1}>
                        {entry.category} · {entry.date}
                      </Text>
                    </View>
                    <Text style={styles.activityHours}>
                      {entry.hours.toFixed(1)}
                      <Text style={styles.activityHoursUnit}> hr</Text>
                    </Text>
                  </EditableListRow>
                );
              })
            )}
          </Card>
        </View>
      </ScrollView>

      <View
        style={[
          styles.voiceWrap,
          { paddingBottom: Math.max(spacing.sm, insets.bottom ? 0 : spacing.sm) },
        ]}
      >
        <View style={styles.voiceStrip}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={onMicPress}
            disabled={processing}
            style={styles.micWrap}
          >
            {recording ? (
              <Animated.View
                style={[
                  styles.pulseHalo,
                  {
                    opacity: pulseHaloOpacity,
                    transform: [{ scale: pulseHaloScale }],
                  },
                ]}
              />
            ) : null}
            <Animated.View
              style={[
                styles.micButton,
                {
                  backgroundColor: recording ? '#E0352B' : colors.navy,
                  transform: [{ scale: recording ? pulseScale : 1 }],
                },
              ]}
            >
              {processing ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Ionicons
                  name={recording ? 'stop' : 'mic'}
                  size={20}
                  color={colors.white}
                />
              )}
            </Animated.View>
          </TouchableOpacity>
          <View style={styles.voiceText}>
            <View style={styles.voiceTitleRow}>
              <Text style={styles.voiceTitle} numberOfLines={1}>
                {recording
                  ? 'Listening…'
                  : processing
                    ? 'Logging…'
                    : lastLoggedHours != null
                      ? `Logged ${lastLoggedHours} hr`
                      : 'Voice Log'}
              </Text>
              <KeepAwakeIndicator visible={recording} />
            </View>
            <Text style={styles.voiceHint} numberOfLines={1}>
              {recording
                ? 'Tap mic to stop'
                : processing
                  ? 'Transcribing and classifying'
                  : 'Say "I spent 3 hours at the Scottsdale property"'}
            </Text>
          </View>
          <Ionicons
            name={recording ? 'radio-button-on' : 'chevron-forward'}
            size={18}
            color={recording ? '#E0352B' : colors.mutedText}
          />
        </View>
      </View>

      <PropertyPickerModal
        note={pendingNote}
        properties={properties}
        onCancel={() => setPendingNote(null)}
        onSave={async (propertyId) => {
          const note = pendingNote;
          if (!note) return;
          try {
            await persistNote(note, propertyId);
          } catch (e) {
            Alert.alert(
              'Could not save hours',
              e instanceof Error ? e.message : String(e),
            );
          } finally {
            setPendingNote(null);
          }
        }}
      />

      <HoursFilterSheet
        visible={filterSheetOpen}
        filters={filters}
        properties={properties}
        onClose={() => setFilterSheetOpen(false)}
        onApply={(next) => {
          setFilters(next);
          setFilterSheetOpen(false);
        }}
        onReset={() => setFilters(DEFAULT_FILTERS)}
      />

      <HoursEditSheet
        row={editingRow}
        properties={properties}
        onClose={() => setEditingRow(null)}
        onSaved={loadHours}
      />
    </View>
  );
};

interface PropertyPickerModalProps {
  note: ClassifiedNote | null;
  properties: PropertyRow[];
  onCancel: () => void;
  onSave: (propertyId: string | null) => void;
}

const PropertyPickerModal: React.FC<PropertyPickerModalProps> = ({
  note,
  properties,
  onCancel,
  onSave,
}) => {
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (note) setSelected(null);
  }, [note]);

  return (
    <Modal
      visible={!!note}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <View style={modalStyles.backdrop}>
        <View style={modalStyles.sheet}>
          <Text style={modalStyles.title}>Which property was this for?</Text>
          {note ? (
            <Text style={modalStyles.subtitle}>
              {(note.duration_hours ?? 0).toFixed(1)} hr ·{' '}
              {note.description || note.business_purpose || 'Voice-logged activity'}
            </Text>
          ) : null}

          <ScrollView style={modalStyles.list}>
            <TouchableOpacity
              activeOpacity={0.85}
              style={[modalStyles.option, selected === null && modalStyles.optionActive]}
              onPress={() => setSelected(null)}
            >
              <Ionicons
                name="briefcase-outline"
                size={18}
                color={selected === null ? colors.white : colors.midNavy}
              />
              <View style={modalStyles.optionText}>
                <Text
                  style={[
                    modalStyles.optionTitle,
                    selected === null && modalStyles.optionTitleActive,
                  ]}
                >
                  General / Administrative
                </Text>
                <Text
                  style={[
                    modalStyles.optionSubtitle,
                    selected === null && modalStyles.optionSubtitleActive,
                  ]}
                >
                  Hours not tied to a specific property
                </Text>
              </View>
            </TouchableOpacity>
            {properties.map((p) => {
              const active = selected === p.id;
              return (
                <TouchableOpacity
                  key={p.id}
                  activeOpacity={0.85}
                  style={[modalStyles.option, active && modalStyles.optionActive]}
                  onPress={() => setSelected(p.id)}
                >
                  <Ionicons
                    name="home-outline"
                    size={18}
                    color={active ? colors.white : colors.midNavy}
                  />
                  <View style={modalStyles.optionText}>
                    <Text
                      style={[
                        modalStyles.optionTitle,
                        active && modalStyles.optionTitleActive,
                      ]}
                      numberOfLines={1}
                    >
                      {p.property_name}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={modalStyles.actions}>
            <TouchableOpacity
              activeOpacity={0.85}
              style={modalStyles.cancelBtn}
              onPress={onCancel}
            >
              <Text style={modalStyles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.85}
              style={modalStyles.saveBtn}
              onPress={() => onSave(selected)}
            >
              <Text style={modalStyles.saveBtnText}>Save hours</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

// ── Real estate tracker row ──────────────────────────────────────────────────
// One per-property (or per-MP-test group) row in the Long-Term / Short-Term
// sections. Tests with no hour threshold (e.g. Test 5) render a note instead of
// a progress bar. STR rows add the average-rental-period line.

interface ReTrackerRowProps {
  title: string;
  subtitle: string | null;
  hours: number;
  threshold: number | null;
  noteWhenNoThreshold: string;
  status: { label: string; variant: StatusVariant } | null;
  divider: boolean;
  showAvgPeriod?: boolean;
  strMaxDays?: number;
  // Average rental period in days. The app does not yet capture per-stay data,
  // so callers pass null and the row shows "Not tracked yet" until that exists.
  avgRentalDays?: number | null;
}

const ReTrackerRow: React.FC<ReTrackerRowProps> = ({
  title,
  subtitle,
  hours,
  threshold,
  noteWhenNoThreshold,
  status,
  divider,
  showAvgPeriod,
  strMaxDays,
  avgRentalDays,
}) => {
  const hasAvg = typeof avgRentalDays === 'number' && avgRentalDays > 0;
  const avgOk = hasAvg && strMaxDays != null && avgRentalDays <= strMaxDays;
  return (
    <View style={[styles.reRow, divider && styles.reRowDivider]}>
      <View style={styles.reRowHeader}>
        <View style={styles.reRowText}>
          <Text style={styles.reRowTitle} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.reRowSubtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {status ? <StatusPill label={status.label} variant={status.variant} /> : null}
      </View>
      {threshold != null ? (
        <>
          <Text style={styles.reRowHours}>
            {hours.toFixed(0)}
            <Text style={styles.reRowHoursTotal}> of {threshold} hours</Text>
          </Text>
          <ProgressBar
            value={hours}
            total={threshold}
            color={colors.teal}
            trackColor={colors.lightBlue}
            height={8}
          />
        </>
      ) : (
        <Text style={styles.reRowNote}>{noteWhenNoThreshold}</Text>
      )}
      {showAvgPeriod ? (
        <View style={styles.reAvgRow}>
          {hasAvg ? (
            <Ionicons
              name={avgOk ? 'checkmark-circle' : 'alert-circle'}
              size={14}
              color={avgOk ? colors.teal : '#E0352B'}
            />
          ) : null}
          <Text style={styles.reAvgText}>
            {hasAvg
              ? `Avg rental period: ${avgRentalDays.toFixed(0)} days`
              : 'Avg rental period: Not tracked yet'}
          </Text>
        </View>
      ) : null}
    </View>
  );
};

// ── Shared form bits ─────────────────────────────────────────────────────────

const FieldLabel: React.FC<{ text: string }> = ({ text }) => (
  <Text style={editStyles.fieldLabel}>{text}</Text>
);

const OptionRow: React.FC<{
  label: string;
  active: boolean;
  onPress: () => void;
}> = ({ label, active, onPress }) => (
  <TouchableOpacity
    activeOpacity={0.8}
    onPress={onPress}
    style={[editStyles.option, active && editStyles.optionActive]}
  >
    <Text
      style={[editStyles.optionText, active && editStyles.optionTextActive]}
      numberOfLines={1}
    >
      {label}
    </Text>
    {active ? <Ionicons name="checkmark" size={18} color={colors.white} /> : null}
  </TouchableOpacity>
);

const FilterChip: React.FC<{
  label: string;
  active: boolean;
  onPress: () => void;
}> = ({ label, active, onPress }) => (
  <TouchableOpacity
    activeOpacity={0.8}
    onPress={onPress}
    style={[filterStyles.chip, active && filterStyles.chipActive]}
  >
    <Text style={[filterStyles.chipText, active && filterStyles.chipTextActive]}>
      {label}
    </Text>
  </TouchableOpacity>
);

const DateFieldButton: React.FC<{
  label: string;
  value: Date | null;
  onPress: () => void;
}> = ({ label, value, onPress }) => (
  <View style={filterStyles.dateFieldWrap}>
    <Text style={editStyles.fieldLabel}>{label}</Text>
    <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={editStyles.dateField}>
      <Text style={[editStyles.dateText, !value && editStyles.datePlaceholder]}>
        {value ? formatDateMMDDYYYY(value) : 'MM/DD/YYYY'}
      </Text>
      <Ionicons name="calendar-outline" size={18} color={colors.midNavy} />
    </TouchableOpacity>
  </View>
);

// ── Filter sheet (Fix 1) ─────────────────────────────────────────────────────

interface HoursFilterSheetProps {
  visible: boolean;
  filters: HoursFilters;
  properties: PropertyRow[];
  onClose: () => void;
  onApply: (filters: HoursFilters) => void;
  onReset: () => void;
}

const HoursFilterSheet: React.FC<HoursFilterSheetProps> = ({
  visible,
  filters,
  properties,
  onClose,
  onApply,
  onReset,
}) => {
  const [draft, setDraft] = useState<HoursFilters>(filters);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  // Re-seed the draft from the live filters each time the sheet opens.
  useEffect(() => {
    if (visible) setDraft(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const update = (patch: Partial<HoursFilters>) =>
    setDraft((d) => ({ ...d, ...patch }));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={filterStyles.backdrop}>
        <View style={filterStyles.sheet}>
          <View style={filterStyles.header}>
            <Text style={filterStyles.title}>Filter activity</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityLabel="Close filters">
              <Ionicons name="close" size={24} color={colors.mutedText} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={filterStyles.body}
            contentContainerStyle={filterStyles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={filterStyles.groupLabel}>Date range</Text>
            <View style={filterStyles.chipWrap}>
              {DATE_RANGE_OPTIONS.map((opt) => (
                <FilterChip
                  key={opt.key}
                  label={opt.label}
                  active={draft.dateRange === opt.key}
                  onPress={() => update({ dateRange: opt.key })}
                />
              ))}
            </View>
            {draft.dateRange === 'custom' ? (
              <View style={filterStyles.customRow}>
                <DateFieldButton
                  label="Start"
                  value={draft.customStart}
                  onPress={() => {
                    setShowStartPicker(true);
                    setShowEndPicker(false);
                  }}
                />
                <View style={filterStyles.customGap} />
                <DateFieldButton
                  label="End"
                  value={draft.customEnd}
                  onPress={() => {
                    setShowEndPicker(true);
                    setShowStartPicker(false);
                  }}
                />
              </View>
            ) : null}

            <Text style={filterStyles.groupLabel}>Property</Text>
            <View style={filterStyles.chipWrap}>
              <FilterChip
                label="All properties"
                active={draft.propertyFilter === 'all'}
                onPress={() => update({ propertyFilter: 'all' })}
              />
              <FilterChip
                label="General / Admin"
                active={draft.propertyFilter === GENERAL_FILTER_KEY}
                onPress={() => update({ propertyFilter: GENERAL_FILTER_KEY })}
              />
              {properties.map((p) => (
                <FilterChip
                  key={p.id}
                  label={p.property_name}
                  active={draft.propertyFilter === p.id}
                  onPress={() => update({ propertyFilter: p.id })}
                />
              ))}
            </View>

            <Text style={filterStyles.groupLabel}>Hours type</Text>
            <View style={filterStyles.chipWrap}>
              {HOURS_TYPE_OPTIONS.map((opt) => (
                <FilterChip
                  key={opt.key}
                  label={opt.label}
                  active={draft.hoursType === opt.key}
                  onPress={() => update({ hoursType: opt.key })}
                />
              ))}
            </View>
          </ScrollView>

          <View style={filterStyles.footer}>
            <View style={filterStyles.footerRow}>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => {
                  setDraft(DEFAULT_FILTERS);
                  onReset();
                }}
                style={[filterStyles.footerBtn, filterStyles.resetBtn]}
              >
                <Text style={filterStyles.resetBtnText}>Reset</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={onClose}
                style={[filterStyles.footerBtn, filterStyles.cancelBtn]}
              >
                <Text style={filterStyles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => onApply(draft)}
              style={filterStyles.applyBtn}
            >
              <Text style={filterStyles.applyBtnText}>Apply</Text>
            </TouchableOpacity>
          </View>

          <DatePickerModal
            visible={showStartPicker}
            title="Start Date"
            value={draft.customStart}
            minimumDate={MIN_ACTIVITY_DATE}
            onConfirm={(d) => {
              update({ customStart: d });
              setShowStartPicker(false);
            }}
            onCancel={() => setShowStartPicker(false)}
          />
          <DatePickerModal
            visible={showEndPicker}
            title="End Date"
            value={draft.customEnd}
            fallback={draft.customStart ?? undefined}
            minimumDate={draft.customStart ?? MIN_ACTIVITY_DATE}
            onConfirm={(d) => {
              update({ customEnd: d });
              setShowEndPicker(false);
            }}
            onCancel={() => setShowEndPicker(false)}
          />
        </View>
      </View>
    </Modal>
  );
};

// ── Activity edit sheet (Fix 2) ──────────────────────────────────────────────

interface HoursEditSheetProps {
  row: HoursLogRow | null;
  properties: PropertyRow[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

const HoursEditSheet: React.FC<HoursEditSheetProps> = ({
  row,
  properties,
  onClose,
  onSaved,
}) => {
  const [description, setDescription] = useState('');
  const [date, setDate] = useState<Date | null>(null);
  const [hours, setHours] = useState('');
  const [hoursType, setHoursType] = useState<ActivityHoursType>('reps_general');
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [saving, setSaving] = useState(false);

  // Pre-fill every field from the tapped record whenever a new row opens.
  useEffect(() => {
    if (!row) return;
    setDescription(row.description ?? '');
    setDate(parseISODateLocal(row.activity_date));
    setHours(row.hours != null ? String(row.hours) : '');
    setHoursType((row.hours_type as ActivityHoursType) ?? 'reps_general');
    setPropertyId(row.property_id ?? null);
  }, [row]);

  const handleSave = async () => {
    if (!row) return;
    const hoursNum = parseFloat(hours);
    setSaving(true);
    try {
      const userId = await requireUserId();
      const { error } = await supabase
        .from('hours_log')
        .update({
          description: description.trim() || null,
          activity_date: date ? toISODateLocal(date) : row.activity_date,
          hours: Number.isFinite(hoursNum) ? hoursNum : 0,
          hours_type: hoursType,
          property_id: propertyId,
        })
        .eq('id', row.id)
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
      await onSaved();
      onClose();
    } catch (e) {
      Alert.alert('Could not save activity', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!row) return;
    setSaving(true);
    try {
      const userId = await requireUserId();
      const { error } = await supabase
        .from('hours_log')
        .delete()
        .eq('id', row.id)
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
      await onSaved();
      onClose();
    } catch (e) {
      Alert.alert('Could not delete activity', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <EditFormSheet
      title="Edit Activity"
      visible={!!row}
      onClose={onClose}
      onSave={handleSave}
      onDelete={handleDelete}
      saving={saving}
      deleteLabel="Delete Activity"
      deleteConfirmTitle="Delete this activity?"
      deleteConfirmMessage="Delete this activity? This cannot be undone."
    >
      <View>
        <FieldLabel text="Activity description" />
        <TextInput
          style={[editStyles.input, editStyles.inputMulti]}
          value={description}
          onChangeText={setDescription}
          placeholder="What did you do?"
          placeholderTextColor={colors.subtleText}
          multiline
        />
      </View>

      <View>
        <FieldLabel text="Date" />
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => setShowDatePicker(true)}
          style={editStyles.dateField}
        >
          <Text style={[editStyles.dateText, !date && editStyles.datePlaceholder]}>
            {date ? formatDateMMDDYYYY(date) : 'MM/DD/YYYY'}
          </Text>
          <Ionicons name="calendar-outline" size={20} color={colors.midNavy} />
        </TouchableOpacity>
      </View>

      <View>
        <FieldLabel text="Hours" />
        <TextInput
          style={editStyles.input}
          value={hours}
          onChangeText={setHours}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={colors.subtleText}
        />
      </View>

      <View>
        <FieldLabel text="Hours type" />
        <View style={editStyles.optionList}>
          {HOURS_TYPE_EDIT_OPTIONS.map((opt) => (
            <OptionRow
              key={opt.key}
              label={opt.label}
              active={hoursType === opt.key}
              onPress={() => setHoursType(opt.key)}
            />
          ))}
        </View>
      </View>

      {properties.length > 0 ? (
        <View>
          <FieldLabel text="Property" />
          <View style={editStyles.optionList}>
            <OptionRow
              label="General / Administrative"
              active={propertyId === null}
              onPress={() => setPropertyId(null)}
            />
            {properties.map((p) => (
              <OptionRow
                key={p.id}
                label={p.property_name}
                active={propertyId === p.id}
                onPress={() => setPropertyId(p.id)}
              />
            ))}
          </View>
        </View>
      ) : null}

      <DatePickerModal
        visible={showDatePicker}
        title="Activity Date"
        value={date}
        minimumDate={MIN_ACTIVITY_DATE}
        onConfirm={(d) => {
          setDate(d);
          setShowDatePicker(false);
        }}
        onCancel={() => setShowDatePicker(false)}
      />
    </EditFormSheet>
  );
};

const editStyles = StyleSheet.create({
  fieldLabel: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.white,
    borderWidth: 0.5,
    borderColor: '#CCCCCC',
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    ...typography.body,
    color: colors.bodyText,
    fontSize: 14,
  },
  inputMulti: {
    minHeight: 64,
    textAlignVertical: 'top',
  },
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.white,
    borderWidth: 0.5,
    borderColor: '#CCCCCC',
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  dateText: {
    ...typography.body,
    color: colors.bodyText,
    fontSize: 14,
  },
  datePlaceholder: {
    color: colors.subtleText,
  },
  optionList: {
    gap: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
    backgroundColor: colors.white,
  },
  optionActive: {
    backgroundColor: colors.midNavy,
    borderColor: colors.midNavy,
  },
  optionText: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    marginRight: spacing.sm,
  },
  optionTextActive: {
    color: colors.white,
  },
});

const filterStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '88%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  title: {
    ...typography.h2,
    color: colors.bodyText,
  },
  body: {
    flexGrow: 0,
  },
  bodyContent: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  groupLabel: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
    backgroundColor: colors.white,
  },
  chipActive: {
    backgroundColor: colors.midNavy,
    borderColor: colors.midNavy,
  },
  chipText: {
    ...typography.caption,
    color: colors.bodyText,
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextActive: {
    color: colors.white,
  },
  customRow: {
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  customGap: {
    width: spacing.md,
  },
  dateFieldWrap: {
    flex: 1,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  footerRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  footerBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  resetBtn: {
    borderColor: colors.amber,
    backgroundColor: colors.white,
  },
  resetBtnText: {
    ...typography.bodyMedium,
    color: colors.amber,
    fontWeight: '700',
    fontSize: 14,
  },
  cancelBtn: {
    borderColor: colors.mutedText,
    backgroundColor: colors.white,
  },
  cancelBtnText: {
    ...typography.bodyMedium,
    color: colors.mutedText,
    fontWeight: '700',
    fontSize: 14,
  },
  applyBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: colors.navy,
  },
  applyBtnText: {
    ...typography.bodyMedium,
    color: colors.white,
    fontWeight: '700',
    fontSize: 15,
  },
});

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    maxHeight: '80%',
  },
  title: {
    ...typography.h2,
    color: colors.bodyText,
  },
  subtitle: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 13,
    marginTop: 4,
    marginBottom: spacing.md,
  },
  list: {
    flexGrow: 0,
    marginBottom: spacing.md,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
    backgroundColor: colors.white,
    marginBottom: spacing.sm,
  },
  optionActive: {
    backgroundColor: colors.midNavy,
    borderColor: colors.midNavy,
  },
  optionText: {
    flex: 1,
  },
  optionTitle: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontWeight: '700',
    fontSize: 14,
  },
  optionTitleActive: {
    color: colors.white,
  },
  optionSubtitle: {
    ...typography.caption,
    color: colors.mutedText,
    marginTop: 2,
  },
  optionSubtitleActive: {
    color: colors.lightBlue,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  cancelBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.navy,
    backgroundColor: colors.white,
  },
  cancelBtnText: {
    ...typography.bodyMedium,
    color: colors.navy,
    fontWeight: '700',
    fontSize: 14,
  },
  saveBtn: {
    flex: 1.4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: colors.teal,
  },
  saveBtnText: {
    ...typography.bodyMedium,
    color: colors.white,
    fontWeight: '700',
    fontSize: 14,
  },
});

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
  metricsRow: {
    flexDirection: 'row',
  },
  reportRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  reportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    ...shadow.raised,
  },
  reportBtnDisabled: {
    opacity: 0.7,
  },
  reportBtnText: {
    ...typography.bodyMedium,
    color: colors.white,
    fontWeight: '700',
    fontSize: 13,
  },
  gap: {
    width: spacing.md,
  },
  // REPS Gate 1 section.
  gateLabel: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  gateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  gateValue: {
    ...typography.h2,
    color: colors.bodyText,
    fontSize: 20,
    fontWeight: '700',
  },
  gateTotal: {
    ...typography.body,
    color: colors.mutedText,
    fontWeight: '500',
    fontSize: 13,
  },
  gatePct: {
    ...typography.bodyMedium,
    fontWeight: '700',
    fontSize: 14,
  },
  gateDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginVertical: spacing.md,
  },
  gateHint: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.xs,
  },
  effCard: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    borderRadius: radius.card,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  effTeal: {
    backgroundColor: colors.tealLight,
  },
  effAmber: {
    backgroundColor: colors.amberLight,
  },
  effText: {
    ...typography.body,
    flex: 1,
    color: colors.bodyText,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  section: {
    gap: spacing.md,
  },
  // Real estate v2 section headers + tracker rows.
  reSectionHeader: {
    ...typography.h2,
    color: colors.navy,
    fontSize: 15,
    fontWeight: '700',
  },
  repsLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  repsSubMuted: {
    color: '#888888',
    fontSize: 11,
    fontStyle: 'italic',
    lineHeight: 15,
    marginTop: 2,
  },
  repsSubAmber: {
    color: '#BA7517',
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  repsTooltip: {
    backgroundColor: colors.lightBlue,
    borderRadius: radius.card,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  repsTooltipText: {
    ...typography.body,
    color: colors.bodyText,
    fontSize: 12,
    lineHeight: 17,
  },
  reEmpty: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 13,
    paddingVertical: spacing.xs,
  },
  reRow: {
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  reRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  reRowHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  reRowText: {
    flex: 1,
  },
  reRowTitle: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 13,
    fontWeight: '700',
  },
  reRowSubtitle: {
    color: '#888888',
    fontSize: 11,
    lineHeight: 15,
    marginTop: 1,
  },
  reRowHours: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  reRowHoursTotal: {
    ...typography.body,
    color: colors.mutedText,
    fontWeight: '500',
    fontSize: 12,
  },
  reRowNote: {
    color: '#888888',
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 2,
  },
  reAvgRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  reAvgText: {
    color: '#888888',
    fontSize: 11,
  },
  chart: {
    marginLeft: -spacing.lg,
    marginRight: -spacing.lg,
    paddingRight: 0,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xl,
    marginTop: spacing.sm,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendSwatch: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  legendText: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
  },
  activityHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  activityHeaderTitle: {
    ...typography.h2,
    color: colors.bodyText,
    fontSize: 17,
  },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  filterBtnText: {
    ...typography.bodyMedium,
    color: colors.midNavy,
    fontSize: 13,
    fontWeight: '600',
  },
  filterBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  filterBadgeText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
  },
  activityEmpty: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  activityContent: {
    gap: spacing.md,
  },
  activityRow: {
    paddingVertical: spacing.md,
  },
  activityRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  activityIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.lightBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityText: {
    flex: 1,
  },
  activityTitle: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 14,
    fontWeight: '600',
  },
  activityMeta: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 1,
  },
  activityHours: {
    ...typography.bodyMedium,
    color: colors.navy,
    fontSize: 15,
    fontWeight: '700',
  },
  activityHoursUnit: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    fontWeight: '600',
  },
  breakdownGroup: {
    paddingVertical: spacing.sm,
  },
  breakdownGroupDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  breakdownIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.lightBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  breakdownText: {
    flex: 1,
  },
  breakdownTitle: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontWeight: '700',
    fontSize: 14,
  },
  breakdownSubtitle: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    marginTop: 1,
  },
  breakdownHours: {
    ...typography.bodyMedium,
    color: colors.navy,
    fontSize: 15,
    fontWeight: '700',
  },
  breakdownHoursUnit: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    fontWeight: '600',
  },
  breakdownChevron: {
    marginLeft: 2,
  },
  breakdownEntries: {
    marginTop: spacing.xs,
    marginLeft: 44,
    gap: spacing.xs,
    paddingBottom: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    paddingTop: spacing.sm,
  },
  breakdownEntryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  breakdownEntryTitle: {
    ...typography.body,
    color: colors.bodyText,
    fontSize: 12,
    flex: 1,
  },
  breakdownEntryMeta: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
  },
  breakdownEntryHours: {
    ...typography.caption,
    color: colors.navy,
    fontWeight: '700',
    fontSize: 12,
  },
  breakdownEmpty: {
    ...typography.caption,
    color: colors.mutedText,
    fontStyle: 'italic',
  },
  voiceWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  voiceStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    gap: spacing.md,
    ...shadow.raised,
  },
  micWrap: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseHalo: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E0352B',
  },
  voiceText: {
    flex: 1,
  },
  voiceTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  voiceTitle: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontWeight: '700',
    fontSize: 14,
  },
  voiceHint: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 1,
  },
});
