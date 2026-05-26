import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, shadow, spacing, typography } from '../theme';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { SectionHeader } from '../components/SectionHeader';
import { StatusPill } from '../components/StatusPill';
import { AnimatedWaveform } from '../components/AnimatedWaveform';
import {
  ComplianceRule,
  ComplianceRules,
  loadComplianceRules,
} from '../services/complianceRules';
import {
  DeductibilityResult,
  ParsedItinerary,
  TripType,
  Verdict,
  evaluateDeductibility,
  evaluateFromCounts,
} from '../services/deductibilityEngine';
import { DEMO_TRANSCRIPT, getDemoItinerary } from '../services/itineraryAnalyzer';
import {
  MissingProxyError,
  ProxyUnreachableError,
  analyzeItinerary,
  ensureMicPermission,
  releaseAudioMode,
  startRecording as startMicRecording,
  stopRecordingAndGetUri,
  transcribe,
} from '../services/openai';
import { useFocusEffect } from '@react-navigation/native';
import { consume, peek } from '../services/voiceInbox';
import {
  supabase,
  requireUserId,
  type BusinessTripRow,
} from '../services/supabase';
import { useBusiness } from '../business/BusinessContext';
import { useKeepAwakeWhile } from '../hooks/useKeepAwakeWhile';
import { KeepAwakeIndicator } from '../components/KeepAwakeIndicator';

type TabKey = 'analyzer' | 'log' | 'history' | 'rules';

const TABS: Array<{ key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: 'analyzer', label: 'AI Analyzer', icon: 'sparkles-outline' },
  { key: 'log', label: 'Log Trip', icon: 'add-circle-outline' },
  { key: 'history', label: 'History', icon: 'time-outline' },
  { key: 'rules', label: 'IRS Rules', icon: 'book-outline' },
];

interface TripHistoryEntry {
  id: string;
  destination: string;
  date_range: string;
  trip_type: TripType;
  total_days: number;
  business_days: number;
  personal_days: number;
  travel_days: number;
  verdict: Verdict;
  deduct_pct: number;
  purpose: string;
}

