import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Modal,
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
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, radius, shadow, spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { Header } from '../components/Header';
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

const CHUNK_INTERVAL_MS = 3000;
const TYPE_ON_MS_PER_CHAR = 30;

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
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [meetingType, setMeetingType] = useState<MeetingType>(MEETING_TYPES[0]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [meetingDate, setMeetingDate] = useState(formatDateLong(new Date().toISOString().slice(0, 10)));
  const [meetingLocation, setMeetingLocation] = useState('');
  const [attendeeCountText, setAttendeeCountText] = useState('');
  const [transcript, setTranscript] = useState('');
  const [recentMinutes, setRecentMinutes] = useState<RecentMinute[]>([]);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const activeRecRef = useRef<Audio.Recording | null>(null);
  const chunkLoopActiveRef = useRef(false);
  const breakChunkRef = useRef<(() => void) | null>(null);
  const transcribeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const inFlightCountRef = useRef(0);
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
      const { data, error } = await supabase
        .from('meeting_minutes')
        .select('*')
        .order('meeting_date', { ascending: false })
        .limit(20);
      if (error) throw error;
      setRecentMinutes(((data ?? []) as MeetingMinutesRow[]).map(rowToRecent));
    } catch (e) {
      Alert.alert('Could not load minutes', e instanceof Error ? e.message : String(e));
    }
  }, []);

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
      chunkLoopActiveRef.current = false;
      if (breakChunkRef.current) breakChunkRef.current();
      const r = activeRecRef.current;
      if (r) r.stopAndUnloadAsync().catch(() => undefined);
    };
  }, []);

  const enqueueChunkUri = useCallback(
    (uri: string) => {
      inFlightCountRef.current += 1;
      setTranscribing(true);
      transcribeQueueRef.current = transcribeQueueRef.current.then(async () => {
        try {
          const text = await transcribe(uri, {
            prompt: `Meeting minutes for a ${meetingType}.`,
          });
          if (text) enqueueText(text);
        } catch (e) {
          console.warn('[minutes] chunk transcribe failed', e);
          if (e instanceof MissingProxyError) {
            Alert.alert('Proxy not configured', e.message);
          } else if (e instanceof ProxyUnreachableError) {
            Alert.alert('Proxy unreachable', e.message);
          } else {
            // Don't block subsequent chunks — surface the error inline.
            enqueueText(` [transcription error: ${e instanceof Error ? e.message : String(e)}] `);
          }
        } finally {
          inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
          if (inFlightCountRef.current === 0) setTranscribing(false);
        }
      });
    },
    [meetingType, enqueueText],
  );

  const runChunkLoop = useCallback(async () => {
    chunkLoopActiveRef.current = true;
    try {
      await prepareAudioMode();
      while (chunkLoopActiveRef.current) {
        const rec = new Audio.Recording();
        try {
          await rec.prepareToRecordAsync(M4A_44100_OPTIONS);
          await rec.startAsync();
        } catch (e) {
          Alert.alert('Recording error', e instanceof Error ? e.message : String(e));
          break;
        }
        activeRecRef.current = rec;

        await new Promise<void>((resolve) => {
          const id = setTimeout(() => {
            breakChunkRef.current = null;
            resolve();
          }, CHUNK_INTERVAL_MS);
          breakChunkRef.current = () => {
            clearTimeout(id);
            breakChunkRef.current = null;
            resolve();
          };
        });

        let uri: string | null = null;
        try {
          await rec.stopAndUnloadAsync();
          uri = rec.getURI();
        } catch {
          // ignore
        }
        activeRecRef.current = null;
        if (uri) enqueueChunkUri(uri);
      }
    } finally {
      chunkLoopActiveRef.current = false;
      await releaseAudioMode().catch(() => undefined);
    }
  }, [enqueueChunkUri]);

  const startStreaming = async () => {
    try {
      const granted = await ensureMicPermission();
      if (!granted) {
        Alert.alert(
          'Microphone access needed',
          'Enable microphone access in Settings to record meeting minutes.',
        );
        return;
      }
      setRecording(true);
      setElapsedMs(0);
      elapsedTimerRef.current = setInterval(() => {
        setElapsedMs((m) => m + 1000);
      }, 1000);
      void runChunkLoop();
    } catch (e) {
      Alert.alert('Could not start recording', e instanceof Error ? e.message : String(e));
    }
  };

  const stopStreaming = () => {
    setRecording(false);
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    chunkLoopActiveRef.current = false;
    if (breakChunkRef.current) breakChunkRef.current();
  };

  const onMicPress = () => {
    if (recording) stopStreaming();
    else void startStreaming();
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
    if (row.status === 'Complete' && row.document?.trim()) {
      openDocument(row.document, row.type, row.rawDate, row.location);
      return;
    }
    // Draft (or a complete row missing its document) — show transcript with
    // the option to generate the full document.
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
      <Header year={2026} />

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
            <Text style={styles.recordTitle}>
              {recording
                ? 'Recording…'
                : transcribing
                ? 'Transcribing…'
                : 'Voice Recording'}
            </Text>
            <View style={styles.timerWrap}>
              {transcribing ? (
                <ActivityIndicator size="small" color={colors.midNavy} />
              ) : (
                <>
                  {recording ? <View style={styles.recordDot} /> : null}
                  <Text
                    style={[
                      styles.timerText,
                      recording && { color: '#E0352B' },
                    ]}
                  >
                    {elapsedLabel}
                  </Text>
                </>
              )}
            </View>
          </View>

          <AnimatedWaveform active={recording} style={styles.waveform} />

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
                ? 'Streaming to Whisper every 3s — tap to stop'
                : transcribing
                ? 'Finishing transcription…'
                : 'Tap the mic to begin streaming'}
            </Text>
          </View>
        </Card>

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
    </View>
  );
};

const formatElapsed = (ms: number) => {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60).toString().padStart(2, '0');
  const s = (total % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
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
  recordTitle: {
    ...typography.h3,
    color: colors.bodyText,
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
