import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, radius, shadow, spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { Header } from '../components/Header';
import { YearSelector } from '../components/YearSelector';
import { useYear } from '../context/YearContext';
import { Card } from '../components/Card';
import { SectionHeader } from '../components/SectionHeader';
import { StatusPill } from '../components/StatusPill';
import { AnimatedWaveform } from '../components/AnimatedWaveform';
import {
  M4A_44100_OPTIONS,
  MissingProxyError,
  ProxyUnreachableError,
  ensureMicPermission,
  generateMinutesDocument,
  prepareAudioMode,
  releaseAudioMode,
  transcribe,
} from '../services/openai';
import { consume, peek } from '../services/voiceInbox';
import {
  supabase,
  requireUserId,
  type MeetingMinutesRow,
} from '../services/supabase';
import { useBusiness } from '../business/BusinessContext';
import { useKeepAwakeWhile } from '../hooks/useKeepAwakeWhile';
import { KeepAwakeIndicator } from '../components/KeepAwakeIndicator';
import { useStrategyAccess } from '../hooks/useStrategyAccess';
import { LockedScreen } from '../components/LockedScreen';

const TYPE_ON_MS_PER_CHAR = 30;

// Whole-file transcription only — no chunking. Splitting audio mid-recording
// drops the words that straddle a chunk boundary, which was the main cause of
// missed content. We record one continuous file and send it to Whisper once.

// Context prompt fed to Whisper. Priming it with the meeting domain sharply
// improves accuracy on business vocabulary and suppresses URL hallucinations.
const WHISPER_PROMPT =
  'This is a business meeting transcript for tax compliance documentation. ' +
  'The speaker is discussing business activities, strategies, attendees, and ' +
  'decisions made at the meeting.';

// Recordings shorter than this are almost always accidental taps and are the
// single biggest source of hallucinated URLs/phrases, so we never send them.
const MIN_RECORDING_MS = 2000;

// Whisper has a 25MB upload cap (≈20 min of m4a audio), so a single recording
// segment is hard-capped at 20 minutes. Longer meetings are captured as a
// sequence of segments that each transcribe separately and then combine into
// one running transcript.
const MAX_RECORDING_MS = 20 * 60 * 1000; // 1200s — auto-stops here
const WARNING_MS = 18 * 60 * 1000; // 1080s — 2-minute heads-up banner

// Timer colours by elapsed time (per design): all-good → warning → at-limit.
const TIMER_GOOD = '#0F6E56';
const TIMER_WARN = '#BA7517';
const TIMER_LIMIT = '#A32D2D';

// Subtle marker between transcribed segments in the combined transcript.
const SEGMENT_DIVIDER = '\n\n--- continued ---\n\n';

type MeetingType =
  | 'Augusta Rule business meeting'
  | 'S-Corp board meeting'
  | 'Family management company meeting'
  | 'Investment strategy review';

const MEETING_TYPES: MeetingType[] = [
  'Augusta Rule business meeting',
  'S-Corp board meeting',
  'Family management company meeting',
  'Investment strategy review',
];

const MEETING_TYPE_TO_STRATEGY: Record<MeetingType, string> = {
  'Augusta Rule business meeting': 'augusta_rule',
  'S-Corp board meeting': 's_corp',
  'Family management company meeting': 'family_management',
  'Investment strategy review': 's_corp',
};

const MEETING_TYPE_TO_DOC_PREFIX: Record<MeetingType, string> = {
  'Augusta Rule business meeting': 'Augusta Rule Meeting Minutes',
  'S-Corp board meeting': 'S-Corp Board Meeting Minutes',
  'Family management company meeting': 'Family Management Company Meeting Minutes',
  'Investment strategy review': 'Investment Strategy Review Meeting Minutes',
};

const buildMinutesDocName = (meetingType: MeetingType, dateIso: string): string => {
  const d = new Date(dateIso);
  const dateLabel = Number.isNaN(d.getTime())
    ? dateIso
    : `${MONTH_SHORT[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
  return `${MEETING_TYPE_TO_DOC_PREFIX[meetingType]} — ${dateLabel}`;
};

interface RecentMinute {
  id: string;
  type: string;
  date: string;
  rawDate: string;
  location: string;
  status: 'Complete' | 'Draft';
  document: string | null;
  transcript: string | null;
}

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const formatDateLong = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${MONTH_SHORT[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}, ${d.getFullYear()}`;
};

const parseDateInput = (s: string): string => {
  // Accept "May 13, 2026" or "2026-05-13" → return YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
};

const rowToRecent = (row: MeetingMinutesRow): RecentMinute => ({
  id: row.id,
  type: row.meeting_type ?? '',
  date: formatDateLong(row.meeting_date),
  rawDate: row.meeting_date ?? new Date().toISOString().slice(0, 10),
  location: row.location ?? '',
  status: row.status === 'complete' ? 'Complete' : 'Draft',
  document: row.minutes_document,
  transcript: row.transcript,
});

export const MinutesScreen: React.FC = () => {
  const access = useStrategyAccess();
  if (!access.isPro) {
    return (
      <LockedScreen
        title="AI Meeting Minutes"
        description="Voice-transcribed board meeting minutes with AI-generated documents are part of the Pro plan."
        requiredTier="Pro"
      />
    );
  }
  return <MinutesScreenInner />;
};

