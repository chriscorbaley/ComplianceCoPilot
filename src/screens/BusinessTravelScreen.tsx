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
import { DateInputField, DatePickerModal } from '../components/DateInputField';
import { useStrategyAccess } from '../hooks/useStrategyAccess';
import { BusinessTravelLockedScreen } from '../components/BusinessTravelLockedScreen';
import { Header } from '../components/Header';
import { YearSelector } from '../components/YearSelector';
import { useYear } from '../context/YearContext';
import { Card } from '../components/Card';
import { SectionHeader } from '../components/SectionHeader';
import { StatusPill } from '../components/StatusPill';
import { EditableListRow } from '../components/EditableListRow';
import { EditFormSheet } from '../components/EditFormSheet';
import { AnimatedWaveform } from '../components/AnimatedWaveform';
import {
  ComplianceRule,
  ComplianceRules,
  loadComplianceRules,
} from '../services/complianceRules';
import {
  DayKind,
  DeductibilityResult,
  ParsedItinerary,
  TripType,
  Verdict,
  evaluateDeductibility,
  evaluateFromCounts,
} from '../services/deductibilityEngine';
import {
  exportTripReportPdf,
  saveTripDocument,
} from '../services/tripDocuments';
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
  type DayLogJson,
  type DayScheduleJson,
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
  // 'draft' for future-dated trips not yet finalized; otherwise the saved status.
  status: string;
  // Full source row, carried so the edit sheet can pre-fill every field
  // (expenses, raw dates, countries) that the lossy summary doesn't keep.
  raw: BusinessTripRow;
}

// Data carried from the AI Analyzer into the Log Trip form when the user taps
// "Log This Trip". Everything here is what the analyzer already determined; the
// user still completes dates, purpose, and expense amounts before saving.
interface TripPrefill {
  trip_type: TripType;
  destination: string;
  total_days: number;
  business_days: number;
  personal_days: number;
  business_day_pct: number;
  transport_deduct_pct: number;
  compliance_verdict: Verdict;
  compliance_notes: string;
  countries?: string[];
  day_by_day_log: DayLogJson | null;
}

const MONTH_SHORT_BT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Earliest selectable trip date — shared by both date pickers.
const MIN_TRIP_DATE = new Date('2020-01-01');

// Display format for every date in the Business Travel form: MM/DD/YYYY.
const formatDateMMDDYYYY = (date: Date): string => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  return month + '/' + day + '/' + year;
};

// Short "Nov 20" form used in the Total Days helper text.
const formatDateShort = (date: Date): string =>
  `${MONTH_SHORT_BT[date.getMonth()]} ${date.getDate()}`;

// Convert a picked Date back to an ISO calendar date (YYYY-MM-DD) for Supabase.
// Uses local date parts so the day never shifts across time zones.
const toISODate = (date: Date): string => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

// A new Date `n` days after `date` (local, no mutation of the original).
const addDaysDate = (date: Date, n: number): Date => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
};

// Two years after a date — the return picker's maximum, so trips can be
// pre-planned (and cross-year returns selected) well into the future.
const twoYearsAfter = (date: Date): Date => {
  const r = new Date(date);
  r.setFullYear(r.getFullYear() + 2);
  return r;
};

// Both departure and return days count, so the span is inclusive of both ends.
const calculateTotalDays = (departure: Date, returnDate: Date): number => {
  const diffTime = Math.abs(returnDate.getTime() - departure.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  return diffDays;
};

// Parse a stored ISO calendar date (YYYY-MM-DD) without time-zone drift.
const parseISODate = (iso: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

const formatDateRange = (start: string | null, end: string | null): string => {
  const fmt = (iso: string | null) => {
    if (!iso) return '';
    const d = parseISODate(iso);
    return d ? formatDateMMDDYYYY(d) : iso;
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
  status: row.status ?? 'logged',
  raw: row,
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
// Amber used for the draft button, draft badge, and future-trip info banner.
const DRAFT_AMBER = '#BA7517';
const DRAFT_BANNER_BG = '#FAEEDA';

// Business Travel is a Core/Pro feature — it auto-activates for those tiers on
// onboarding completion. Basic subscribers still see the Trips tab, but it
// renders a locked upgrade teaser instead of the tracker.
export const BusinessTravelScreen: React.FC = () => {
  const access = useStrategyAccess();
  const unlocked =
    access.isAdmin || access.tier === 'core' || access.tier === 'pro';
  if (!unlocked) {
    return <BusinessTravelLockedScreen />;
  }
  return <BusinessTravelScreenInner />;
};

const BusinessTravelScreenInner: React.FC = () => {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<TabKey>('analyzer');
  const [rules, setRules] = useState<ComplianceRules | null>(null);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [trips, setTrips] = useState<TripHistoryEntry[]>([]);
  // Pre-fill payload handed from the AI Analyzer to the Log Trip form.
  const [prefill, setPrefill] = useState<TripPrefill | null>(null);
  // The trip row currently open in the edit sheet (Trip History → tap a row).
  const [editingTrip, setEditingTrip] = useState<BusinessTripRow | null>(null);

  useEffect(() => {
    loadComplianceRules()
      .then(setRules)
      .catch((e: Error) => setRulesError(e.message));
  }, []);

  const { activeBusinessId } = useBusiness();
  const { year: taxYear, startIso, endIso } = useYear();

  const loadTrips = React.useCallback(async () => {
    try {
      let query = supabase
        .from('business_trips')
        .select('*')
        .gte('departure_date', startIso)
        .lte('departure_date', endIso)
        .order('departure_date', { ascending: false, nullsFirst: false });
      if (activeBusinessId) query = query.eq('business_id', activeBusinessId);
      const { data, error } = await query;
      if (error) throw error;
      setTrips(((data ?? []) as BusinessTripRow[]).map(tripRowToEntry));
    } catch (e) {
      Alert.alert('Could not load trips', e instanceof Error ? e.message : String(e));
    }
  }, [activeBusinessId, startIso, endIso]);

  useFocusEffect(
    React.useCallback(() => {
      loadTrips();
    }, [loadTrips]),
  );

  return (
    <View style={styles.root}>
      <Header subtitle="Business Travel · Compliance Engine" year={taxYear} />
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
            <AnalyzerTab
              rules={rules}
              insets={insets}
              onLogTrip={(p) => {
                setPrefill(p);
                setTab('log');
              }}
            />
          )}
          {tab === 'log' && (
            <LogTripTab
              rules={rules}
              insets={insets}
              prefill={prefill}
              onConsumePrefill={() => setPrefill(null)}
              onSaved={async () => {
                await loadTrips();
                setPrefill(null);
                setTab('history');
              }}
            />
          )}
          {tab === 'history' && (
            <HistoryTab
              trips={trips}
              insets={insets}
              rules={rules}
              onEdit={setEditingTrip}
            />
          )}
          {tab === 'rules' && <RulesTab rules={rules} insets={insets} />}

          <TripEditSheet
            trip={editingTrip}
            rules={rules}
            onClose={() => setEditingTrip(null)}
            onSaved={loadTrips}
          />
        </View>
      )}
    </View>
  );
};

// ───────────────────────────── Analyzer tab ─────────────────────────────