const MONTH_SHORT_BT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const formatDateRange = (start: string | null, end: string | null): string => {
  const fmt = (iso: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return `${MONTH_SHORT_BT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  };
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  return fmt(start || end);
};

const tripRowToEntry = (row: BusinessTripRow): TripHistoryEntry => ({
  id: row.id,
  destination: row.destination ?? 'Trip',
  date_range: formatDateRange(row.departure_date, row.return_date),
  trip_type: (row.trip_type ?? 'domestic') as TripType,
  total_days: row.total_days ?? 0,
  business_days: row.business_days ?? 0,
  personal_days: row.personal_days ?? 0,
  travel_days: Math.max(0, (row.total_days ?? 0) - (row.business_days ?? 0) - (row.personal_days ?? 0)),
  verdict: (row.compliance_verdict as Verdict) ?? 'not_deductible',
  deduct_pct: row.transport_deduct_pct ?? 0,
  purpose: row.purpose ?? '',
});

const verdictTheme: Record<
  Verdict,
  { bg: string; fg: string; icon: keyof typeof Ionicons.glyphMap; title: string }
> = {
  full_deduction: {
    bg: '#E1F5EE',
    fg: colors.teal,
    icon: 'checkmark-circle',
    title: 'Fully deductible',
  },
  partial_deduction: {
    bg: '#FAEEDA',
    fg: colors.amber,
    icon: 'warning',
    title: 'Partially deductible',
  },
  not_deductible: {
    bg: '#FCEBEB',
    fg: '#B33A3A',
    icon: 'close-circle',
    title: 'Not deductible',
  },
};

const dayTheme = {
  business: { bg: '#E6F1FB', fg: '#0C447C', icon: 'briefcase' as const },
  travel: { bg: '#E1F5EE', fg: '#085041', icon: 'airplane' as const },
  personal: { bg: '#FCEBEB', fg: '#791F1F', icon: 'sunny' as const },
};

const NOT_DEDUCT_RED = '#B33A3A';

export const BusinessTravelScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<TabKey>('analyzer');
  const [rules, setRules] = useState<ComplianceRules | null>(null);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [trips, setTrips] = useState<TripHistoryEntry[]>([]);

  useEffect(() => {
    loadComplianceRules()
      .then(setRules)
      .catch((e: Error) => setRulesError(e.message));
  }, []);

  const { activeBusinessId } = useBusiness();

  const loadTrips = React.useCallback(async () => {
    try {
      let query = supabase
        .from('business_trips')
        .select('*')
        .order('departure_date', { ascending: false, nullsFirst: false });
      if (activeBusinessId) query = query.eq('business_id', activeBusinessId);
      const { data, error } = await query;
      if (error) throw error;
      setTrips(((data ?? []) as BusinessTripRow[]).map(tripRowToEntry));
    } catch (e) {
      Alert.alert('Could not load trips', e instanceof Error ? e.message : String(e));
    }
  }, [activeBusinessId]);

  useFocusEffect(
    React.useCallback(() => {
      loadTrips();
    }, [loadTrips]),
  );

  return (
    <View style={styles.root}>
      <Header subtitle="Business Travel · Compliance Engine" year={2026} />
      <View style={styles.tabBar}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              activeOpacity={0.85}
              onPress={() => setTab(t.key)}
              style={[styles.tabBtn, active && styles.tabBtnActive]}
            >
              <Ionicons
                name={t.icon}
                size={15}
                color={active ? colors.white : colors.mutedText}
              />
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {rulesError ? (
        <View style={styles.rulesError}>
          <Ionicons name="alert-circle" size={16} color={NOT_DEDUCT_RED} />
          <Text style={styles.rulesErrorText}>
            Could not load compliance rules: {rulesError}
          </Text>
        </View>
      ) : null}

      {!rules ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.navy} />
          <Text style={styles.loadingText}>Loading compliance rules…</Text>
        </View>
      ) : (
        <View style={styles.body}>
          {tab === 'analyzer' && (
            <AnalyzerTab rules={rules} insets={insets} />
          )}
          {tab === 'log' && (
            <LogTripTab
              rules={rules}
              insets={insets}
              onSaved={async () => {
                await loadTrips();
                setTab('history');
              }}
            />
          )}
          {tab === 'history' && <HistoryTab trips={trips} insets={insets} />}
          {tab === 'rules' && <RulesTab rules={rules} insets={insets} />}
        </View>
      )}
    </View>
  );
};

// ───────────────────────────── Analyzer tab ─────────────────────────────

interface AnalyzerTabProps {
  rules: ComplianceRules;
  insets: { bottom: number };
}

const AnalyzerTab: React.FC<AnalyzerTabProps> = ({ rules, insets }) => {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  useKeepAwakeWhile(isRecording, 'travel-analyzer');
  const [transcript, setTranscript] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedItinerary | null>(null);
  const typingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isRecording) {
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
  }, [isRecording, pulse]);

  useEffect(() => {
    return () => {
      if (typingTimer.current) clearInterval(typingTimer.current);
    };
  }, []);

  const typeOutTranscript = (text: string) => {
    if (typingTimer.current) clearInterval(typingTimer.current);
    setTranscript('');
    let i = 0;
    typingTimer.current = setInterval(() => {
      i += 1;
      setTranscript(text.slice(0, i));
      if (i >= text.length) {
        if (typingTimer.current) clearInterval(typingTimer.current);
        typingTimer.current = null;
      }
    }, 18);
  };

  const consumeIfTrip = React.useCallback(() => {
    const pending = peek();
    if (!pending || pending.activity_type !== 'business_trip') return;
    const note = consume();
    if (!note) return;
    const text = note.description || note.business_purpose || '';
    if (text) typeOutTranscript(text);
    if (note.trip_type && note.total_days && note.total_days > 0) {
      const business = note.business_days ?? 0;
      const personal = note.personal_days ?? 0;
      const travel = Math.max(0, note.total_days - business - personal);
      const days = (note.day_by_day_log ?? []).map((d) => ({
        date: d.date,
        kind: d.type,
        label: d.description,
      }));
      setParsed({
        destination: note.destination ?? '',
        trip_type: note.trip_type,
        total_days: note.total_days,
        business_days: business,
        personal_days: personal,
        travel_days: travel,
        days,
        purpose: note.business_purpose ?? note.description ?? '',
      });
    }
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      consumeIfTrip();
    }, [consumeIfTrip]),
  );

  const startRecording = async () => {
    try {
      const granted = await ensureMicPermission();
      if (!granted) {
        Alert.alert('Microphone permission required to record itinerary.');
        return;
      }
      const rec = await startMicRecording();
      setRecording(rec);
      setIsRecording(true);
      setParsed(null);
      setAnalyzeError(null);
    } catch (e) {
      Alert.alert('Could not start recording', (e as Error).message);
    }
  };

  const stopRecording = async () => {
    if (!recording) return;
    setIsRecording(false);
    try {
      const uri = await stopRecordingAndGetUri(recording);
      await releaseAudioMode().catch(() => undefined);
      setRecording(null);
      if (!uri) return;
      setTranscribing(true);
      const text = await transcribe(uri);
      setTranscribing(false);
      typeOutTranscript(text);
    } catch (e) {
      setTranscribing(false);
      console.warn('[travel] transcription failed', e);
      if (e instanceof MissingProxyError) {
        Alert.alert('Proxy not configured', e.message);
      } else if (e instanceof ProxyUnreachableError) {
        Alert.alert('Proxy unreachable', e.message);
      } else {
        Alert.alert(
          'Transcription failed',
          (e as Error).message || 'Whisper request failed.',
        );
      }
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      void stopRecording();
    } else {
      void startRecording();
    }
  };

  const onAnalyze = async () => {
    if (!transcript.trim()) {
      Alert.alert('Record or paste an itinerary first.');
      return;
    }
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const itin = await analyzeItinerary(transcript);
      setParsed(itin);
    } catch (e) {
      console.warn('[travel] analyze itinerary failed', e);
      if (e instanceof MissingProxyError) {
        setAnalyzeError(e.message);
      } else if (e instanceof ProxyUnreachableError) {
        setAnalyzeError(e.message);
      } else {
        setAnalyzeError((e as Error).message);
      }
    } finally {
      setAnalyzing(false);
    }
  };

  const onTryDemo = () => {
    typeOutTranscript(DEMO_TRANSCRIPT);
    setParsed(getDemoItinerary());
    setAnalyzeError(null);
  };

  const result = useMemo<DeductibilityResult | null>(() => {
    if (!parsed) return null;
    return evaluateDeductibility(parsed, rules);
  }, [parsed, rules]);

  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.16],
  });
  const haloOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 0],
  });
  const haloScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.9],
  });

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: 32 + insets.bottom },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Card padded>
        <Text style={styles.sectionLabel}>Spoken itinerary</Text>
        <Text style={styles.helperText}>
          Tap the mic, describe your trip out loud, and let the analyzer
          classify each day and the deduction.
        </Text>

        <View style={styles.micRow}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={toggleRecording}
            style={styles.micWrap}
            disabled={transcribing}
          >
            {isRecording ? (
              <Animated.View
                style={[
                  styles.pulseHalo,
                  { opacity: haloOpacity, transform: [{ scale: haloScale }] },
                ]}
              />
            ) : null}
            <Animated.View
              style={[
                styles.micButton,
                {
                  backgroundColor: isRecording ? '#E0352B' : colors.navy,
                  transform: [{ scale: isRecording ? pulseScale : 1 }],
                },
              ]}
            >
              <Ionicons
                name={isRecording ? 'square' : 'mic'}
                size={22}
                color={colors.white}
              />
            </Animated.View>
          </TouchableOpacity>
          <View style={styles.micText}>
            <View style={styles.micTitleRow}>
              <Text style={styles.micTitle}>
                {isRecording
                  ? 'Listening…'
                  : transcribing
                    ? 'Transcribing…'
                    : 'Tap to record'}
              </Text>
              <KeepAwakeIndicator visible={isRecording} />
            </View>
            <Text style={styles.micHint}>
              {isRecording
                ? 'Tap again to stop'
                : 'Whisper will turn your voice into text'}
            </Text>
          </View>
        </View>

        <AnimatedWaveform
          active={isRecording}
          height={48}
          style={styles.waveform}
        />

        <Text style={styles.sectionLabel}>Transcript</Text>
        <TextInput
          style={styles.transcriptBox}
          multiline
          placeholder={
            'Your itinerary will appear here. You can also type or paste it ' +
            'directly.'
          }
          placeholderTextColor={colors.subtleText}
          value={transcript}
          onChangeText={(v) => {
            if (typingTimer.current) {
              clearInterval(typingTimer.current);
              typingTimer.current = null;
            }
            setTranscript(v);
          }}
        />

        <View style={styles.actionsRow}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={onAnalyze}
            disabled={analyzing}
            style={[styles.btn, styles.btnPrimary, analyzing && styles.btnDim]}
          >
            {analyzing ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Ionicons name="sparkles" size={16} color={colors.white} />
            )}
            <Text style={styles.btnPrimaryText}>Analyze compliance</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={onTryDemo}
            style={[styles.btn, styles.btnOutline]}
          >
            <Ionicons
              name="flask-outline"
              size={16}
              color={colors.navy}
            />
            <Text style={styles.btnOutlineText}>Try demo itinerary</Text>
          </TouchableOpacity>
        </View>

        {analyzeError ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={14} color={NOT_DEDUCT_RED} />
            <Text style={styles.errorBoxText}>{analyzeError}</Text>
          </View>
        ) : null}
      </Card>

      {parsed && result ? (
        <ResultBlock parsed={parsed} result={result} rules={rules} />
      ) : null}
    </ScrollView>
  );
};

interface ResultBlockProps {
  parsed: ParsedItinerary;
  result: DeductibilityResult;
  rules: ComplianceRules;
}

const ResultBlock: React.FC<ResultBlockProps> = ({ parsed, result, rules }) => {
  const v = verdictTheme[result.verdict];
  const tripBadgeLabel =
    result.trip_type === 'domestic' ? 'Domestic' : 'International';

  return (
    <>
      <Card padded>
        <View style={styles.tripHeader}>
          <View>
            <Text style={styles.tripDest}>{parsed.destination}</Text>
            <Text style={styles.tripPurpose}>{parsed.purpose}</Text>
          </View>
          <View style={styles.tripBadge}>
            <Ionicons
              name={
                result.trip_type === 'international'
                  ? 'globe-outline'
                  : 'map-outline'
              }
              size={13}
              color={colors.midNavy}
            />
            <Text style={styles.tripBadgeText}>
              {tripBadgeLabel} · {result.total_days}d
            </Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <StatTile
            label="Business"
            value={result.counted_business_days.toString()}
            color={colors.teal}
            bg={colors.tealLight}
          />
          <View style={styles.statGap} />
          <StatTile
            label="Personal"
            value={result.personal_days.toString()}
            color={NOT_DEDUCT_RED}
            bg="#FCEBEB"
          />
          <View style={styles.statGap} />
          <StatTile
            label="Business %"
            value={`${result.business_day_pct}%`}
            color={colors.amber}
            bg={colors.amberLight}
          />
        </View>
      </Card>

      <View style={[styles.verdictCard, { backgroundColor: v.bg }]}>
        <View style={styles.verdictHeader}>
          <Ionicons name={v.icon} size={22} color={v.fg} />
          <Text style={[styles.verdictTitle, { color: v.fg }]}>{v.title}</Text>
        </View>
        <Text style={[styles.verdictBody, { color: v.fg }]}>
          {result.rationale}
        </Text>
        <Text style={[styles.verdictRule, { color: v.fg }]}>
          {result.rule_applied}
        </Text>
      </View>

      <Card padded>
        <SectionHeader title="Day-by-day" />
        <View style={styles.dayGrid}>
          {parsed.days.map((d, i) => {
            const th = dayTheme[d.kind];
            return (
              <View
                key={`${d.date}-${i}`}
                style={[styles.dayCell, { backgroundColor: th.bg }]}
              >
                <Text style={[styles.dayNum, { color: th.fg }]}>
                  D{i + 1}
                </Text>
                <Ionicons name={th.icon} size={12} color={th.fg} />
                <Text
                  style={[styles.dayLabel, { color: th.fg }]}
                  numberOfLines={2}
                >
                  {d.label}
                </Text>
              </View>
            );
          })}
        </View>
        <View style={styles.dayLegend}>
          {(['business', 'travel', 'personal'] as const).map((k) => (
            <View key={k} style={styles.legendItem}>
              <View
                style={[
                  styles.legendSwatch,
                  { backgroundColor: dayTheme[k].bg },
                ]}
              />
              <Text style={styles.legendText}>
                {k[0].toUpperCase() + k.slice(1)} day
              </Text>
            </View>
          ))}
        </View>
      </Card>

      <Card padded>
        <SectionHeader title="Deductibility breakdown" />
        <BreakdownRow
          label="Transportation"
          sub="Flights, trains, primary travel"
          value={`${result.breakdown.transportation_pct}%`}
          color={result.breakdown.transportation_pct === 100
            ? colors.teal
            : result.breakdown.transportation_pct === 0
              ? NOT_DEDUCT_RED
              : colors.amber}
        />
        <BreakdownRow
          label="Lodging — business days"
          sub="Hotels on days categorized as business or travel"
          value={`${result.breakdown.lodging_business_day_pct}%`}
          color={colors.teal}
        />
        <BreakdownRow
          label="Lodging — personal days"
          sub="Hotel nights on personal days"
          value={`${result.breakdown.lodging_personal_day_pct}%`}
          color={NOT_DEDUCT_RED}
        />
        <BreakdownRow
          label="Meals — business days"
          sub={`Capped by §274(n) at ${Math.round(rules.mealsDeductionPct * 100)}%`}
          value={`${result.breakdown.meals_business_day_pct}%`}
          color={colors.amber}
        />
        <BreakdownRow
          label="Meals — personal days"
          sub="Not deductible"
          value={`${result.breakdown.meals_personal_day_pct}%`}
          color={NOT_DEDUCT_RED}
          isLast
        />
      </Card>
    </>
  );
};

const StatTile: React.FC<{
  label: string;
  value: string;
  color: string;
  bg: string;
}> = ({ label, value, color, bg }) => (
  <View style={[styles.statTile, { backgroundColor: bg }]}>
    <Text style={[styles.statValue, { color }]}>{value}</Text>
    <Text style={[styles.statLabel, { color }]}>{label}</Text>
  </View>
);

const BreakdownRow: React.FC<{
  label: string;
  sub: string;
  value: string;
  color: string;
  isLast?: boolean;
}> = ({ label, sub, value, color, isLast }) => (
  <View style={[styles.breakdownRow, !isLast && styles.breakdownDivider]}>
    <View style={styles.breakdownLeft}>
      <Text style={styles.breakdownLabel}>{label}</Text>
      <Text style={styles.breakdownSub}>{sub}</Text>
    </View>
    <Text style={[styles.breakdownValue, { color }]}>{value}</Text>
  </View>
);

// ───────────────────────────── Log Trip tab ─────────────────────────────

interface LogTripTabProps {
  rules: ComplianceRules;
  insets: { bottom: number };
  onSaved: () => Promise<void> | void;
}

const LogTripTab: React.FC<LogTripTabProps> = ({ rules, insets, onSaved }) => {
  const { activeBusinessId } = useBusiness();
  const [tripType, setTripType] = useState<TripType>('domestic');
  const [destination, setDestination] = useState('');
  const [departure, setDeparture] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [businessDays, setBusinessDays] = useState('');
  const [totalDays, setTotalDays] = useState('');
  const [purpose, setPurpose] = useState('');
  const [countries, setCountries] = useState('');
  const [intlReason, setIntlReason] = useState('');
  const [expTransport, setExpTransport] = useState('');
  const [expLodging, setExpLodging] = useState('');
  const [expMeals, setExpMeals] = useState('');
  const [expOther, setExpOther] = useState('');
  const [preview, setPreview] = useState<DeductibilityResult | null>(null);

  const parseN = (s: string) => {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  };

  const onCalculate = () => {
    const total = parseN(totalDays);
    const biz = parseN(businessDays);
    if (total <= 0) {
      Alert.alert('Enter the total days for the trip.');
      return;
    }
    const result = evaluateFromCounts({
      trip_type: tripType,
      destination: destination || 'Trip',
      purpose,
      total_days: total,
      business_days: biz,
      countries: countries
        ? countries.split(',').map((c) => c.trim()).filter(Boolean)
        : undefined,
      rules,
    });
    setPreview(result);
  };

  const toIsoDate = (s: string): string | null => {
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  };

  const onSubmit = async () => {
    const total = parseN(totalDays);
    const biz = parseN(businessDays);
    if (!destination || total <= 0) {
      Alert.alert('Destination and total days are required.');
      return;
    }
    const result = evaluateFromCounts({
      trip_type: tripType,
      destination,
      purpose,
      total_days: total,
      business_days: biz,
      countries: countries
        ? countries.split(',').map((c) => c.trim()).filter(Boolean)
        : undefined,
      rules,
    });

    try {
      const userId = await requireUserId();
      const { error } = await supabase.from('business_trips').insert({
        user_id: userId,
        business_id: activeBusinessId,
        trip_type: tripType,
        destination,
        countries_visited: countries
          ? countries.split(',').map((c) => c.trim()).filter(Boolean)
          : null,
        purpose,
        departure_date: toIsoDate(departure),
        return_date: toIsoDate(returnDate),
        total_days: total,
        business_days: result.business_days,
        personal_days: result.personal_days,
        business_day_pct: result.business_day_pct,
        transport_deduct_pct: result.breakdown.transportation_pct,
        day_by_day_log: null,
        itinerary_transcript: null,
        compliance_verdict: result.verdict,
        compliance_notes: result.rationale,
        expenses_transport: parseN(expTransport) || null,
        expenses_lodging: parseN(expLodging) || null,
        expenses_meals: parseN(expMeals) || null,
        expenses_other: parseN(expOther) || null,
        status: 'logged',
      });
      if (error) throw new Error(error.message);
      await onSaved();
    } catch (e) {
      Alert.alert('Could not save trip', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: 32 + insets.bottom },
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <Card padded>
        <Text style={styles.sectionLabel}>Trip type</Text>
        <View style={styles.segmentRow}>
          {(['domestic', 'international'] as const).map((kind) => {
            const active = tripType === kind;
            return (
              <TouchableOpacity
                key={kind}
                activeOpacity={0.85}
                onPress={() => setTripType(kind)}
                style={[
                  styles.segmentBtn,
                  active && styles.segmentBtnActive,
                ]}
              >
                <Ionicons
                  name={kind === 'domestic' ? 'flag-outline' : 'globe-outline'}
                  size={14}
                  color={active ? colors.white : colors.navy}
                />
                <Text
                  style={[
                    styles.segmentLabel,
                    active && styles.segmentLabelActive,
                  ]}
                >
                  {kind === 'domestic' ? 'Domestic' : 'International'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {tripType === 'international' ? (
          <>
            <View style={styles.intlBanner}>
              <Ionicons
                name="information-circle"
                size={16}
                color={colors.midNavy}
              />
              <Text style={styles.intlBannerText}>
                For international trips longer than{' '}
                {rules.internationalShortTripMaxDays} days, transportation is
                allocated by business-day percentage when personal time is{' '}
                {Math.round(rules.internationalPersonalDayThreshold * 100)}% or
                more of total days.
              </Text>
            </View>
            <LabeledInput
              label="Countries visited"
              placeholder="e.g. Germany, France"
              value={countries}
              onChangeText={setCountries}
            />
            <LabeledInput
              label="Primary business reason"
              placeholder="e.g. Quarterly partner meetings"
              value={intlReason}
              onChangeText={setIntlReason}
            />
          </>
        ) : null}

        <LabeledInput
          label="Destination"
          placeholder="e.g. Phoenix, AZ"
          value={destination}
          onChangeText={setDestination}
        />
        <View style={styles.fieldRow}>
          <LabeledInput
            label="Departure date"
            placeholder="YYYY-MM-DD"
            value={departure}
            onChangeText={setDeparture}
            style={styles.flexHalf}
          />
          <View style={styles.fieldGap} />
          <LabeledInput
            label="Return date"
            placeholder="YYYY-MM-DD"
            value={returnDate}
            onChangeText={setReturnDate}
            style={styles.flexHalf}
          />
        </View>
        <View style={styles.fieldRow}>
          <LabeledInput
            label="Business days"
            placeholder="0"
            keyboardType="numeric"
            value={businessDays}
            onChangeText={setBusinessDays}
            style={styles.flexHalf}
          />
          <View style={styles.fieldGap} />
          <LabeledInput
            label="Total days"
            placeholder="0"
            keyboardType="numeric"
            value={totalDays}
            onChangeText={setTotalDays}
            style={styles.flexHalf}
          />
        </View>
        <LabeledInput
          label="Business purpose"
          placeholder="What was the trip for?"
          value={purpose}
          onChangeText={setPurpose}
          multiline
        />

        <Text style={[styles.sectionLabel, styles.sectionGap]}>Expenses</Text>
        <View style={styles.fieldRow}>
          <LabeledInput
            label="Transport"
            placeholder="0.00"
            keyboardType="decimal-pad"
            value={expTransport}
            onChangeText={setExpTransport}
            style={styles.flexHalf}
          />
          <View style={styles.fieldGap} />
          <LabeledInput
            label="Lodging"
            placeholder="0.00"
            keyboardType="decimal-pad"
            value={expLodging}
            onChangeText={setExpLodging}
            style={styles.flexHalf}
          />
        </View>
        <View style={styles.fieldRow}>
          <LabeledInput
            label="Meals"
            placeholder="0.00"
            keyboardType="decimal-pad"
            value={expMeals}
            onChangeText={setExpMeals}
            style={styles.flexHalf}
          />
          <View style={styles.fieldGap} />
          <LabeledInput
            label="Other"
            placeholder="0.00"
            keyboardType="decimal-pad"
            value={expOther}
            onChangeText={setExpOther}
            style={styles.flexHalf}
          />
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={onCalculate}
            style={[styles.btn, styles.btnOutline]}
          >
            <Ionicons name="calculator-outline" size={16} color={colors.navy} />
            <Text style={styles.btnOutlineText}>Calculate deductibility</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={onSubmit}
            style={[styles.btn, styles.btnPrimary]}
          >
            <Ionicons name="save-outline" size={16} color={colors.white} />
            <Text style={styles.btnPrimaryText}>Save trip</Text>
          </TouchableOpacity>
        </View>
      </Card>

      {preview ? (
        <View
          style={[
            styles.verdictCard,
            { backgroundColor: verdictTheme[preview.verdict].bg },
          ]}
        >
          <View style={styles.verdictHeader}>
            <Ionicons
              name={verdictTheme[preview.verdict].icon}
              size={20}
              color={verdictTheme[preview.verdict].fg}
            />
            <Text
              style={[
                styles.verdictTitle,
                { color: verdictTheme[preview.verdict].fg },
              ]}
            >
              {verdictTheme[preview.verdict].title} — transportation{' '}
              {preview.breakdown.transportation_pct}%
            </Text>
          </View>
          <Text
            style={[
              styles.verdictBody,
              { color: verdictTheme[preview.verdict].fg },
            ]}
          >
            {preview.rationale}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
};

const LabeledInput: React.FC<{
  label: string;
  placeholder?: string;
  value: string;
  onChangeText: (v: string) => void;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
  multiline?: boolean;
  style?: any;
}> = ({ label, placeholder, value, onChangeText, keyboardType, multiline, style }) => (
  <View style={[styles.field, style]}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput
      style={[styles.fieldInput, multiline && styles.fieldInputMulti]}
      placeholder={placeholder}
      placeholderTextColor={colors.subtleText}
      value={value}
      onChangeText={onChangeText}
      keyboardType={keyboardType ?? 'default'}
      multiline={multiline}
    />
  </View>
);

// ───────────────────────────── History tab ──────────────────────────────

const HistoryTab: React.FC<{
  trips: TripHistoryEntry[];
  insets: { bottom: number };
}> = ({ trips, insets }) => {
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: 32 + insets.bottom },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {trips.length === 0 ? (
        <Card padded>
          <Text style={styles.emptyText}>
            No trips logged yet. Use Log Trip to add one.
          </Text>
        </Card>
      ) : (
        trips.map((t) => <TripRow key={t.id} trip={t} />)
      )}
    </ScrollView>
  );
};

const TripRow: React.FC<{ trip: TripHistoryEntry }> = ({ trip }) => {
  const pillProps = (() => {
    if (trip.verdict === 'full_deduction') {
      return { label: '100% deductible', variant: 'success' as const };
    }
    if (trip.verdict === 'not_deductible') {
      return { label: 'Not deductible', variant: 'warning' as const };
    }
    return {
      label: `${trip.deduct_pct}% deductible`,
      variant: 'warning' as const,
    };
  })();
  const pillBg = trip.verdict === 'not_deductible' ? '#FCEBEB' : undefined;
  const pillFg = trip.verdict === 'not_deductible' ? NOT_DEDUCT_RED : undefined;

  return (
    <View style={styles.tripRow}>
      <View style={styles.tripIconWrap}>
        <Ionicons
          name={
            trip.trip_type === 'international' ? 'globe-outline' : 'airplane-outline'
          }
          size={18}
          color={colors.midNavy}
        />
      </View>
      <View style={styles.tripRowMain}>
        <View style={styles.tripRowHeader}>
          <Text style={styles.tripRowDest} numberOfLines={1}>
            {trip.destination}
          </Text>
          {pillBg ? (
            <View style={[styles.pillCustom, { backgroundColor: pillBg }]}>
              <Text style={[styles.pillCustomText, { color: pillFg }]}>
                {pillProps.label}
              </Text>
            </View>
          ) : (
            <StatusPill label={pillProps.label} variant={pillProps.variant} />
          )}
        </View>
        <Text style={styles.tripRowMeta}>
          {trip.date_range} · {trip.total_days}d ·{' '}
          {trip.trip_type === 'international' ? 'International' : 'Domestic'}
        </Text>
        {trip.purpose ? (
          <Text style={styles.tripRowPurpose} numberOfLines={1}>
            {trip.purpose}
          </Text>
        ) : null}
      </View>
    </View>
  );
};

// ───────────────────────────── Rules tab ────────────────────────────────

const RulesTab: React.FC<{
  rules: ComplianceRules;
  insets: { bottom: number };
}> = ({ rules, insets }) => {
  const grouped = useMemo(() => {
    const domestic = rules.raw.filter(
      (r) => r.jurisdiction === 'domestic' || r.code_section === 'IRC §162',
    );
    const international = rules.raw.filter(
      (r) => r.jurisdiction === 'international',
    );
    const shared = rules.raw.filter(
      (r) =>
        r.jurisdiction === 'shared' &&
        r.code_section !== 'IRC §162',
    );
    return { domestic, international, shared };
  }, [rules]);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: 32 + insets.bottom },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <RuleSection
        title="Domestic"
        subtitle="IRC §162 — Ordinary and necessary business expenses"
        rules={grouped.domestic}
      />
      <RuleSection
        title="International"
        subtitle="IRC §274(c) — Foreign travel allocation"
        rules={grouped.international}
      />
      {grouped.shared.length > 0 ? (
        <RuleSection
          title="Shared limits"
          subtitle="Apply to both domestic and international trips"
          rules={grouped.shared}
        />
      ) : null}

      <View style={styles.adminNote}>
        <Ionicons name="shield-checkmark" size={14} color={colors.midNavy} />
        <Text style={styles.adminNoteText}>
          These rules update automatically when your tax firm administrator
          approves changes.
        </Text>
      </View>
    </ScrollView>
  );
};

const RuleSection: React.FC<{
  title: string;
  subtitle: string;
  rules: ComplianceRule[];
}> = ({ title, subtitle, rules }) => (
  <Card padded>
    <Text style={styles.ruleSectionTitle}>{title}</Text>
    <Text style={styles.ruleSectionSubtitle}>{subtitle}</Text>
    {rules.map((r, i) => (
      <View
        key={r.key}
        style={[styles.ruleRow, i !== rules.length - 1 && styles.ruleRowDivider]}
      >
        <View style={styles.ruleRowHead}>
          <Text style={styles.ruleTitle}>{r.title}</Text>
          <View style={styles.ruleBadge}>
            <Text style={styles.ruleBadgeText}>{r.code_section}</Text>
          </View>
        </View>
        <Text style={styles.ruleBody}>{r.body}</Text>
        <Text style={styles.ruleMeta}>Last reviewed {r.updated_at}</Text>
      </View>
    ))}
  </Card>
);

// ───────────────────────────── Styles ───────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    gap: 6,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    backgroundColor: '#F1F3F5',
  },
  tabBtnActive: {
    backgroundColor: colors.navy,
  },
  tabLabel: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '600',
    color: colors.mutedText,
  },
  tabLabelActive: {
    color: colors.white,
  },
  body: {
    flex: 1,
  },
  scroll: { flex: 1 },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  loadingText: {
    ...typography.body,
    color: colors.mutedText,
  },
  rulesError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FCEBEB',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  rulesErrorText: {
    ...typography.caption,
    color: NOT_DEDUCT_RED,
    flex: 1,
  },
  sectionLabel: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: spacing.xs,
  },
  sectionGap: { marginTop: spacing.md },
  helperText: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 13,
    marginBottom: spacing.md,
  },
  micRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  micWrap: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.raised,
  },
  pulseHalo: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#E0352B',
  },
  micText: { flex: 1 },
  micTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  micTitle: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontWeight: '700',
    fontSize: 15,
  },
  micHint: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 2,
  },
  waveform: {
    marginVertical: spacing.sm,
  },
  transcriptBox: {
    minHeight: 96,
    backgroundColor: '#F8FAFC',
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: spacing.md,
    ...typography.body,
    color: colors.bodyText,
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: 'top',
    marginBottom: spacing.md,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.card,
    paddingVertical: 12,
    paddingHorizontal: spacing.sm,
  },
  btnPrimary: {
    backgroundColor: colors.navy,
    ...shadow.raised,
  },
  btnPrimaryText: {
    ...typography.bodyMedium,
    color: colors.white,
    fontWeight: '700',
    fontSize: 13,
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
    fontSize: 13,
  },
  btnDim: { opacity: 0.7 },
  errorBox: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: '#FCEBEB',
    padding: spacing.sm,
    borderRadius: radius.card,
  },
  errorBoxText: {
    ...typography.caption,
    color: NOT_DEDUCT_RED,
    flex: 1,
    fontSize: 12,
  },
  tripHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.md,
  },
  tripDest: {
    ...typography.h2,
    color: colors.bodyText,
    fontSize: 17,
    fontWeight: '700',
  },
  tripPurpose: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 2,
  },
  tripBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.lightBlue,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
  },
  tripBadgeText: {
    ...typography.caption,
    color: colors.midNavy,
    fontSize: 11,
    fontWeight: '700',
  },
  statsRow: {
    flexDirection: 'row',
  },
  statGap: { width: spacing.sm },
  statTile: {
    flex: 1,
    borderRadius: radius.card,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  statValue: {
    ...typography.metric,
    fontSize: 26,
    letterSpacing: -0.3,
  },
  statLabel: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  verdictCard: {
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  verdictHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  verdictTitle: {
    ...typography.h2,
    fontWeight: '700',
    fontSize: 16,
  },
  verdictBody: {
    ...typography.body,
    fontSize: 13,
    lineHeight: 19,
    opacity: 0.9,
  },
  verdictRule: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '700',
    marginTop: spacing.xs,
    opacity: 0.8,
  },
  dayGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.xs,
  },
  dayCell: {
    width: `${100 / 7 - 1}%`,
    aspectRatio: 0.82,
    borderRadius: 8,
    padding: 6,
    gap: 2,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  dayNum: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '700',
  },
  dayLabel: {
    ...typography.caption,
    fontSize: 9,
    fontWeight: '600',
    lineHeight: 11,
  },
  dayLegend: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendSwatch: {
    width: 12,
    height: 12,
    borderRadius: 3,
  },
  legendText: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  breakdownDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  breakdownLeft: { flex: 1 },
  breakdownLabel: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontWeight: '600',
    fontSize: 13,
  },
  breakdownSub: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    marginTop: 1,
  },
  breakdownValue: {
    ...typography.h2,
    fontSize: 17,
    fontWeight: '700',
  },
  segmentRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: colors.navy,
    backgroundColor: colors.white,
  },
  segmentBtnActive: {
    backgroundColor: colors.navy,
  },
  segmentLabel: {
    ...typography.bodyMedium,
    color: colors.navy,
    fontWeight: '700',
    fontSize: 13,
  },
  segmentLabelActive: { color: colors.white },
  intlBanner: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: '#E6F1FB',
    padding: spacing.md,
    borderRadius: radius.card,
    marginBottom: spacing.md,
  },
  intlBannerText: {
    ...typography.body,
    color: '#0C447C',
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  field: {
    marginBottom: spacing.md,
  },
  flexHalf: { flex: 1, marginBottom: 0 },
  fieldGap: { width: spacing.sm },
  fieldRow: {
    flexDirection: 'row',
    marginBottom: spacing.md,
  },
  fieldLabel: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  fieldInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.select({ ios: 12, default: 10 }),
    ...typography.body,
    color: colors.bodyText,
    fontSize: 14,
  },
  fieldInputMulti: {
    minHeight: 64,
    textAlignVertical: 'top',
  },
  tripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: spacing.md,
    ...shadow.card,
  },
  tripIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.lightBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripRowMain: { flex: 1 },
  tripRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  tripRowDest: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontWeight: '700',
    fontSize: 14,
    flex: 1,
  },
  tripRowMeta: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 2,
  },
  tripRowPurpose: {
    ...typography.body,
    color: colors.subtleText,
    fontSize: 12,
    marginTop: 1,
  },
  pillCustom: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  pillCustomText: {
    ...typography.micro,
    fontSize: 11,
  },
  emptyText: {
    ...typography.body,
    color: colors.mutedText,
    textAlign: 'center',
  },
  ruleSectionTitle: {
    ...typography.h2,
    color: colors.bodyText,
    fontSize: 17,
    fontWeight: '700',
  },
  ruleSectionSubtitle: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 2,
    marginBottom: spacing.sm,
  },
  ruleRow: {
    paddingVertical: spacing.md,
  },
  ruleRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  ruleRowHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: 4,
  },
  ruleTitle: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontWeight: '700',
    fontSize: 14,
    flex: 1,
  },
  ruleBadge: {
    backgroundColor: colors.lightBlue,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
  },
  ruleBadgeText: {
    ...typography.caption,
    color: colors.midNavy,
    fontWeight: '700',
    fontSize: 10,
  },
  ruleBody: {
    ...typography.body,
    color: colors.bodyText,
    fontSize: 13,
    lineHeight: 19,
  },
  ruleMeta: {
    ...typography.caption,
    color: colors.subtleText,
    fontSize: 11,
    marginTop: 6,
  },
  adminNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: colors.lightBlue,
    borderRadius: radius.card,
    padding: spacing.md,
  },
  adminNoteText: {
    ...typography.caption,
    color: '#0C447C',
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
});