const MinutesScreenInner: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { activeBusinessId } = useBusiness();
  const { year: taxYear, startIso, endIso } = useYear();

  const [meetingType, setMeetingType] = useState<MeetingType>(MEETING_TYPES[0]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [meetingDate, setMeetingDate] = useState(formatDateLong(new Date().toISOString().slice(0, 10)));
  const [meetingLocation, setMeetingLocation] = useState('');
  const [attendeeCountText, setAttendeeCountText] = useState('');
  const [transcript, setTranscript] = useState('');
  const [recentMinutes, setRecentMinutes] = useState<RecentMinute[]>([]);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  // The Recent Minutes row currently open in the editable minutes view.
  const [editingMinute, setEditingMinute] = useState<RecentMinute | null>(null);

  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  // Segmented-recording session state. A "session" spans every segment of one
  // meeting: it begins when the first segment starts and ends when the user
  // generates/saves the minutes (or leaves the screen).
  const [sessionActive, setSessionActive] = useState(false);
  const [segmentCount, setSegmentCount] = useState(0);
  const [segmentNotice, setSegmentNotice] = useState<string | null>(null);
  const [showSegmentWarning, setShowSegmentWarning] = useState(false);
  const [transcribingSegmentNum, setTranscribingSegmentNum] = useState<number | null>(null);

  // Keep the screen awake for the WHOLE multi-segment session — not just while
  // a single segment is recording. `sessionActive` stays true between segments
  // (after one transcribes, before the next starts) so auto-lock can never
  // interrupt a long meeting; it is released on generate/save or on unmount.
  useKeepAwakeWhile(sessionActive, 'minutes-screen');
  const activeRecRef = useRef<Audio.Recording | null>(null);
  const recordStartRef = useRef<number>(0);
  const typeBufferRef = useRef('');
  const typeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pulse = useRef(new Animated.Value(0)).current;
  const [elapsedMs, setElapsedMs] = useState(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTypeOn = useCallback(() => {
    if (typeTimerRef.current) return;
    typeTimerRef.current = setInterval(() => {
      if (!typeBufferRef.current.length) {
        if (typeTimerRef.current) {
          clearInterval(typeTimerRef.current);
          typeTimerRef.current = null;
        }
        return;
      }
      const ch = typeBufferRef.current.charAt(0);
      typeBufferRef.current = typeBufferRef.current.slice(1);
      setTranscript((prev) => prev + ch);
    }, TYPE_ON_MS_PER_CHAR);
  }, []);

  const enqueueText = useCallback((text: string) => {
    if (!text) return;
    const needsSpace =
      typeBufferRef.current.length > 0
        ? !/\s$/.test(typeBufferRef.current) && !/^\s/.test(text)
        : false;
    typeBufferRef.current += (needsSpace ? ' ' : '') + text;
    startTypeOn();
  }, [startTypeOn]);

  // Whole-file transcripts arrive in one piece and can be thousands of chars,
  // so we append them directly rather than animating char-by-char (which would
  // take minutes). The typewriter is reserved for short voice-inbox prefills.
  const appendTranscript = useCallback((text: string) => {
    if (!text) return;
    setTranscript((prev) => {
      if (!prev) return text;
      return /\s$/.test(prev) ? prev + text : `${prev} ${text}`;
    });
  }, []);

  const consumeIfMeetingMinutes = useCallback(() => {
    const pending = peek();
    if (pending && pending.activity_type === 'meeting_minutes') {
      const note = consume();
      if (note) {
        if (note.description) enqueueText(note.description);
      }
    }
  }, [enqueueText]);

  const loadRecent = useCallback(async () => {
    try {
      let query = supabase
        .from('meeting_minutes')
        .select('*')
        .gte('meeting_date', startIso)
        .lte('meeting_date', endIso)
        .order('meeting_date', { ascending: false })
        .limit(20);
      if (activeBusinessId) query = query.eq('business_id', activeBusinessId);
      const { data, error } = await query;
      if (error) throw error;
      setRecentMinutes(((data ?? []) as MeetingMinutesRow[]).map(rowToRecent));
    } catch (e) {
      Alert.alert('Could not load minutes', e instanceof Error ? e.message : String(e));
    }
  }, [activeBusinessId, startIso, endIso]);

  useFocusEffect(
    useCallback(() => {
      consumeIfMeetingMinutes();
      loadRecent();
    }, [consumeIfMeetingMinutes, loadRecent]),
  );

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

  useEffect(() => {
    return () => {
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      if (typeTimerRef.current) clearInterval(typeTimerRef.current);
      const r = activeRecRef.current;
      if (r) r.stopAndUnloadAsync().catch(() => undefined);
    };
  }, []);

  // Start a recording segment. Each segment auto-stops at MAX_RECORDING_MS (20
  // min) to stay under Whisper's upload cap; the user can then start another
  // segment that appends to the same running transcript. Keep-awake is held for
  // the whole session via `sessionActive`.
  const beginRecording = useCallback(async () => {
    if (transcribing) return; // can't start a segment while one is transcribing
    try {
      const granted = await ensureMicPermission();
      if (!granted) {
        Alert.alert(
          'Microphone access needed',
          'Enable microphone access in Settings to record meeting minutes.',
        );
        return;
      }
      await prepareAudioMode();
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(M4A_44100_OPTIONS);
      await rec.startAsync();
      activeRecRef.current = rec;
      recordStartRef.current = Date.now();
      setSessionActive(true);
      setSegmentNotice(null);
      setShowSegmentWarning(false);
      setRecording(true);
      setElapsedMs(0);
      elapsedTimerRef.current = setInterval(() => {
        setElapsedMs((m) => Math.min(m + 1000, MAX_RECORDING_MS));
      }, 1000);
    } catch (e) {
      activeRecRef.current = null;
      await releaseAudioMode().catch(() => undefined);
      Alert.alert('Could not start recording', e instanceof Error ? e.message : String(e));
    }
  }, [transcribing]);

  // Stop the current segment, enforce the minimum length, then send the file to
  // Whisper. The transcribed text is appended to the running transcript (with a
  // "--- continued ---" divider for the 2nd segment onward) so all segments
  // combine into one transcript. `auto` is true when the 20-minute cap fired.
  const endRecording = useCallback(async (auto = false) => {
    const rec = activeRecRef.current;
    if (!rec && !recording) return; // re-entrancy guard (auto-stop + manual tap)
    const durationMs = recordStartRef.current ? Date.now() - recordStartRef.current : 0;

    // Flip out of the recording state first — this stops the timer. Keep-awake
    // stays engaged because `sessionActive` remains true between segments.
    setRecording(false);
    setShowSegmentWarning(false);
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    activeRecRef.current = null;
    recordStartRef.current = 0;

    if (!rec) {
      await releaseAudioMode().catch(() => undefined);
      return;
    }

    let uri: string | null = null;
    try {
      await rec.stopAndUnloadAsync();
      uri = rec.getURI();
    } catch (e) {
      console.warn('[minutes] stop recording failed', e);
    } finally {
      await releaseAudioMode().catch(() => undefined);
    }

    // Minimum-length guard. Very short recordings are the most common source of
    // hallucinated URLs, so we never send them to Whisper.
    if (durationMs < MIN_RECORDING_MS) {
      Alert.alert(
        'Recording too short',
        'Recording too short — please speak for at least a few seconds.',
      );
      return;
    }
    if (!uri) {
      Alert.alert(
        'No audio captured',
        'The recording produced no audio. Please try again.',
      );
      return;
    }

    const segNum = segmentCount + 1;
    setTranscribingSegmentNum(segNum);
    setTranscribing(true);
    try {
      const text = await transcribe(uri, {
        prompt: WHISPER_PROMPT,
        language: 'en',
      });
      // Confirm the Whisper response actually came back. If "Transcribing…"
      // never clears, check whether this logs — no log means the request never
      // resolved (proxy unreachable / wrong EXPO_PUBLIC_PROXY_URL).
      console.log('[minutes] whisper response received', {
        segment: segNum,
        chars: text.length,
        preview: text.slice(0, 80),
      });
      if (text) {
        // First transcribed segment of the session appends to whatever is
        // already there; every later segment gets the divider so the user can
        // see where each part begins.
        setTranscript((prev) => {
          if (!prev.trim()) return text;
          if (segmentCount > 0) return prev + SEGMENT_DIVIDER + text;
          return /\s$/.test(prev) ? prev + text : `${prev} ${text}`;
        });
        setSegmentCount(segNum);
        setSegmentNotice(
          `Segment ${segNum} transcribed. Tap the mic to continue recording the next part of your meeting.`,
        );
      } else {
        Alert.alert(
          'Nothing transcribed',
          'Whisper returned an empty transcript. Please try recording again.',
        );
      }
    } catch (e) {
      console.warn('[minutes] transcribe failed', e);
      if (e instanceof MissingProxyError) {
        Alert.alert('Proxy not configured', e.message);
      } else if (e instanceof ProxyUnreachableError) {
        Alert.alert('Proxy unreachable', e.message);
      } else {
        Alert.alert(
          'Transcription failed',
          e instanceof Error ? e.message : String(e),
        );
      }
    } finally {
      setTranscribing(false);
      setTranscribingSegmentNum(null);
    }
  }, [recording, segmentCount]);

  // Auto-stop the segment the instant it reaches the 20-minute Whisper cap.
  useEffect(() => {
    if (!recording) return;
    if (elapsedMs >= MAX_RECORDING_MS) {
      void endRecording(true);
    } else if (elapsedMs >= WARNING_MS) {
      setShowSegmentWarning(true);
    }
  }, [recording, elapsedMs, endRecording]);

  // End the session once the minutes are produced/saved: this releases the
  // keep-awake lock and resets the segment counter for the next meeting.
  const endSession = useCallback(() => {
    setSessionActive(false);
    setSegmentCount(0);
    setSegmentNotice(null);
    setShowSegmentWarning(false);
  }, []);

  const onMicPress = () => {
    if (recording) void endRecording();
    else void beginRecording();
  };

  const openDocument = useCallback(
    (document: string, type: string, dateIso: string, location: string) => {
      navigation.navigate('MinutesDocument', {
        document,
        meetingType: type || meetingType,
        meetingDate: formatDateLong(dateIso) || dateIso,
        location: location || '—',
      });
    },
    [navigation, meetingType],
  );

  const onGenerate = async () => {
    if (!transcript.trim()) {
      Alert.alert('No transcript yet', 'Record audio or type a transcript first.');
      return;
    }
    setGenerating(true);
    try {
      const userId = await requireUserId();
      const dateIso = parseDateInput(meetingDate);
      const attendeeCount = (() => {
        const n = parseInt(attendeeCountText, 10);
        return Number.isFinite(n) && n > 0 ? n : null;
      })();

      const document = await generateMinutesDocument({
        transcript,
        meeting_type: meetingType,
        meeting_date: dateIso,
        location: meetingLocation,
        attendee_count: attendeeCount,
      });

      const { error } = await supabase.from('meeting_minutes').insert({
        user_id: userId,
        business_id: activeBusinessId,
        meeting_type: meetingType,
        location: meetingLocation,
        meeting_date: dateIso,
        transcript,
        minutes_document: document,
        attendee_count: attendeeCount,
        status: 'complete',
      });
      if (error) throw new Error(error.message);

      // Mirror the generated minutes into the documents vault so it shows up
      // on the Documents screen. We store the full minutes text in file_url
      // since generated docs aren't backed by file storage.
      let vaultSaved = false;
      try {
        const { error: docErr } = await supabase.from('documents').insert({
          user_id: userId,
          business_id: activeBusinessId,
          name: buildMinutesDocName(meetingType, dateIso),
          strategy_category: MEETING_TYPE_TO_STRATEGY[meetingType],
          file_type: 'minutes',
          file_url: document,
        });
        if (docErr) throw new Error(docErr.message);
        vaultSaved = true;
      } catch (e) {
        console.warn('[minutes] vault insert failed', e);
      }

      await loadRecent();
      endSession();
      if (vaultSaved) {
        Alert.alert('Saved', 'Minutes saved to your document vault');
      }
      openDocument(document, meetingType, dateIso, meetingLocation);
    } catch (e) {
      if (e instanceof MissingProxyError) {
        Alert.alert('Proxy not configured', e.message);
      } else if (e instanceof ProxyUnreachableError) {
        Alert.alert('Proxy unreachable', e.message);
      } else {
        Alert.alert(
          'Could not generate minutes',
          e instanceof Error ? e.message : String(e),
        );
      }
    } finally {
      setGenerating(false);
    }
  };

  const onSaveDraft = async () => {
    if (!transcript.trim()) {
      Alert.alert('No transcript yet', 'Record audio or type a transcript first.');
      return;
    }
    setSaving(true);
    try {
      const userId = await requireUserId();
      const attendeeCount = (() => {
        const n = parseInt(attendeeCountText, 10);
        return Number.isFinite(n) && n > 0 ? n : null;
      })();
      const { error } = await supabase.from('meeting_minutes').insert({
        user_id: userId,
        meeting_type: meetingType,
        location: meetingLocation,
        meeting_date: parseDateInput(meetingDate),
        transcript,
        attendee_count: attendeeCount,
        status: 'draft',
      });
      if (error) throw new Error(error.message);
      await loadRecent();
      endSession();
      Alert.alert('Draft saved', 'Your meeting minutes draft was saved.');
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const generateFromRow = async (row: RecentMinute) => {
    if (!row.transcript?.trim()) {
      Alert.alert('No transcript', 'This draft has no transcript to generate from.');
      return;
    }
    setGenerating(true);
    try {
      const attendeeCount = null; // not tracked on row at the moment
      const document = await generateMinutesDocument({
        transcript: row.transcript,
        meeting_type: row.type,
        meeting_date: row.rawDate,
        location: row.location,
        attendee_count: attendeeCount,
      });
      const { error } = await supabase
        .from('meeting_minutes')
        .update({ minutes_document: document, status: 'complete' })
        .eq('id', row.id);
      if (error) throw new Error(error.message);

      let vaultSaved = false;
      const rowType = row.type as MeetingType;
      if (MEETING_TYPE_TO_STRATEGY[rowType]) {
        try {
          const userId = await requireUserId();
          const { error: docErr } = await supabase.from('documents').insert({
            user_id: userId,
            business_id: activeBusinessId,
            name: buildMinutesDocName(rowType, row.rawDate),
            strategy_category: MEETING_TYPE_TO_STRATEGY[rowType],
            file_type: 'minutes',
            file_url: document,
          });
          if (docErr) throw new Error(docErr.message);
          vaultSaved = true;
        } catch (e) {
          console.warn('[minutes] vault insert failed', e);
        }
      }

      await loadRecent();
      if (vaultSaved) {
        Alert.alert('Saved', 'Minutes saved to your document vault');
      }
      openDocument(document, row.type, row.rawDate, row.location);
    } catch (e) {
      if (e instanceof MissingProxyError) {
        Alert.alert('Proxy not configured', e.message);
      } else if (e instanceof ProxyUnreachableError) {
        Alert.alert('Proxy unreachable', e.message);
      } else {
        Alert.alert(
          'Could not generate minutes',
          e instanceof Error ? e.message : String(e),
        );
      }
    } finally {
      setGenerating(false);
    }
  };

  const onRecentPress = (row: RecentMinute) => {
    if (row.document?.trim()) {
      // Generated minutes open in the editable minutes view.
      setEditingMinute(row);
      return;
    }
    // Draft with no document yet — show transcript with the option to generate
    // the full document.
    Alert.alert(
      'Draft Minutes',
      row.transcript?.trim()
        ? `Transcript:\n\n${row.transcript.slice(0, 600)}${row.transcript.length > 600 ? '…' : ''}`
        : 'This draft has no transcript yet.',
      [
        { text: 'Close', style: 'cancel' },
        ...(row.transcript?.trim()
          ? [
              {
                text: 'Generate Document',
                onPress: () => generateFromRow(row),
              },
            ]
          : []),
      ],
    );
  };

  const elapsedLabel = formatElapsed(elapsedMs);
  const timerColor =
    elapsedMs >= MAX_RECORDING_MS
      ? TIMER_LIMIT
      : elapsedMs >= WARNING_MS
      ? TIMER_WARN
      : TIMER_GOOD;

  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.15],
  });
  const haloOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0],
  });
  const haloScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.8],
  });

  return (
    <View style={styles.root}>
      <Header year={taxYear} />
      <YearSelector />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 40 + insets.bottom },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View>
          <Text style={styles.label}>Meeting Type</Text>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setDropdownOpen(true)}
            style={styles.dropdown}
          >
            <Text style={styles.dropdownText} numberOfLines={1}>
              {meetingType}
            </Text>
            <Ionicons name="chevron-down" size={18} color={colors.mutedText} />
          </TouchableOpacity>
        </View>

        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={styles.label}>Date</Text>
            <TextInput
              style={styles.input}
              value={meetingDate}
              onChangeText={setMeetingDate}
              placeholder="May 13, 2026"
              placeholderTextColor={colors.subtleText}
            />
          </View>
          <View style={styles.gap} />
          <View style={styles.flex}>
            <Text style={styles.label}>Location</Text>
            <TextInput
              style={styles.input}
              value={meetingLocation}
              onChangeText={setMeetingLocation}
              placeholder="Scottsdale, AZ"
              placeholderTextColor={colors.subtleText}
            />
          </View>
        </View>

        <View>
          <Text style={styles.label}>Attendees</Text>
          <TextInput
            style={styles.input}
            value={attendeeCountText}
            onChangeText={(v) => setAttendeeCountText(v.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            placeholder="Number of attendees"
            placeholderTextColor={colors.subtleText}
          />
        </View>

        <Card padded style={styles.recordCard}>
          <View style={styles.recordHeader}>
            <View style={styles.recordTitleWrap}>
              <Text style={styles.recordTitle}>
                {recording
                  ? 'Recording…'
                  : transcribing
                  ? 'Transcribing…'
                  : 'Voice Recording'}
              </Text>
              {(recording || segmentCount > 0) && !transcribing ? (
                <View style={styles.segmentChip}>
                  <Text style={styles.segmentChipText}>
                    Segment {recording ? segmentCount + 1 : segmentCount}
                  </Text>
                </View>
              ) : null}
            </View>
            <View style={styles.timerWrap}>
              {transcribing ? (
                <ActivityIndicator size="small" color={colors.midNavy} />
              ) : (
                <>
                  {recording ? (
                    <View style={[styles.recordDot, { backgroundColor: timerColor }]} />
                  ) : null}
                  <Text
                    style={[
                      styles.timerText,
                      recording && { color: timerColor, fontSize: 15 },
                    ]}
                  >
                    {elapsedLabel}
                  </Text>
                </>
              )}
            </View>
          </View>

          <AnimatedWaveform active={recording} style={styles.waveform} />

          {recording && showSegmentWarning ? (
            <View style={styles.warningBanner}>
              <Ionicons name="time-outline" size={18} color={TIMER_WARN} />
              <Text style={styles.warningText}>
                2 minutes remaining in this recording segment. Tap the mic to
                pause and continue in a new segment.
              </Text>
            </View>
          ) : null}

          {transcribing ? (
            <View style={styles.transcribingBanner}>
              <ActivityIndicator size="small" color={colors.midNavy} />
              <View style={styles.transcribingTextWrap}>
                <Text style={styles.transcribingText}>
                  Transcribing segment {transcribingSegmentNum ?? ''}… please
                  wait
                </Text>
                <Text style={styles.transcribingSubText}>
                  Usually takes 30-60 seconds per 10 minutes of audio
                </Text>
              </View>
            </View>
          ) : null}

          {!recording && !transcribing && segmentNotice ? (
            <View style={styles.segmentNoticeBanner}>
              <Ionicons
                name="checkmark-circle"
                size={18}
                color={TIMER_GOOD}
              />
              <Text style={styles.segmentNoticeText}>{segmentNotice}</Text>
            </View>
          ) : null}

          <View style={styles.micRow}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={onMicPress}
              disabled={!recording && transcribing}
              style={[
                styles.micWrap,
                !recording && transcribing && styles.micWrapDisabled,
              ]}
            >
              {recording ? (
                <Animated.View
                  style={[
                    styles.halo,
                    { opacity: haloOpacity, transform: [{ scale: haloScale }] },
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
                <Ionicons
                  name={recording ? 'stop' : 'mic'}
                  size={26}
                  color={colors.white}
                />
              </Animated.View>
            </TouchableOpacity>
            <Text style={styles.micHint}>
              {recording
                ? 'Recording — tap to stop when finished'
                : transcribing
                ? 'Transcribing your recording…'
                : segmentCount > 0
                ? 'Tap the mic to record the next segment'
                : 'Tap the mic to begin recording'}
            </Text>
            <KeepAwakeIndicator visible={sessionActive} style={styles.keepAwakeBadge} />
          </View>
        </Card>

        <Text style={styles.usageNote}>
          Each recording segment captures up to 20 minutes. For longer meetings
          tap the mic again to add another segment.
        </Text>

        <View>
          <Text style={styles.label}>Transcript</Text>
          <TextInput
            style={styles.transcript}
            value={transcript}
            onChangeText={setTranscript}
            multiline
            textAlignVertical="top"
            placeholder="Transcript will appear here as you record. You can also type or edit directly."
            placeholderTextColor={colors.subtleText}
          />
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={onGenerate}
            disabled={saving || generating}
            style={[
              styles.btn,
              styles.btnPrimary,
              (saving || generating) && { opacity: 0.7 },
            ]}
          >
            {generating ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Ionicons name="document-text-outline" size={18} color={colors.white} />
            )}
            <Text style={styles.btnPrimaryText}>
              {generating ? 'Generating…' : 'Generate Minutes'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={onSaveDraft}
            disabled={saving || generating}
            style={[
              styles.btn,
              styles.btnOutline,
              (saving || generating) && { opacity: 0.7 },
            ]}
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.navy} />
            ) : (
              <Ionicons name="save-outline" size={18} color={colors.navy} />
            )}
            <Text style={styles.btnOutlineText}>Save Draft</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <SectionHeader title="Recent Minutes" action="See all" />
          <Card padded>
            {recentMinutes.length === 0 ? (
              <Text style={styles.emptyText}>
                No minutes yet. Record a meeting and tap Generate Minutes.
              </Text>
            ) : (
              recentMinutes.map((m, i) => (
                <TouchableOpacity
                  key={m.id}
                  activeOpacity={0.7}
                  onPress={() => onRecentPress(m)}
                  style={[
                    styles.recentRow,
                    i !== recentMinutes.length - 1 && styles.recentRowDivider,
                  ]}
                >
                  <View style={styles.recentIcon}>
                    <Ionicons
                      name="document-text-outline"
                      size={18}
                      color={colors.midNavy}
                    />
                  </View>
                  <View style={styles.recentText}>
                    <Text style={styles.recentTitle} numberOfLines={1}>
                      {m.type}
                    </Text>
                    <Text style={styles.recentMeta} numberOfLines={1}>
                      {m.date} · {m.location}
                    </Text>
                  </View>
                  <StatusPill
                    label={m.status}
                    variant={m.status === 'Complete' ? 'success' : 'warning'}
                  />
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={colors.subtleText}
                    style={{ marginLeft: spacing.xs }}
                  />
                </TouchableOpacity>
              ))
            )}
          </Card>
        </View>
      </ScrollView>

      <Modal
        visible={dropdownOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDropdownOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setDropdownOpen(false)}
        >
          <Pressable style={styles.modalSheet} onPress={() => undefined}>
            <Text style={styles.modalTitle}>Meeting Type</Text>
            {MEETING_TYPES.map((opt) => {
              const selected = opt === meetingType;
              return (
                <TouchableOpacity
                  key={opt}
                  activeOpacity={0.7}
                  onPress={() => {
                    setMeetingType(opt);
                    setDropdownOpen(false);
                  }}
                  style={[styles.option, selected && styles.optionSelected]}
                >
                  <Text
                    style={[
                      styles.optionText,
                      selected && styles.optionTextSelected,
                    ]}
                  >
                    {opt}
                  </Text>
                  {selected ? (
                    <Ionicons name="checkmark" size={18} color={colors.navy} />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>

      <MinutesEditModal
        minute={editingMinute}
        businessId={activeBusinessId}
        onClose={() => setEditingMinute(null)}
        onSaved={loadRecent}
      />
    </View>
  );
};

const formatElapsed = (ms: number) => {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60).toString().padStart(2, '0');
  const s = (total % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

// ── Editable minutes view (Fix 4) ────────────────────────────────────────────

const DELETE_RED = '#B33A3A';

const escapeHtmlMinutes = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Compact markdown-ish → HTML conversion so the shared PDF keeps headings and
// bullets from the minutes text.
const buildMinutesHtml = (
  doc: string,
  meetingType: string,
  meetingDate: string,
  location: string,
): string => {
  const body = doc
    .split(/\r?\n/)
    .map((raw) => {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) return '<div style="height:8px"></div>';
      const heading = /^(#{1,3})\s+(.*)$/.exec(line);
      if (heading) {
        const level = heading[1].length;
        return `<h${level}>${escapeHtmlMinutes(heading[2].replace(/\*\*/g, ''))}</h${level}>`;
      }
      const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
      if (bullet) return `<li>${escapeHtmlMinutes(bullet[1].replace(/\*\*/g, ''))}</li>`;
      return `<p>${escapeHtmlMinutes(line.replace(/\*\*/g, ''))}</p>`;
    })
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8" />
<style>
  @page { margin: 48px; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1A1A2E; font-size: 12pt; line-height: 1.5; }
  .hdr { border-bottom: 2px solid #042C53; padding-bottom: 12px; margin-bottom: 20px; }
  .hdr h1 { color: #042C53; margin: 0 0 6px 0; font-size: 20pt; }
  .hdr .meta { color: #6B7280; font-size: 10.5pt; }
  h1 { color: #042C53; font-size: 16pt; } h2 { color: #042C53; font-size: 14pt; }
  h3 { color: #1A1A2E; font-size: 12pt; } p { margin: 4px 0 8px 0; } li { margin: 2px 0; }
</style></head><body>
  <div class="hdr"><h1>Meeting Minutes</h1>
  <div class="meta">${escapeHtmlMinutes(meetingType)} · ${escapeHtmlMinutes(meetingDate)} · ${escapeHtmlMinutes(location || '—')}</div></div>
  ${body}
</body></html>`;
};

const shareMinutesAsPdf = async (
  doc: string,
  meetingType: string,
  meetingDate: string,
  location: string,
): Promise<void> => {
  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error('Sharing is not available on this device.');
  const html = buildMinutesHtml(doc, meetingType, meetingDate, location);
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: 'Share Meeting Minutes',
  });
};

interface MinutesEditModalProps {
  minute: RecentMinute | null;
  businessId: string | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

const MinutesEditModal: React.FC<MinutesEditModalProps> = ({
  minute,
  businessId,
  onClose,
  onSaved,
}) => {
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [meetingType, setMeetingType] = useState<MeetingType>(MEETING_TYPES[0]);
  const [meetingDate, setMeetingDate] = useState('');
  const [location, setLocation] = useState('');
  const [editMeta, setEditMeta] = useState(false);
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [sharing, setSharing] = useState(false);
  // The document text we currently match the documents-vault row on. Updated
  // after every successful save so the next save still finds the row.
  const originalDocRef = useRef('');

  useEffect(() => {
    if (!minute) return;
    setText(minute.document ?? '');
    const mt = (MEETING_TYPES as string[]).includes(minute.type)
      ? (minute.type as MeetingType)
      : MEETING_TYPES[0];
    setMeetingType(mt);
    setMeetingDate(minute.date || formatDateLong(minute.rawDate));
    setLocation(minute.location ?? '');
    setEditMeta(false);
    originalDocRef.current = minute.document ?? '';
  }, [minute]);

  // Updates meeting_minutes and the mirrored documents row with the given text
  // plus the current metadata.
  const persistMinutes = async (docText: string): Promise<void> => {
    if (!minute) return;
    const userId = await requireUserId();
    const dateIso = parseDateInput(meetingDate);
    const { error } = await supabase
      .from('meeting_minutes')
      .update({
        meeting_type: meetingType,
        location,
        meeting_date: dateIso,
        minutes_document: docText,
      })
      .eq('id', minute.id)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);

    if (originalDocRef.current) {
      const { error: docErr } = await supabase
        .from('documents')
        .update({ file_url: docText, name: buildMinutesDocName(meetingType, dateIso) })
        .eq('user_id', userId)
        .eq('file_type', 'minutes')
        .eq('file_url', originalDocRef.current);
      if (docErr) console.warn('[minutes] vault update failed', docErr);
    }
    originalDocRef.current = docText;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await persistMinutes(text);
      await onSaved();
      onClose();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerate = () => {
    if (!minute?.transcript?.trim()) {
      Alert.alert('No transcript', 'This meeting has no transcript to regenerate from.');
      return;
    }
    Alert.alert(
      'Regenerate minutes',
      'This will replace your current minutes with a newly generated version. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Regenerate',
          style: 'destructive',
          onPress: async () => {
            setRegenerating(true);
            try {
              const dateIso = parseDateInput(meetingDate);
              const doc = await generateMinutesDocument({
                transcript: minute.transcript ?? '',
                meeting_type: meetingType,
                meeting_date: dateIso,
                location,
                attendee_count: null,
              });
              setText(doc);
              await persistMinutes(doc);
              await onSaved();
            } catch (e) {
              if (e instanceof MissingProxyError) {
                Alert.alert('Proxy not configured', e.message);
              } else if (e instanceof ProxyUnreachableError) {
                Alert.alert('Proxy unreachable', e.message);
              } else {
                Alert.alert(
                  'Could not regenerate',
                  e instanceof Error ? e.message : String(e),
                );
              }
            } finally {
              setRegenerating(false);
            }
          },
        },
      ],
    );
  };

  const handleShare = async () => {
    setSharing(true);
    try {
      await shareMinutesAsPdf(text, meetingType, meetingDate, location);
    } catch (e) {
      Alert.alert('Could not share', e instanceof Error ? e.message : String(e));
    } finally {
      setSharing(false);
    }
  };

  const handleDelete = () => {
    if (!minute) return;
    Alert.alert(
      'Delete these minutes?',
      'This removes the minutes and its document. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              const userId = await requireUserId();
              const { error } = await supabase
                .from('meeting_minutes')
                .delete()
                .eq('id', minute.id)
                .eq('user_id', userId);
              if (error) throw new Error(error.message);
              if (originalDocRef.current) {
                await supabase
                  .from('documents')
                  .delete()
                  .eq('user_id', userId)
                  .eq('file_type', 'minutes')
                  .eq('file_url', originalDocRef.current);
              }
              await onSaved();
              onClose();
            } catch (e) {
              Alert.alert('Could not delete', e instanceof Error ? e.message : String(e));
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  const busy = saving || regenerating || sharing;

  return (
    <Modal visible={!!minute} animationType="slide" onRequestClose={onClose}>
      <View style={[editStyles.root, { paddingTop: insets.top }]}>
        <View style={editStyles.topBar}>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={editStyles.topBtn}>
            <Ionicons name="close" size={26} color={colors.bodyText} />
          </TouchableOpacity>
          <Text style={editStyles.topTitle} numberOfLines={1}>
            Edit Minutes
          </Text>
          <TouchableOpacity
            onPress={handleSave}
            disabled={busy}
            hitSlop={12}
            style={editStyles.topBtn}
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.navy} />
            ) : (
              <Ionicons name="checkmark" size={26} color={colors.navy} />
            )}
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          style={editStyles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={[
              editStyles.content,
              { paddingBottom: 32 + insets.bottom },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={editStyles.metaCard}>
              <View style={editStyles.metaHeader}>
                <Text style={editStyles.metaCardTitle}>Meeting details</Text>
                <TouchableOpacity onPress={() => setEditMeta((v) => !v)} hitSlop={8}>
                  <Text style={editStyles.editDetailsLink}>
                    {editMeta ? 'Done' : 'Edit Details'}
                  </Text>
                </TouchableOpacity>
              </View>
              {editMeta ? (
                <View style={editStyles.metaFields}>
                  <View>
                    <Text style={styles.label}>Meeting Type</Text>
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => setTypeDropdownOpen(true)}
                      style={styles.dropdown}
                    >
                      <Text style={styles.dropdownText} numberOfLines={1}>
                        {meetingType}
                      </Text>
                      <Ionicons name="chevron-down" size={18} color={colors.mutedText} />
                    </TouchableOpacity>
                  </View>
                  <View>
                    <Text style={styles.label}>Date</Text>
                    <TextInput
                      style={styles.input}
                      value={meetingDate}
                      onChangeText={setMeetingDate}
                      placeholder="May 13, 2026"
                      placeholderTextColor={colors.subtleText}
                    />
                  </View>
                  <View>
                    <Text style={styles.label}>Location</Text>
                    <TextInput
                      style={styles.input}
                      value={location}
                      onChangeText={setLocation}
                      placeholder="Scottsdale, AZ"
                      placeholderTextColor={colors.subtleText}
                    />
                  </View>
                </View>
              ) : (
                <>
                  <Text style={editStyles.metaLine}>{meetingType}</Text>
                  <Text style={editStyles.metaSub}>
                    {meetingDate}
                    {location ? ` · ${location}` : ''}
                  </Text>
                </>
              )}
            </View>

            <Text style={styles.label}>Minutes</Text>
            <TextInput
              style={editStyles.docArea}
              value={text}
              onChangeText={setText}
              multiline
              textAlignVertical="top"
              placeholder="Minutes document"
              placeholderTextColor={colors.subtleText}
            />

            <View style={editStyles.actionRow}>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={handleRegenerate}
                disabled={busy}
                style={[editStyles.actionBtn, editStyles.actionOutline, busy && editStyles.dim]}
              >
                {regenerating ? (
                  <ActivityIndicator size="small" color={colors.navy} />
                ) : (
                  <Ionicons name="refresh" size={16} color={colors.navy} />
                )}
                <Text style={editStyles.actionOutlineText}>Regenerate</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={handleShare}
                disabled={busy}
                style={[editStyles.actionBtn, editStyles.actionOutline, busy && editStyles.dim]}
              >
                {sharing ? (
                  <ActivityIndicator size="small" color={colors.navy} />
                ) : (
                  <Ionicons name="share-outline" size={16} color={colors.navy} />
                )}
                <Text style={editStyles.actionOutlineText}>Share</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleSave}
              disabled={busy}
              style={[editStyles.saveBtn, busy && editStyles.dim]}
            >
              <Ionicons name="save-outline" size={18} color={colors.white} />
              <Text style={editStyles.saveBtnText}>Save Changes</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleDelete}
              disabled={busy}
              style={[editStyles.deleteBtn, busy && editStyles.dim]}
            >
              <Ionicons name="trash-outline" size={18} color={DELETE_RED} />
              <Text style={editStyles.deleteBtnText}>Delete</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>

        <Modal
          visible={typeDropdownOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setTypeDropdownOpen(false)}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setTypeDropdownOpen(false)}>
            <Pressable style={styles.modalSheet} onPress={() => undefined}>
              <Text style={styles.modalTitle}>Meeting Type</Text>
              {MEETING_TYPES.map((opt) => {
                const selected = opt === meetingType;
                return (
                  <TouchableOpacity
                    key={opt}
                    activeOpacity={0.7}
                    onPress={() => {
                      setMeetingType(opt);
                      setTypeDropdownOpen(false);
                    }}
                    style={[styles.option, selected && styles.optionSelected]}
                  >
                    <Text
                      style={[styles.optionText, selected && styles.optionTextSelected]}
                    >
                      {opt}
                    </Text>
                    {selected ? (
                      <Ionicons name="checkmark" size={18} color={colors.navy} />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    </Modal>
  );
};

const editStyles = StyleSheet.create({
  flex: { flex: 1 },
  root: {
    flex: 1,
    backgroundColor: colors.white,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  topBtn: {
    minWidth: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: {
    ...typography.h3,
    color: colors.bodyText,
    flex: 1,
    textAlign: 'center',
    marginHorizontal: spacing.sm,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  metaCard: {
    backgroundColor: colors.background,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
    padding: spacing.md,
    gap: spacing.xs,
  },
  metaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metaCardTitle: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  editDetailsLink: {
    ...typography.bodyMedium,
    color: colors.midNavy,
    fontSize: 13,
    fontWeight: '700',
  },
  metaFields: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  metaLine: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontWeight: '700',
    fontSize: 15,
  },
  metaSub: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 13,
  },
  docArea: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 280,
    ...typography.body,
    color: colors.bodyText,
    fontSize: 14,
    lineHeight: 21,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    borderRadius: radius.card,
    paddingVertical: 12,
  },
  actionOutline: {
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.navy,
  },
  actionOutlineText: {
    ...typography.bodyMedium,
    color: colors.navy,
    fontWeight: '700',
    fontSize: 14,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    backgroundColor: colors.navy,
    borderRadius: radius.card,
    paddingVertical: 14,
  },
  saveBtnText: {
    ...typography.bodyMedium,
    color: colors.white,
    fontWeight: '700',
    fontSize: 15,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderColor: DELETE_RED,
    paddingVertical: 12,
  },
  deleteBtnText: {
    ...typography.bodyMedium,
    color: DELETE_RED,
    fontWeight: '700',
    fontSize: 14,
  },
  dim: { opacity: 0.6 },
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
    gap: spacing.lg,
  },
  label: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: spacing.xs + 2,
  },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    ...shadow.card,
  },
  dropdownText: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    marginRight: spacing.sm,
  },
  row: {
    flexDirection: 'row',
  },
  flex: {
    flex: 1,
  },
  gap: {
    width: spacing.md,
  },
  input: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    ...typography.body,
    color: colors.bodyText,
    fontSize: 14,
    ...shadow.card,
  },
  recordCard: {
    alignItems: 'stretch',
    gap: spacing.md,
  },
  recordHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recordTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  recordTitle: {
    ...typography.h3,
    color: colors.bodyText,
  },
  segmentChip: {
    backgroundColor: colors.lightBlue,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  segmentChipText: {
    ...typography.caption,
    color: colors.midNavy,
    fontSize: 11,
    fontWeight: '700',
  },
  timerWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  recordDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E0352B',
  },
  timerText: {
    ...typography.bodyMedium,
    color: colors.mutedText,
    fontVariant: ['tabular-nums'],
    fontSize: 13,
    fontWeight: '700',
  },
  waveform: {
    marginVertical: spacing.xs,
  },
  transcribingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.lightBlue,
    borderRadius: radius.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  transcribingTextWrap: {
    flex: 1,
    gap: 2,
  },
  transcribingText: {
    ...typography.body,
    color: colors.midNavy,
    fontSize: 13,
    fontWeight: '600',
  },
  transcribingSubText: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#FBF1DF',
    borderRadius: radius.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  warningText: {
    ...typography.body,
    color: TIMER_WARN,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  segmentNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#E7F3EE',
    borderRadius: radius.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  segmentNoticeText: {
    ...typography.body,
    color: TIMER_GOOD,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  usageNote: {
    color: '#888888',
    fontSize: 11,
    lineHeight: 15,
    marginTop: -spacing.sm,
  },
  micRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  micWrap: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micWrapDisabled: {
    opacity: 0.5,
  },
  micButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.raised,
  },
  halo: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#E0352B',
  },
  micHint: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 13,
    flex: 1,
  },
  keepAwakeBadge: {
    marginLeft: spacing.sm,
  },
  transcript: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 160,
    ...typography.body,
    color: colors.bodyText,
    fontSize: 14,
    lineHeight: 20,
    ...shadow.card,
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
  section: {
    gap: spacing.md,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  recentRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  recentIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.lightBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentText: {
    flex: 1,
  },
  recentTitle: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 14,
    fontWeight: '600',
  },
  recentMeta: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 1,
  },
  emptyText: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 13,
    paddingVertical: spacing.md,
    textAlign: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.xs,
  },
  modalTitle: {
    ...typography.h2,
    color: colors.bodyText,
    marginBottom: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderRadius: radius.card,
  },
  optionSelected: {
    backgroundColor: colors.lightBlue,
  },
  optionText: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 15,
    flex: 1,
  },
  optionTextSelected: {
    color: colors.navy,
    fontWeight: '700',
  },
});