interface AnalyzerTabProps {
  rules: ComplianceRules;
  insets: { bottom: number };
  onLogTrip: (prefill: TripPrefill) => void;
}

const AnalyzerTab: React.FC<AnalyzerTabProps> = ({ rules, insets, onLogTrip }) => {
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
        <ResultBlock
          parsed={parsed}
          result={result}
          rules={rules}
          onLogTrip={onLogTrip}
        />
      ) : null}
    </ScrollView>
  );
};

interface ResultBlockProps {
  parsed: ParsedItinerary;
  result: DeductibilityResult;
  rules: ComplianceRules;
  onLogTrip: (prefill: TripPrefill) => void;
}

const ResultBlock: React.FC<ResultBlockProps> = ({ parsed, result, rules, onLogTrip }) => {
  const v = verdictTheme[result.verdict];
  const tripBadgeLabel =
    result.trip_type === 'domestic' ? 'Domestic' : 'International';

  const handleLogTrip = () => {
    onLogTrip({
      trip_type: result.trip_type,
      destination: parsed.destination,
      total_days: result.total_days,
      business_days: result.counted_business_days,
      personal_days: result.personal_days,
      business_day_pct: result.business_day_pct,
      transport_deduct_pct: result.breakdown.transportation_pct,
      compliance_verdict: result.verdict,
      compliance_notes: result.rationale,
      countries: parsed.countries,
      day_by_day_log: parsed.days.length
        ? parsed.days.map((d) => ({
            date: d.date,
            type: d.kind,
            description: d.label,
          }))
        : null,
    });
  };

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

      <TouchableOpacity
        activeOpacity={0.85}
        onPress={handleLogTrip}
        style={styles.logTripBtn}
      >
        <Ionicons name="add-circle" size={18} color={colors.white} />
        <Text style={styles.logTripBtnText}>Log This Trip</Text>
      </TouchableOpacity>
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
  prefill?: TripPrefill | null;
  onConsumePrefill?: () => void;
  onSaved: () => Promise<void> | void;
}

