import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
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
import { SectionHeader } from '../components/SectionHeader';
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
} from '../services/supabase';

const GOAL_HOURS = 500;
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

const noteToInsert = (note: ClassifiedNote, userId: string) => {
  const map = STRATEGY_TO_CATEGORY[note.strategy_category] ?? {
    category: 'Admin',
  };
  return {
    user_id: userId,
    description: note.description || note.business_purpose || 'Voice-logged activity',
    category: map.category,
    hours: note.duration_hours ?? 0,
    activity_date: note.date,
  };
};

export const HoursScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [rows, setRows] = useState<HoursLogRow[]>([]);
  const [lastLoggedHours, setLastLoggedHours] = useState<number | null>(null);
  const recRef = useRef<Audio.Recording | null>(null);
  const pulse = useRef(new Animated.Value(0)).current;

  const loadHours = useCallback(async () => {
    try {
      const userId = await requireUserId();
      const year = new Date().getFullYear();
      const { data, error } = await supabase
        .from('hours_log')
        .select('*')
        .eq('user_id', userId)
        .gte('activity_date', `${year}-01-01`)
        .lte('activity_date', `${year}-12-31`)
        .order('activity_date', { ascending: false });
      if (error) throw error;
      setRows((data ?? []) as HoursLogRow[]);
    } catch (e) {
      console.warn('[hours] loadHours failed', e);
      Alert.alert('Could not load hours', e instanceof Error ? e.message : String(e));
    }
  }, []);

  const insertNote = useCallback(async (note: ClassifiedNote) => {
    const userId = await requireUserId();
    const insert = noteToInsert(note, userId);
    const { error } = await supabase.from('hours_log').insert(insert);
    if (error) throw new Error(error.message);
    setLastLoggedHours(note.duration_hours);
    await loadHours();
  }, [loadHours]);

  const consumeIfHoursLog = useCallback(() => {
    const pending = peek();
    if (pending && pending.activity_type === 'hours_log') {
      const note = consume();
      if (note) {
        insertNote(note).catch((e) =>
          Alert.alert('Could not save hours', e instanceof Error ? e.message : String(e)),
        );
      }
    }
  }, [insertNote]);

  useFocusEffect(
    useCallback(() => {
      consumeIfHoursLog();
      loadHours();
    }, [consumeIfHoursLog, loadHours]),
  );

  const activityLog: ActivityEntry[] = useMemo(() => rows.map(rowToActivity), [rows]);

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
        await insertNote(note);
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

  const hoursRemaining = Math.max(0, GOAL_HOURS - hoursThisYear);
  const yearProgress = Math.round((hoursThisYear / GOAL_HOURS) * 100);
  const yearUnderGoal = hoursThisYear < GOAL_HOURS;

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
          detail={`Log ${hoursRemaining} more hours by Dec 31 to hit the 500-hour material participation threshold.`}
        />

        <View style={styles.metricsRow}>
          <MetricCard
            label="Hours This Year"
            value={hoursThisYear.toFixed(0)}
            sublabel={`of ${GOAL_HOURS} goal`}
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

        <View style={styles.section}>
          <SectionHeader title="Activity Log" action="Filter" />
          <Card padded>
            {activityLog.map((entry, i) => (
              <View
                key={entry.id}
                style={[
                  styles.activityRow,
                  i !== activityLog.length - 1 && styles.activityRowDivider,
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
              </View>
            ))}
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
            <Text style={styles.voiceTitle} numberOfLines={1}>
              {recording
                ? 'Listening…'
                : processing
                  ? 'Logging…'
                  : lastLoggedHours != null
                    ? `Logged ${lastLoggedHours} hr`
                    : 'Voice Log'}
            </Text>
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
  metricsRow: {
    flexDirection: 'row',
  },
  gap: {
    width: spacing.md,
  },
  section: {
    gap: spacing.md,
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
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.md,
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