const LogTripTab: React.FC<LogTripTabProps> = ({
  rules,
  insets,
  prefill,
  onConsumePrefill,
  onSaved,
}) => {
  const { activeBusinessId } = useBusiness();
  const [tripType, setTripType] = useState<TripType>('domestic');
  const [destination, setDestination] = useState('');
  const [departureDate, setDepartureDate] = useState<Date | null>(null);
  const [returnDateValue, setReturnDateValue] = useState<Date | null>(null);
  // Which date picker is open. Only one at a time; both render full-width below
  // the two-column date row so the spinner is never clipped.
  const [showDeparturePicker, setShowDeparturePicker] = useState(false);
  const [showReturnPicker, setShowReturnPicker] = useState(false);
  const [businessDays, setBusinessDays] = useState('');
  const [totalDays, setTotalDays] = useState('');
  // True when Total Days was filled automatically (from the AI Analyzer or the
  // date pickers). When true the field is read-only and shows an "Auto" badge.
  const [totalDaysAuto, setTotalDaysAuto] = useState(false);
  const [purpose, setPurpose] = useState('');
  const [countries, setCountries] = useState('');
  const [intlReason, setIntlReason] = useState('');
  const [expTransport, setExpTransport] = useState('');
  const [expLodging, setExpLodging] = useState('');
  const [expMeals, setExpMeals] = useState('');
  const [expOther, setExpOther] = useState('');
  const [preview, setPreview] = useState<DeductibilityResult | null>(null);
  // True once the form has been pre-filled by the AI Analyzer. Drives the
  // teal "auto-filled" field borders and the amber prompt over the fields the
  // user still has to complete. The analyzer's day-by-day log is held here so
  // it can be saved with the trip.
  const [autoFilled, setAutoFilled] = useState(false);
  const [prefillDayLog, setPrefillDayLog] = useState<DayLogJson | null>(null);
  // Day-by-day classification for the manual grid (Fix 2). Length equals
  // total_days; index 0 = departure, last = return (both Travel). Middle days
  // toggle between Business and Personal. Empty until both dates are entered.
  const [dayKinds, setDayKinds] = useState<DayKind[]>([]);

  // Apply the analyzer payload once when it arrives, then clear it from the
  // parent so re-renders don't clobber subsequent manual edits.
  useEffect(() => {
    if (!prefill) return;
    setTripType(prefill.trip_type);
    setDestination(prefill.destination);
    setTotalDays(prefill.total_days ? String(prefill.total_days) : '');
    // The analyzer already determined total days, so present it as auto-filled.
    // If the user later picks both dates it recalculates automatically.
    setTotalDaysAuto(!!prefill.total_days);
    setBusinessDays(prefill.business_days ? String(prefill.business_days) : '');
    setCountries(prefill.countries?.join(', ') ?? '');
    setPrefillDayLog(prefill.day_by_day_log);
    setPreview(null);
    setAutoFilled(true);
    onConsumePrefill?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  // Auto-calculate Total Days whenever both dates are selected. The return
  // picker already prevents a return earlier than departure.
  useEffect(() => {
    if (departureDate && returnDateValue) {
      setTotalDays(String(calculateTotalDays(departureDate, returnDateValue)));
      setTotalDaysAuto(true);
    }
  }, [departureDate, returnDateValue]);

  const parseN = (s: string) => {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  };

  // Build the initial day classification: endpoints are Travel days; the first
  // `bizCount` middle days are Business, the remainder Personal.
  const buildDayKinds = React.useCallback(
    (dep: Date, ret: Date, bizCount: number): DayKind[] => {
      const total = calculateTotalDays(dep, ret);
      const kinds: DayKind[] = [];
      for (let i = 0; i < total; i += 1) {
        const isTravel = total >= 2 ? i === 0 || i === total - 1 : true;
        kinds.push(isTravel ? 'travel' : 'personal');
      }
      let assigned = 0;
      for (let i = 0; i < total && assigned < bizCount; i += 1) {
        if (kinds[i] !== 'travel') {
          kinds[i] = 'business';
          assigned += 1;
        }
      }
      return kinds;
    },
    [],
  );

  // Re-seed the grid whenever the trip's date span changes. Toggles and manual
  // Business-days edits reseed through their own handlers, so this effect keys
  // on the dates only and never clobbers a user's per-day toggles.
  useEffect(() => {
    if (departureDate && returnDateValue) {
      setDayKinds(buildDayKinds(departureDate, returnDateValue, parseN(businessDays)));
    } else {
      setDayKinds([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departureDate, returnDateValue, buildDayKinds]);

  // Editing the Business days field manually reseeds the grid from the new count.
  const onBusinessDaysChange = (v: string) => {
    setBusinessDays(v);
    if (departureDate && returnDateValue) {
      setDayKinds(buildDayKinds(departureDate, returnDateValue, parseFloat(v) || 0));
    }
  };

  // Tapping a middle day toggles it between Business and Personal and syncs the
  // business-day count back into the Business days field. The departure and
  // return days (the endpoints) are the only Travel days and can't be changed —
  // their position is what makes the first and last nights deductible.
  const toggleDay = (index: number) => {
    if (index === 0 || index === dayKinds.length - 1) return;
    const next = [...dayKinds];
    next[index] = next[index] === 'business' ? 'personal' : 'business';
    setDayKinds(next);
    setBusinessDays(String(next.filter((k) => k === 'business').length));
  };

  // Whether the day at `index` (counted from the departure date) falls on a
  // Saturday or Sunday.
  const isWeekendDay = React.useCallback(
    (index: number): boolean => {
      if (!departureDate) return false;
      const dow = addDaysDate(departureDate, index).getDay();
      return dow === 0 || dow === 6;
    },
    [departureDate],
  );

  // Fix 2: weekend days (Sat/Sun) that fall BETWEEN business days are deductible
  // personal days — the taxpayer must remain at the destination over the weekend
  // because business resumes afterward (the same IRS "sandwiched" rationale).
  // Flag each such day so the grid can label it distinctly and so the intervening
  // nights stay deductible even across a two-day weekend. The scan skips over
  // other sandwiched weekend days, so a Fri-business / Sat+Sun / Mon-business
  // trip flags BOTH weekend days.
  const sandwichedWeekends = useMemo(() => {
    const businessBefore = (i: number): boolean => {
      for (let j = i - 1; j >= 0; j -= 1) {
        const k = dayKinds[j];
        if (k === 'business') return true;
        if (k === 'travel') return false; // reached the departure endpoint
        if (k === 'personal' && !isWeekendDay(j)) return false; // a chosen personal day
        // a weekend personal day → skip and keep scanning outward
      }
      return false;
    };
    const businessAfter = (i: number): boolean => {
      for (let j = i + 1; j < dayKinds.length; j += 1) {
        const k = dayKinds[j];
        if (k === 'business') return true;
        if (k === 'travel') return false; // reached the return endpoint
        if (k === 'personal' && !isWeekendDay(j)) return false;
      }
      return false;
    };
    return dayKinds.map(
      (k, i) => k === 'personal' && isWeekendDay(i) && businessBefore(i) && businessAfter(i),
    );
  }, [dayKinds, isWeekendDay]);

  // Per-night lodging deductibility (Fix 2). A trip has (total_days − 1) nights;
  // night i sits between day i and day i+1. A night is deductible when ANY of:
  //   1. Standard rule — the following day (i+1) is a business or travel day
  //      (the return travel day counts here, so the last night is deductible).
  //   2. Sandwiched personal day — day i+1 is personal BUT day i+2 is a business
  //      day. The taxpayer must remain at the destination because business
  //      resumes, so the night stays deductible. (A personal day at the *end*,
  //      before the return travel day, does NOT qualify — day i+2 is travel.)
  //   3. Sandwiched weekend — day i+1 is a weekend day flagged as sitting between
  //      business days (see sandwichedWeekends). This extends rule 2 across a
  //      full Sat+Sun weekend, since business resumes after the weekend.
  const nights = useMemo(
    () =>
      dayKinds.slice(0, -1).map((_, i) => {
        const nextKind = dayKinds[i + 1];
        const dayAfter = i + 2 < dayKinds.length ? dayKinds[i + 2] : null;
        const standard = nextKind === 'business' || nextKind === 'travel';
        const weekend = nextKind === 'personal' && sandwichedWeekends[i + 1];
        const sandwiched = nextKind === 'personal' && (dayAfter === 'business' || weekend);
        return { deductible: standard || sandwiched, sandwiched, weekend };
      }),
    [dayKinds, sandwichedWeekends],
  );
  const deductibleNights = useMemo(
    () => nights.filter((n) => n.deductible).length,
    [nights],
  );
  const totalNights = nights.length;

  // "Nov 20→21" (same month) or "Nov 30→Dec 1" (spanning months) label for a
  // night, derived from the departure date.
  const nightLabel = (i: number): string => {
    if (!departureDate) return `Night ${i + 1}`;
    const from = addDaysDate(departureDate, i);
    const to = addDaysDate(departureDate, i + 1);
    const fromStr = `${MONTH_SHORT_BT[from.getMonth()]} ${from.getDate()}`;
    const toStr =
      from.getMonth() === to.getMonth()
        ? String(to.getDate())
        : `${MONTH_SHORT_BT[to.getMonth()]} ${to.getDate()}`;
    return `${fromStr}→${toStr}`;
  };

  const dayCounts = useMemo(() => {
    let business = 0;
    let personal = 0;
    let travel = 0;
    for (const k of dayKinds) {
      if (k === 'business') business += 1;
      else if (k === 'personal') personal += 1;
      else travel += 1;
    }
    return { business, personal, travel };
  }, [dayKinds]);

  // The date shown on each day cell ("Mon Nov 20"), derived from the departure.
  const dayDateLabel = (index: number): string => {
    if (!departureDate) return '';
    const d = new Date(departureDate);
    d.setDate(d.getDate() + index);
    return `${WEEKDAY_SHORT[d.getDay()]} ${MONTH_SHORT_BT[d.getMonth()]} ${d.getDate()}`;
  };

  // Live deductibility for the breakdown table — recomputed from the current
  // counts against the compliance_rules snapshot (no hard-coded thresholds).
  const liveResult = useMemo<DeductibilityResult | null>(() => {
    const total = parseN(totalDays);
    if (total <= 0) return null;
    return evaluateFromCounts({
      trip_type: tripType,
      destination: destination || 'Trip',
      purpose,
      total_days: total,
      business_days: parseN(businessDays),
      countries: countries
        ? countries.split(',').map((c) => c.trim()).filter(Boolean)
        : undefined,
      rules,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripType, totalDays, businessDays, destination, purpose, countries, rules]);

  const showDayDetail = Boolean(departureDate && returnDateValue && parseN(totalDays) > 0);

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

  const onSubmit = async () => {
    const total = parseN(totalDays);
    const biz = parseN(businessDays);
    if (!destination || total <= 0) {
      Alert.alert('Destination and total days are required.');
      return;
    }
    const countriesList = countries
      ? countries.split(',').map((c) => c.trim()).filter(Boolean)
      : undefined;
    const result = evaluateFromCounts({
      trip_type: tripType,
      destination,
      purpose,
      total_days: total,
      business_days: biz,
      countries: countriesList,
      rules,
    });

    // Prefer the manual day-by-day grid (built from the entered dates); fall
    // back to the AI Analyzer's day log when the grid isn't populated.
    const dayLog: DayLogJson | null =
      showDayDetail && dayKinds.length > 0
        ? dayKinds.map((kind, i) => ({
            date: departureDate ? toISODate(addDaysDate(departureDate, i)) : '',
            type: kind,
            description: dayDateLabel(i),
          }))
        : prefillDayLog;

    // Structured day-by-day schedule + derived lodging night counts (Fix 2),
    // saved alongside the lossy summary so a trip can be re-opened with its
    // exact per-day designations and lodging math intact.
    const daySchedule: DayScheduleJson | null =
      showDayDetail && dayKinds.length > 0 && departureDate
        ? {
            days: dayKinds.map((kind, i) => ({
              date: toISODate(addDaysDate(departureDate, i)),
              type: kind,
            })),
            deductible_nights: deductibleNights,
            total_nights: totalNights,
          }
        : null;

    try {
      const userId = await requireUserId();
      const { error } = await supabase.from('business_trips').insert({
        user_id: userId,
        business_id: activeBusinessId,
        trip_type: tripType,
        destination,
        countries_visited: countriesList ?? null,
        purpose,
        departure_date: departureDate ? toISODate(departureDate) : null,
        return_date: returnDateValue ? toISODate(returnDateValue) : null,
        total_days: total,
        business_days: result.business_days,
        personal_days: result.personal_days,
        business_day_pct: result.business_day_pct,
        transport_deduct_pct: result.breakdown.transportation_pct,
        day_by_day_log: dayLog,
        day_schedule: daySchedule,
        itinerary_transcript: null,
        compliance_verdict: result.verdict,
        compliance_notes: result.rationale,
        expenses_transport: parseN(expTransport) || null,
        expenses_lodging: parseN(expLodging) || null,
        expenses_meals: parseN(expMeals) || null,
        expenses_other: parseN(expOther) || null,
        // Future-dated trips are saved as drafts; everything else keeps the
        // existing 'logged' status.
        status: isFutureTrip ? 'draft' : 'logged',
      });
      if (error) throw new Error(error.message);

      // Auto-generate the trip compliance document into the Documents vault.
      // Best-effort: a document failure must not lose the saved trip.
      try {
        await saveTripDocument(
          {
            businessId: activeBusinessId,
            trip_type: tripType,
            destination,
            departure_date: departureDate ? toISODate(departureDate) : null,
            return_date: returnDateValue ? toISODate(returnDateValue) : null,
            total_days: total,
            business_days: result.business_days,
            personal_days: result.personal_days,
            purpose,
            countries: countriesList,
            expenses: {
              transport: parseN(expTransport),
              lodging: parseN(expLodging),
              meals: parseN(expMeals),
              other: parseN(expOther),
            },
          },
          rules,
        );
      } catch (docErr) {
        console.warn('[travel] trip document generation failed', docErr);
      }

      if (isFutureTrip) {
        Alert.alert(
          'Saved as draft',
          'Trip saved as draft. You can edit and finalize it once the trip is complete.',
        );
      }
      await onSaved();
    } catch (e) {
      Alert.alert('Could not save trip', e instanceof Error ? e.message : String(e));
    }
  };

  const today = useMemo(() => new Date(), []);
  // Departures can be pre-planned up to two years out so future trips can be
  // saved as drafts. (Was previously capped at today.)
  const maxDepartureDate = useMemo(() => twoYearsAfter(today), [today]);
  // Returns can be pre-planned up to two years out — this also unblocks
  // cross-year trips (December departure, January return next year).
  const maxReturnDate = useMemo(() => twoYearsAfter(today), [today]);
  // A trip whose departure is after today is saved as a draft to be finalized
  // once travel is complete. Compared on calendar day only.
  const isFutureTrip = useMemo(() => {
    if (!departureDate) return false;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const departure = new Date(departureDate);
    departure.setHours(0, 0, 0, 0);
    return departure > start;
  }, [departureDate]);
  // "5 day trip — Nov 20 to Nov 24", shown once both dates are picked.
  const totalDaysHelper =
    departureDate && returnDateValue
      ? `${calculateTotalDays(departureDate, returnDateValue)} day trip — ` +
        `${formatDateShort(departureDate)} to ${formatDateShort(returnDateValue)}`
      : undefined;
  // Visual confirmation that a year boundary crossing is intentional.
  const crossesYear =
    departureDate != null &&
    returnDateValue != null &&
    returnDateValue.getFullYear() !== departureDate.getFullYear();

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
        {autoFilled ? (
          <View style={styles.prefillNote}>
            <Ionicons name="information-circle" size={16} color={colors.amber} />
            <Text style={styles.prefillNoteText}>
              Please complete the remaining fields below to save your trip. Fields
              marked with a checkmark were auto-filled by the AI; the amber fields
              still need your input.
            </Text>
          </View>
        ) : null}

        <View style={styles.fieldLabelRow}>
          <Text style={styles.sectionLabel}>Trip type</Text>
          {autoFilled ? (
            <View style={styles.autofillTag}>
              <Ionicons name="checkmark-circle" size={12} color={colors.teal} />
              <Text style={styles.autofillTagText}>AI</Text>
            </View>
          ) : null}
        </View>
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
              autofilled={autoFilled && countries.trim().length > 0}
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
          autofilled={autoFilled && destination.trim().length > 0}
        />
        <View style={styles.fieldRow}>
          <DateInputField
            label="Departure date"
            value={departureDate}
            onChange={setDepartureDate}
            minimumDate={MIN_TRIP_DATE}
            maximumDate={maxDepartureDate}
            style={styles.flexHalf}
            pickerVisible={showDeparturePicker}
            onPickerVisibleChange={(v) => {
              setShowDeparturePicker(v);
              if (v) setShowReturnPicker(false);
            }}
          />
          <View style={styles.fieldGap} />
          <DateInputField
            label="Return date"
            value={returnDateValue}
            onChange={setReturnDateValue}
            minimumDate={departureDate ?? MIN_TRIP_DATE}
            maximumDate={maxReturnDate}
            style={styles.flexHalf}
            pickerVisible={showReturnPicker}
            onPickerVisibleChange={(v) => {
              setShowReturnPicker(v);
              if (v) setShowDeparturePicker(false);
            }}
          />
        </View>
        {crossesYear ? (
          <Text style={styles.crossYearNote}>
            Trip crosses into {returnDateValue?.getFullYear()}
          </Text>
        ) : null}

        {isFutureTrip ? (
          <View style={styles.futureTripBanner}>
            <Ionicons name="information-circle" size={16} color={DRAFT_AMBER} />
            <Text style={styles.futureTripBannerText}>
              Future trips are saved as drafts and can be finalized after travel
              is complete.
            </Text>
          </View>
        ) : null}

        {/* Bottom-sheet pickers with OK / Cancel — scrolling a column only
            updates an internal temp date, so the user can set month, day, and
            year before confirming. */}
        <DatePickerModal
          visible={showDeparturePicker}
          title="Departure Date"
          value={departureDate}
          minimumDate={MIN_TRIP_DATE}
          maximumDate={maxDepartureDate}
          onConfirm={(d) => {
            setDepartureDate(d);
            setShowDeparturePicker(false);
          }}
          onCancel={() => setShowDeparturePicker(false)}
        />
        <DatePickerModal
          visible={showReturnPicker}
          title="Return Date"
          value={returnDateValue}
          fallback={departureDate ?? undefined}
          minimumDate={departureDate ?? MIN_TRIP_DATE}
          maximumDate={maxReturnDate}
          onConfirm={(d) => {
            setReturnDateValue(d);
            setShowReturnPicker(false);
          }}
          onCancel={() => setShowReturnPicker(false)}
        />
        <View style={styles.fieldRow}>
          <LabeledInput
            label="Business days"
            placeholder="0"
            keyboardType="numeric"
            value={businessDays}
            onChangeText={onBusinessDaysChange}
            style={styles.flexHalf}
            autofilled={autoFilled}
          />
          <View style={styles.fieldGap} />
          <LabeledInput
            label="Total days"
            placeholder="0"
            keyboardType="numeric"
            value={totalDays}
            onChangeText={setTotalDays}
            style={styles.flexHalf}
            editable={!totalDaysAuto}
            autoBadge={totalDaysAuto}
            helperText={totalDaysHelper}
          />
        </View>
        <LabeledInput
          label="Business purpose"
          placeholder="What was the trip for?"
          value={purpose}
          onChangeText={setPurpose}
          multiline
          highlight={autoFilled}
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
            highlight={autoFilled}
          />
          <View style={styles.fieldGap} />
          <LabeledInput
            label="Lodging"
            placeholder="0.00"
            keyboardType="decimal-pad"
            value={expLodging}
            onChangeText={setExpLodging}
            style={styles.flexHalf}
            highlight={autoFilled}
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
            highlight={autoFilled}
          />
          <View style={styles.fieldGap} />
          <LabeledInput
            label="Other"
            placeholder="0.00"
            keyboardType="decimal-pad"
            value={expOther}
            onChangeText={setExpOther}
            style={styles.flexHalf}
            highlight={autoFilled}
          />
        </View>

        {showDayDetail ? (
          <>
            <View style={styles.detailDivider} />
            <SectionHeader title="Day-by-day analysis" />
            <Text style={styles.detailHint}>
              Tap a day to toggle it between Business (blue) and Personal (red).
              The departure and return days are always Travel (green) and can't
              be changed. Where a personal day falls changes which nights of
              lodging are deductible.
            </Text>
            <View style={styles.dayGrid}>
              {dayKinds.map((kind, i) => {
                // A weekend day sandwiched between business days gets a distinct
                // amber "Weekend" treatment so the user sees why it's deductible.
                const isWeekendSandwich = kind === 'personal' && sandwichedWeekends[i];
                const th = isWeekendSandwich
                  ? { bg: colors.amberLight, fg: colors.amber, icon: 'calendar' as const }
                  : dayTheme[kind];
                // Only the departure/return endpoints are locked as travel days;
                // every middle day is tappable and toggles business ↔ personal.
                const isEndpoint = i === 0 || i === dayKinds.length - 1;
                return (
                  <TouchableOpacity
                    key={`${i}-${kind}`}
                    activeOpacity={isEndpoint ? 1 : 0.7}
                    onPress={() => toggleDay(i)}
                    disabled={isEndpoint}
                    style={[styles.logDayCell, { backgroundColor: th.bg }]}
                  >
                    <Text
                      style={[styles.logDayDate, { color: th.fg }]}
                      numberOfLines={1}
                    >
                      {dayDateLabel(i)}
                    </Text>
                    <View style={styles.logDayKindRow}>
                      <Ionicons name={th.icon} size={11} color={th.fg} />
                      <Text style={[styles.logDayKind, { color: th.fg }]}>
                        {kind === 'travel'
                          ? 'Travel'
                          : kind === 'business'
                            ? 'Business'
                            : isWeekendSandwich
                              ? 'Weekend'
                              : 'Personal'}
                      </Text>
                    </View>
                    {isWeekendSandwich ? (
                      <Text style={[styles.logDaySub, { color: th.fg }]} numberOfLines={1}>
                        Surrounded by business
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.dayCountLine}>
              {dayCounts.business} business days / {dayCounts.personal} personal
              days / {dayCounts.travel} travel days
            </Text>

            {totalNights > 0 ? (
              <View
                style={[
                  styles.lodgingBox,
                  deductibleNights < totalNights && styles.lodgingBoxAmber,
                ]}
              >
                <Text style={styles.lodgingTitle}>Lodging deductibility</Text>
                <Text style={styles.lodgingSummary}>
                  {deductibleNights} of {totalNights} night
                  {totalNights === 1 ? '' : 's'} deductible
                </Text>
                <View style={styles.lodgingList}>
                  {nights.map((n, i) => (
                    <View key={`night-${i}`} style={styles.lodgingRow}>
                      <Ionicons
                        name={n.deductible ? 'checkmark-circle' : 'close-circle'}
                        size={14}
                        color={n.deductible ? colors.teal : NOT_DEDUCT_RED}
                      />
                      <Text style={styles.lodgingRowText}>
                        Night {i + 1} ({nightLabel(i)}):{' '}
                        {n.deductible ? 'Deductible' : 'Not deductible'}
                        {n.sandwiched
                          ? n.weekend
                            ? ' (weekend between business days)'
                            : ' (personal day surrounded by business)'
                          : ''}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </>
        ) : null}

        {showDayDetail && liveResult ? (
          <>
            <View style={styles.detailDivider} />
            <SectionHeader title="Deductibility breakdown" />
            <TripBreakdownTable
              result={liveResult}
              rules={rules}
              tripType={tripType}
              deductibleNights={totalNights > 0 ? deductibleNights : null}
              totalNights={totalNights > 0 ? totalNights : null}
            />
          </>
        ) : null}

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
            style={[styles.btn, isFutureTrip ? styles.btnDraft : styles.btnPrimary]}
          >
            <Ionicons name="save-outline" size={16} color={colors.white} />
            <Text style={styles.btnPrimaryText}>
              {isFutureTrip ? 'Save as Draft' : 'Save trip'}
            </Text>
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
  // Teal border + checkmark: filled by the AI Analyzer.
  autofilled?: boolean;
  // Amber border: a field the user still needs to complete.
  highlight?: boolean;
  // When false the field is read-only and shown on a light gray background.
  editable?: boolean;
  // Teal "Auto" badge next to the label — value was calculated automatically.
  autoBadge?: boolean;
  // Caption rendered below the field (e.g. the "5 day trip" summary).
  helperText?: string;
}> = ({
  label,
  placeholder,
  value,
  onChangeText,
  keyboardType,
  multiline,
  style,
  autofilled,
  highlight,
  editable = true,
  autoBadge,
  helperText,
}) => (
  <View style={[styles.field, style]}>
    <View style={styles.fieldLabelRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {autofilled ? (
        <View style={styles.autofillTag}>
          <Ionicons name="checkmark-circle" size={12} color={colors.teal} />
          <Text style={styles.autofillTagText}>AI</Text>
        </View>
      ) : null}
      {autoBadge ? (
        <View style={styles.autoBadge}>
          <Text style={styles.autoBadgeText}>Auto</Text>
        </View>
      ) : null}
    </View>
    <TextInput
      style={[
        styles.fieldInput,
        multiline && styles.fieldInputMulti,
        autofilled && styles.fieldInputAuto,
        highlight && styles.fieldInputManual,
        editable === false && styles.fieldInputReadOnly,
      ]}
      placeholder={placeholder}
      placeholderTextColor={colors.subtleText}
      value={value}
      onChangeText={onChangeText}
      keyboardType={keyboardType ?? 'default'}
      multiline={multiline}
      editable={editable}
    />
    {helperText ? <Text style={styles.fieldHelper}>{helperText}</Text> : null}
  </View>
);

// Deductibility breakdown table for the Log Trip form (Fix 2). Applies the same
// IRS rules the AI Analyzer uses; every threshold comes from the live
// compliance_rules snapshot.
const TripBreakdownTable: React.FC<{
  result: DeductibilityResult;
  rules: ComplianceRules;
  tripType: TripType;
  // Actual night counts from the day-by-day grid (Fix 2). When present, the
  // lodging row reflects the real per-night IRS rule rather than a simple
  // business-days count.
  deductibleNights?: number | null;
  totalNights?: number | null;
}> = ({ result, rules, tripType, deductibleNights, totalNights }) => {
  const transportPct = result.breakdown.transportation_pct;
  const mealsPct = Math.round(rules.mealsDeductionPct * 100);

  const summaryLine = (() => {
    if (tripType === 'domestic') {
      return result.verdict === 'not_deductible'
        ? 'Primary purpose: Personal — transportation NOT deductible'
        : 'Primary purpose: Business — transportation 100% deductible';
    }
    if (transportPct === 100) return 'Transportation 100% deductible';
    if (transportPct === 0)
      return 'Primary purpose: Personal — transportation NOT deductible';
    return `Transportation ${transportPct}% deductible (${result.business_day_pct}% business)`;
  })();

  const transportColor =
    transportPct === 100 ? colors.teal : transportPct === 0 ? NOT_DEDUCT_RED : colors.amber;

  return (
    <View>
      <Text style={styles.breakdownSummary}>{summaryLine}</Text>
      <View style={styles.btTable}>
        <View style={[styles.btRow, styles.btHeadRow]}>
          <Text style={[styles.btCell, styles.btColExpense, styles.btHeadText]}>Expense</Text>
          <Text style={[styles.btCell, styles.btColRule, styles.btHeadText]}>Rule Applied</Text>
          <Text style={[styles.btCell, styles.btColValue, styles.btHeadText]}>Deductible</Text>
        </View>
        <View style={styles.btRow}>
          <Text style={[styles.btCell, styles.btColExpense]}>Transport</Text>
          <Text style={[styles.btCell, styles.btColRule]}>{result.rule_applied}</Text>
          <Text style={[styles.btCell, styles.btColValue, { color: transportColor }]}>
            {transportPct}%
          </Text>
        </View>
        <View style={styles.btRow}>
          <Text style={[styles.btCell, styles.btColExpense]}>Lodging</Text>
          <Text style={[styles.btCell, styles.btColRule]}>
            {typeof totalNights === 'number'
              ? 'Nights before a business/travel day'
              : 'Business days only'}
          </Text>
          <Text style={[styles.btCell, styles.btColValue, { color: colors.teal }]}>
            {typeof deductibleNights === 'number' && typeof totalNights === 'number'
              ? `${deductibleNights} of ${totalNights} nights`
              : `${result.counted_business_days} of ${result.total_days} nights`}
          </Text>
        </View>
        <View style={[styles.btRow, styles.btLastRow]}>
          <Text style={[styles.btCell, styles.btColExpense]}>Meals</Text>
          <Text style={[styles.btCell, styles.btColRule]}>50% on business days</Text>
          <Text style={[styles.btCell, styles.btColValue, { color: colors.amber }]}>
            {mealsPct}%
          </Text>
        </View>
      </View>
    </View>
  );
};

// ───────────────────────────── History tab ──────────────────────────────

const HistoryTab: React.FC<{
  trips: TripHistoryEntry[];
  insets: { bottom: number };
  rules: ComplianceRules;
  onEdit: (row: BusinessTripRow) => void;
}> = ({ trips, insets, rules, onEdit }) => {
  const [exportingId, setExportingId] = useState<string | null>(null);

  const onExport = async (trip: TripHistoryEntry) => {
    if (exportingId) return;
    setExportingId(trip.id);
    try {
      await exportTripReportPdf(trip.raw, rules);
    } catch (e) {
      Alert.alert('Could not export trip report', e instanceof Error ? e.message : String(e));
    } finally {
      setExportingId(null);
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
    >
      <YearSelector style={{ paddingHorizontal: 0, paddingTop: 0 }} />
      {trips.length === 0 ? (
        <Card padded>
          <Text style={styles.emptyText}>
            No trips logged yet. Use Log Trip to add one.
          </Text>
        </Card>
      ) : (
        trips.map((t) => (
          <TripRow
            key={t.id}
            trip={t}
            onPress={() => onEdit(t.raw)}
            onExport={() => onExport(t)}
            exporting={exportingId === t.id}
          />
        ))
      )}
    </ScrollView>
  );
};

const TripRow: React.FC<{
  trip: TripHistoryEntry;
  onPress: () => void;
  onExport: () => void;
  exporting: boolean;
}> = ({ trip, onPress, onExport, exporting }) => {
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
  const isDraft = trip.status === 'draft';

  return (
    <View style={styles.tripRowWrap}>
      <EditableListRow
        onPress={onPress}
        style={styles.tripRow}
        contentStyle={styles.tripRowContent}
      >
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
            {isDraft ? (
              <View style={[styles.pillCustom, styles.draftPill]}>
                <Text style={[styles.pillCustomText, styles.draftPillText]}>
                  Draft
                </Text>
              </View>
            ) : pillBg ? (
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
      </EditableListRow>
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={onExport}
        disabled={exporting}
        style={styles.exportTripBtn}
      >
        {exporting ? (
          <ActivityIndicator size="small" color={colors.midNavy} />
        ) : (
          <Ionicons name="download-outline" size={15} color={colors.midNavy} />
        )}
        <Text style={styles.exportTripBtnText}>Export Trip Report</Text>
      </TouchableOpacity>
    </View>
  );
};

// ───────────────────────── Trip edit sheet (Fix 3) ──────────────────────────

type TripStatus = 'documented' | 'receipts_needed' | 'planned';

const TRIP_STATUS_OPTIONS: Array<{ key: TripStatus; label: string }> = [
  { key: 'documented', label: 'Documented' },
  { key: 'receipts_needed', label: 'Receipts Needed' },
  { key: 'planned', label: 'Planned' },
];

// Map any stored status onto the three editable buckets. Legacy 'logged' rows
// and anything unrecognized read as Documented.
const normalizeTripStatus = (s: string | null): TripStatus =>
  s === 'receipts_needed' ? 'receipts_needed' : s === 'planned' ? 'planned' : 'documented';

// Calendar-day comparison: is this date strictly after today?
const isFutureDate = (d: Date): boolean => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  return day > start;
};

interface TripEditSheetProps {
  trip: BusinessTripRow | null;
  rules: ComplianceRules;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

const TripEditSheet: React.FC<TripEditSheetProps> = ({
  trip,
  rules,
  onClose,
  onSaved,
}) => {
  const [tripType, setTripType] = useState<TripType>('domestic');
  const [destination, setDestination] = useState('');
  const [departureDate, setDepartureDate] = useState<Date | null>(null);
  const [returnDateValue, setReturnDateValue] = useState<Date | null>(null);
  const [showDeparturePicker, setShowDeparturePicker] = useState(false);
  const [showReturnPicker, setShowReturnPicker] = useState(false);
  const [businessDays, setBusinessDays] = useState('');
  const [totalDays, setTotalDays] = useState('');
  const [purpose, setPurpose] = useState('');
  const [expTransport, setExpTransport] = useState('');
  const [expLodging, setExpLodging] = useState('');
  const [expMeals, setExpMeals] = useState('');
  const [expOther, setExpOther] = useState('');
  const [status, setStatus] = useState<TripStatus>('documented');
  const [saving, setSaving] = useState(false);

  const isDraft = trip?.status === 'draft';

  const numToStr = (n: number | null): string =>
    n != null && Number.isFinite(n) ? String(n) : '';

  // Pre-fill every field from the source row whenever a trip opens.
  useEffect(() => {
    if (!trip) return;
    setTripType((trip.trip_type ?? 'domestic') as TripType);
    setDestination(trip.destination ?? '');
    setDepartureDate(parseISODate(trip.departure_date ?? ''));
    setReturnDateValue(parseISODate(trip.return_date ?? ''));
    setBusinessDays(numToStr(trip.business_days));
    setTotalDays(numToStr(trip.total_days));
    setPurpose(trip.purpose ?? '');
    setExpTransport(numToStr(trip.expenses_transport));
    setExpLodging(numToStr(trip.expenses_lodging));
    setExpMeals(numToStr(trip.expenses_meals));
    setExpOther(numToStr(trip.expenses_other));
    setStatus(normalizeTripStatus(trip.status));
  }, [trip]);

  // Recompute total days whenever both dates are set.
  useEffect(() => {
    if (departureDate && returnDateValue) {
      setTotalDays(String(calculateTotalDays(departureDate, returnDateValue)));
    }
  }, [departureDate, returnDateValue]);

  const parseN = (s: string) => {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  };

  const totalNum = parseN(totalDays);
  const businessNum = parseN(businessDays);
  const personalDays = Math.max(0, totalNum - businessNum);
  const today = useMemo(() => new Date(), []);

  const persist = async (targetStatus: string) => {
    if (!trip) return;
    if (!destination.trim() || totalNum <= 0) {
      Alert.alert('Destination and total days are required.');
      return;
    }
    setSaving(true);
    try {
      const userId = await requireUserId();
      const result = evaluateFromCounts({
        trip_type: tripType,
        destination: destination.trim(),
        purpose,
        total_days: totalNum,
        business_days: businessNum,
        countries: trip.countries_visited ?? undefined,
        rules,
      });
      const { error } = await supabase
        .from('business_trips')
        .update({
          trip_type: tripType,
          destination: destination.trim(),
          purpose,
          departure_date: departureDate ? toISODate(departureDate) : null,
          return_date: returnDateValue ? toISODate(returnDateValue) : null,
          total_days: totalNum,
          business_days: result.business_days,
          personal_days: result.personal_days,
          business_day_pct: result.business_day_pct,
          transport_deduct_pct: result.breakdown.transportation_pct,
          compliance_verdict: result.verdict,
          compliance_notes: result.rationale,
          expenses_transport: parseN(expTransport) || null,
          expenses_lodging: parseN(expLodging) || null,
          expenses_meals: parseN(expMeals) || null,
          expenses_other: parseN(expOther) || null,
          status: targetStatus,
        })
        .eq('id', trip.id)
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
      await onSaved();
      onClose();
    } catch (e) {
      Alert.alert('Could not save trip', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!trip) return;
    setSaving(true);
    try {
      const userId = await requireUserId();
      const { error } = await supabase
        .from('business_trips')
        .delete()
        .eq('id', trip.id)
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
      await onSaved();
      onClose();
    } catch (e) {
      Alert.alert('Could not delete trip', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  // Finalize is allowed once travel has started (departure today or earlier).
  const canFinalize = !departureDate || !isFutureDate(departureDate);

  const finalizeAction = isDraft ? (
    <View>
      <TouchableOpacity
        activeOpacity={0.85}
        disabled={!canFinalize || saving}
        onPress={() => persist('documented')}
        style={[
          tripEditStyles.finalizeBtn,
          (!canFinalize || saving) && tripEditStyles.finalizeBtnDisabled,
        ]}
      >
        <Ionicons name="checkmark-done" size={18} color={colors.white} />
        <Text style={tripEditStyles.finalizeBtnText}>Finalize Trip</Text>
      </TouchableOpacity>
      {!canFinalize && departureDate ? (
        <Text style={tripEditStyles.finalizeHint}>
          Available after {formatDateMMDDYYYY(departureDate)}
        </Text>
      ) : null}
    </View>
  ) : null;

  return (
    <EditFormSheet
      title={isDraft ? 'Edit Draft Trip' : 'Edit Trip'}
      visible={!!trip}
      onClose={onClose}
      onSave={() => persist(isDraft ? 'draft' : status)}
      onDelete={handleDelete}
      saving={saving}
      saveLabel={isDraft ? 'Save Draft' : 'Save Changes'}
      deleteLabel="Delete Trip"
      deleteConfirmTitle="Delete this trip?"
      deleteConfirmMessage="Delete this trip? This cannot be undone."
      extraActions={finalizeAction}
    >
      {isDraft ? (
        <View style={tripEditStyles.draftBanner}>
          <Ionicons name="information-circle" size={16} color={DRAFT_AMBER} />
          <Text style={tripEditStyles.draftBannerText}>
            This trip is saved as a draft. Update the details and tap Finalize
            Trip to mark it as complete.
          </Text>
        </View>
      ) : null}

      <View>
        <Text style={styles.fieldLabel}>Trip type</Text>
        <View style={styles.segmentRow}>
          {(['domestic', 'international'] as const).map((kind) => {
            const active = tripType === kind;
            return (
              <TouchableOpacity
                key={kind}
                activeOpacity={0.85}
                onPress={() => setTripType(kind)}
                style={[styles.segmentBtn, active && styles.segmentBtnActive]}
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
      </View>

      <LabeledInput
        label="Destination"
        placeholder="e.g. Phoenix, AZ"
        value={destination}
        onChangeText={setDestination}
      />

      <View style={styles.fieldRow}>
        <TripDateField
          label="Departure date"
          value={departureDate}
          onPress={() => {
            setShowDeparturePicker(true);
            setShowReturnPicker(false);
          }}
          style={styles.flexHalf}
        />
        <View style={styles.fieldGap} />
        <TripDateField
          label="Return date"
          value={returnDateValue}
          onPress={() => {
            setShowReturnPicker(true);
            setShowDeparturePicker(false);
          }}
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
          value={totalDays}
          onChangeText={setTotalDays}
          style={styles.flexHalf}
          editable={!(departureDate && returnDateValue)}
          autoBadge={!!(departureDate && returnDateValue)}
        />
      </View>

      <LabeledInput
        label="Personal days"
        value={String(personalDays)}
        onChangeText={() => undefined}
        editable={false}
        helperText="Total days minus business days"
      />

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

      {!isDraft ? (
        <View>
          <Text style={styles.fieldLabel}>Status</Text>
          <View style={tripEditStyles.statusWrap}>
            {TRIP_STATUS_OPTIONS.map((opt) => {
              const active = status === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  activeOpacity={0.8}
                  onPress={() => setStatus(opt.key)}
                  style={[
                    tripEditStyles.statusChip,
                    active && tripEditStyles.statusChipActive,
                  ]}
                >
                  <Text
                    style={[
                      tripEditStyles.statusChipText,
                      active && tripEditStyles.statusChipTextActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}

      <DatePickerModal
        visible={showDeparturePicker}
        title="Departure Date"
        value={departureDate}
        minimumDate={MIN_TRIP_DATE}
        maximumDate={twoYearsAfter(today)}
        onConfirm={(d) => {
          setDepartureDate(d);
          setShowDeparturePicker(false);
        }}
        onCancel={() => setShowDeparturePicker(false)}
      />
      <DatePickerModal
        visible={showReturnPicker}
        title="Return Date"
        value={returnDateValue}
        fallback={departureDate ?? undefined}
        minimumDate={departureDate ?? MIN_TRIP_DATE}
        maximumDate={twoYearsAfter(today)}
        onConfirm={(d) => {
          setReturnDateValue(d);
          setShowReturnPicker(false);
        }}
        onCancel={() => setShowReturnPicker(false)}
      />
    </EditFormSheet>
  );
};

// Read-only date field that opens a DatePickerModal — mirrors the Business
// Travel form's MM/DD/YYYY + OK-button date entry inside the edit sheet.
const TripDateField: React.FC<{
  label: string;
  value: Date | null;
  onPress: () => void;
  style?: any;
}> = ({ label, value, onPress, style }) => (
  <View style={[styles.field, style]}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={[styles.fieldInput, tripEditStyles.dateRow]}
    >
      <Text style={value ? tripEditStyles.dateText : tripEditStyles.datePlaceholder}>
        {value ? formatDateMMDDYYYY(value) : 'MM/DD/YYYY'}
      </Text>
      <Ionicons name="calendar-outline" size={18} color={colors.midNavy} />
    </TouchableOpacity>
  </View>
);

const tripEditStyles = StyleSheet.create({
  draftBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: DRAFT_BANNER_BG,
    borderRadius: radius.card,
    padding: spacing.md,
  },
  draftBannerText: {
    ...typography.body,
    color: DRAFT_AMBER,
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateText: {
    ...typography.body,
    color: colors.bodyText,
    fontSize: 14,
  },
  datePlaceholder: {
    ...typography.body,
    color: colors.subtleText,
    fontSize: 14,
  },
  statusWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statusChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
    backgroundColor: colors.white,
  },
  statusChipActive: {
    backgroundColor: colors.midNavy,
    borderColor: colors.midNavy,
  },
  statusChipText: {
    ...typography.caption,
    color: colors.bodyText,
    fontSize: 13,
    fontWeight: '600',
  },
  statusChipTextActive: {
    color: colors.white,
  },
  finalizeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    backgroundColor: colors.teal,
    borderRadius: radius.card,
    paddingVertical: 14,
  },
  finalizeBtnDisabled: {
    opacity: 0.45,
  },
  finalizeBtnText: {
    ...typography.bodyMedium,
    color: colors.white,
    fontWeight: '700',
    fontSize: 15,
  },
  finalizeHint: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
});

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
  // Amber variant shown when a future departure date makes this a draft save.
  btnDraft: {
    backgroundColor: DRAFT_AMBER,
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
  // ── Log Trip: day-by-day + breakdown (Fix 2) ──
  detailDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  detailHint: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: spacing.sm,
  },
  logDayCell: {
    width: `${100 / 4 - 1.5}%`,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 8,
    gap: 4,
  },
  logDayDate: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '700',
  },
  logDayKindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  logDayKind: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '600',
  },
  logDaySub: {
    ...typography.caption,
    fontSize: 8,
    fontWeight: '600',
  },
  dayCountLine: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 13,
    fontWeight: '700',
    marginTop: spacing.md,
  },
  lodgingBox: {
    marginTop: spacing.md,
    backgroundColor: colors.tealLight,
    borderRadius: radius.card,
    padding: spacing.md,
  },
  // Amber variant shown when at least one night is not deductible.
  lodgingBoxAmber: {
    backgroundColor: DRAFT_BANNER_BG,
  },
  lodgingTitle: {
    ...typography.bodyMedium,
    color: colors.navy,
    fontSize: 13,
    fontWeight: '700',
  },
  lodgingSummary: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
    marginBottom: spacing.sm,
  },
  lodgingList: {
    gap: 4,
  },
  lodgingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  lodgingRowText: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 12,
    flex: 1,
  },
  breakdownSummary: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  btTable: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    borderRadius: 8,
    overflow: 'hidden',
  },
  btRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  btHeadRow: {
    backgroundColor: colors.tealLight,
  },
  btLastRow: {
    borderBottomWidth: 0,
  },
  btCell: {
    ...typography.caption,
    fontSize: 11,
    color: colors.bodyText,
    paddingVertical: 9,
    paddingHorizontal: 8,
  },
  btHeadText: {
    fontWeight: '700',
    color: colors.navy,
  },
  btColExpense: { width: '26%' },
  btColRule: { flex: 1 },
  btColValue: {
    width: '26%',
    textAlign: 'right',
    fontWeight: '700',
  },
  // ── Trip History: export button (Fix 3) ──
  tripRowWrap: {},
  exportTripBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 6,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.midNavy,
    backgroundColor: colors.lightBlue,
  },
  exportTripBtnText: {
    ...typography.caption,
    color: colors.midNavy,
    fontSize: 12,
    fontWeight: '700',
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
  // Small helper under the date row confirming an intentional year crossing.
  crossYearNote: {
    color: '#888888',
    fontSize: 11,
    marginTop: -spacing.sm,
    marginBottom: spacing.sm,
  },
  // Shown only while a future departure date is selected — explains drafts.
  futureTripBanner: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: DRAFT_BANNER_BG,
    padding: spacing.md,
    borderRadius: radius.card,
    marginBottom: spacing.md,
  },
  futureTripBannerText: {
    ...typography.body,
    color: DRAFT_AMBER,
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
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
  fieldInputAuto: {
    borderColor: colors.teal,
    borderWidth: 1.5,
    backgroundColor: colors.tealLight,
  },
  fieldInputManual: {
    borderColor: colors.amber,
    borderWidth: 1.5,
  },
  fieldInputReadOnly: {
    backgroundColor: '#F2F4F6',
    borderColor: colors.cardBorder,
    borderWidth: 0.5,
  },
  autoBadge: {
    backgroundColor: colors.tealLight,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginBottom: 4,
  },
  autoBadgeText: {
    ...typography.micro,
    color: colors.teal,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  fieldHelper: {
    ...typography.caption,
    color: '#888888',
    fontSize: 11,
    marginTop: 4,
  },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  autofillTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.tealLight,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginBottom: 4,
  },
  autofillTagText: {
    ...typography.micro,
    color: colors.teal,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  prefillNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.amberLight,
    borderLeftWidth: 4,
    borderLeftColor: colors.amber,
    borderRadius: radius.card,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  prefillNoteText: {
    ...typography.body,
    color: colors.bodyText,
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  logTripBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingVertical: 14,
    ...shadow.raised,
  },
  logTripBtnText: {
    ...typography.bodyMedium,
    color: colors.white,
    fontWeight: '700',
    fontSize: 15,
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
  tripRowContent: {
    gap: spacing.md,
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
  // Amber "Draft" badge for future-dated trips awaiting finalization.
  draftPill: {
    backgroundColor: DRAFT_BANNER_BG,
  },
  draftPillText: {
    color: DRAFT_AMBER,
    fontWeight: '700',
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
