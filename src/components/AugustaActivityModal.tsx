// Manual + voice entry form for logging an Augusta Rule (IRC §280A(g)) business
// meeting. Mirrors the Log Trip form pattern: labeled inputs, a date picker, a
// meeting-type dropdown, and (for Core/Pro) a mic that pre-fills fields from a
// spoken description. On save it writes the meeting and auto-generates a
// Documents record with the blue Augusta badge.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
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
import { colors, radius, shadow, spacing, typography } from '../theme';
import {
  AUGUSTA_MEETING_TYPES,
  saveAugustaActivity,
} from '../services/augusta';
import {
  classifyFromRecording,
  ensureMicPermission,
  startRecording,
  MissingProxyError,
  ProxyUnreachableError,
} from '../services/openai';
import { useStrategyAccess } from '../hooks/useStrategyAccess';
import { useBusiness } from '../business/BusinessContext';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const toIsoDate = (d: Date): string => {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
};

const formatHuman = (d: Date): string =>
  `${MONTH_SHORT[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}, ${d.getFullYear()}`;

interface AugustaActivityModalProps {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}

type VoicePhase = 'idle' | 'recording' | 'processing';

export const AugustaActivityModal: React.FC<AugustaActivityModalProps> = ({
  visible,
  onClose,
  onSaved,
}) => {
  const { activeBusinessId } = useBusiness();
  const { canUseVoice } = useStrategyAccess();

  const [meetingDate, setMeetingDate] = useState<Date>(new Date());
  const [location, setLocation] = useState('');
  const [meetingType, setMeetingType] = useState<string>(AUGUSTA_MEETING_TYPES[0]);
  const [attendees, setAttendees] = useState('');
  const [duration, setDuration] = useState('');
  const [rentalRate, setRentalRate] = useState('');
  const [purpose, setPurpose] = useState('');

  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle');
  const recRef = useRef<Audio.Recording | null>(null);

  // Reset the form each time the modal is freshly opened.
  useEffect(() => {
    if (visible) {
      setMeetingDate(new Date());
      setLocation('');
      setMeetingType(AUGUSTA_MEETING_TYPES[0]);
      setAttendees('');
      setDuration('');
      setRentalRate('');
      setPurpose('');
      setVoicePhase('idle');
    }
  }, [visible]);

  const parseNum = (s: string): number | null => {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  };

  const onVoicePress = async () => {
    if (voicePhase === 'processing') return;
    if (voicePhase === 'recording') {
      const rec = recRef.current;
      recRef.current = null;
      if (!rec) {
        setVoicePhase('idle');
        return;
      }
      setVoicePhase('processing');
      try {
        const { note } = await classifyFromRecording(rec);
        // Pre-fill whatever the classifier could extract; the rest stays for
        // the user to complete manually.
        if (note.date) {
          const d = new Date(`${note.date}T00:00:00`);
          if (!Number.isNaN(d.getTime())) setMeetingDate(d);
        }
        if (note.meeting_type) {
          const match = AUGUSTA_MEETING_TYPES.find((t) =>
            t.toLowerCase().includes(note.meeting_type!.toLowerCase()) ||
            note.meeting_type!.toLowerCase().includes(t.toLowerCase()),
          );
          if (match) setMeetingType(match);
        }
        if (note.destination) setLocation(note.destination);
        if (note.duration_hours != null) setDuration(String(note.duration_hours));
        const purposeText = note.business_purpose || note.description;
        if (purposeText) setPurpose(purposeText);
        Alert.alert(
          'Filled from your recording',
          'Review the fields and complete anything that is still blank, then save.',
        );
      } catch (e) {
        console.warn('[augusta] voice prefill failed', e);
        if (e instanceof MissingProxyError) {
          Alert.alert('Proxy not configured', e.message);
        } else if (e instanceof ProxyUnreachableError) {
          Alert.alert('Proxy unreachable', e.message);
        } else {
          Alert.alert('Voice capture failed', e instanceof Error ? e.message : String(e));
        }
      } finally {
        setVoicePhase('idle');
      }
      return;
    }
    // idle → start recording
    try {
      const granted = await ensureMicPermission();
      if (!granted) {
        Alert.alert('Microphone access needed', 'Enable microphone access in Settings to use voice logging.');
        return;
      }
      const rec = await startRecording();
      recRef.current = rec;
      setVoicePhase('recording');
    } catch (e) {
      Alert.alert('Could not start recording', e instanceof Error ? e.message : String(e));
    }
  };

  const onSave = async () => {
    if (saving) return;
    if (!purpose.trim()) {
      Alert.alert('Meeting purpose required', 'Describe the business purpose of this meeting before saving.');
      return;
    }
    setSaving(true);
    try {
      await saveAugustaActivity({
        businessId: activeBusinessId,
        meetingDate: toIsoDate(meetingDate),
        location: location.trim(),
        meetingType,
        attendees: attendees.trim(),
        durationHours: parseNum(duration),
        rentalRate: parseNum(rentalRate),
        meetingPurpose: purpose.trim(),
      });
      Alert.alert(
        'Minutes saved successfully',
        'Your Augusta Rule meeting minutes were generated and saved to your Documents.',
      );
      onSaved();
      onClose();
    } catch (e) {
      Alert.alert('Could not save meeting', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const voiceLabel =
    voicePhase === 'recording'
      ? 'Listening… tap to stop'
      : voicePhase === 'processing'
        ? 'Transcribing…'
        : 'Fill from voice';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Log Augusta Rule meeting</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.mutedText} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {canUseVoice ? (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={onVoicePress}
                disabled={voicePhase === 'processing'}
                style={[
                  styles.voiceBtn,
                  voicePhase === 'recording' && styles.voiceBtnRecording,
                ]}
              >
                {voicePhase === 'processing' ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Ionicons
                    name={voicePhase === 'recording' ? 'stop' : 'mic'}
                    size={18}
                    color={colors.white}
                  />
                )}
                <Text style={styles.voiceBtnText}>{voiceLabel}</Text>
              </TouchableOpacity>
            ) : null}

            {/* Meeting date */}
            <Text style={styles.label}>Meeting date</Text>
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.selectField}
              onPress={() => setDatePickerOpen(true)}
            >
              <Text style={styles.selectValue}>{formatHuman(meetingDate)}</Text>
              <Ionicons name="calendar-outline" size={18} color={colors.midNavy} />
            </TouchableOpacity>

            <LabeledInput
              label="Location"
              placeholder="e.g. 123 Main St, Scottsdale"
              value={location}
              onChangeText={setLocation}
            />

            {/* Meeting type */}
            <Text style={styles.label}>Meeting type</Text>
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.selectField}
              onPress={() => setTypePickerOpen(true)}
            >
              <Text style={styles.selectValue}>{meetingType}</Text>
              <Ionicons name="chevron-down" size={18} color={colors.midNavy} />
            </TouchableOpacity>

            <LabeledInput
              label="Attendees"
              placeholder="e.g. Sarah Chen, Mark Chen"
              value={attendees}
              onChangeText={setAttendees}
            />

            <LabeledInput
              label="Duration (hours)"
              placeholder="e.g. 2.5"
              keyboardType="decimal-pad"
              value={duration}
              onChangeText={setDuration}
            />

            {/* Rental rate with $ prefix */}
            <Text style={styles.label}>Rental rate agreed</Text>
            <View style={styles.rateRow}>
              <Text style={styles.ratePrefix}>$</Text>
              <TextInput
                style={styles.rateInput}
                placeholder="e.g. 850"
                placeholderTextColor={colors.subtleText}
                keyboardType="decimal-pad"
                value={rentalRate}
                onChangeText={setRentalRate}
              />
            </View>

            <LabeledInput
              label="Meeting purpose"
              placeholder="Describe the business purpose of this meeting"
              value={purpose}
              onChangeText={setPurpose}
              multiline
            />

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={onSave}
              disabled={saving}
              style={[styles.saveBtn, saving && styles.saveBtnDim]}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Ionicons name="save-outline" size={18} color={colors.white} />
              )}
              <Text style={styles.saveBtnText}>
                {saving ? 'Generating your meeting minutes…' : 'Save meeting'}
              </Text>
            </TouchableOpacity>

            {saving ? (
              <View style={styles.savingHint}>
                <ActivityIndicator size="small" color={colors.midNavy} />
                <Text style={styles.savingHintText}>
                  Generating your meeting minutes…
                </Text>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>

      <DatePickerModal
        visible={datePickerOpen}
        value={meetingDate}
        onCancel={() => setDatePickerOpen(false)}
        onConfirm={(d) => {
          setMeetingDate(d);
          setDatePickerOpen(false);
        }}
      />

      <OptionPickerModal
        visible={typePickerOpen}
        title="Meeting type"
        options={[...AUGUSTA_MEETING_TYPES]}
        selected={meetingType}
        onSelect={(v) => {
          setMeetingType(v);
          setTypePickerOpen(false);
        }}
        onClose={() => setTypePickerOpen(false)}
      />
    </Modal>
  );
};

const LabeledInput: React.FC<{
  label: string;
  placeholder?: string;
  value: string;
  onChangeText: (v: string) => void;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
  multiline?: boolean;
}> = ({ label, placeholder, value, onChangeText, keyboardType, multiline }) => (
  <>
    <Text style={styles.label}>{label}</Text>
    <TextInput
      style={[styles.input, multiline && styles.inputMulti]}
      placeholder={placeholder}
      placeholderTextColor={colors.subtleText}
      value={value}
      onChangeText={onChangeText}
      keyboardType={keyboardType ?? 'default'}
      multiline={multiline}
    />
  </>
);

// ── Option picker (meeting type) ────────────────────────────────────────────

const OptionPickerModal: React.FC<{
  visible: boolean;
  title: string;
  options: string[];
  selected: string;
  onSelect: (v: string) => void;
  onClose: () => void;
}> = ({ visible, title, options, selected, onSelect, onClose }) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <TouchableOpacity style={picker.backdrop} activeOpacity={1} onPress={onClose}>
      <View style={picker.menu}>
        <Text style={picker.menuTitle}>{title}</Text>
        {options.map((opt) => {
          const active = opt === selected;
          return (
            <TouchableOpacity
              key={opt}
              activeOpacity={0.8}
              style={[picker.menuItem, active && picker.menuItemActive]}
              onPress={() => onSelect(opt)}
            >
              <Text style={[picker.menuItemText, active && picker.menuItemTextActive]}>
                {opt}
              </Text>
              {active ? <Ionicons name="checkmark" size={18} color={colors.white} /> : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </TouchableOpacity>
  </Modal>
);

// ── Date picker (Month / Day / Year scroll columns) ─────────────────────────

const daysInMonth = (year: number, monthIdx: number): number =>
  new Date(year, monthIdx + 1, 0).getDate();

const DatePickerModal: React.FC<{
  visible: boolean;
  value: Date;
  onCancel: () => void;
  onConfirm: (d: Date) => void;
}> = ({ visible, value, onCancel, onConfirm }) => {
  const [m, setM] = useState(value.getMonth());
  const [d, setD] = useState(value.getDate());
  const [y, setY] = useState(value.getFullYear());

  useEffect(() => {
    if (visible) {
      setM(value.getMonth());
      setD(value.getDate());
      setY(value.getFullYear());
    }
  }, [visible, value]);

  const yearChoices = useMemo(() => {
    const top = new Date().getFullYear();
    return Array.from({ length: 6 }, (_, i) => top - i);
  }, []);

  const maxDay = daysInMonth(y, m);
  const dayChoices = useMemo(
    () => Array.from({ length: maxDay }, (_, i) => i + 1),
    [maxDay],
  );
  const safeDay = Math.min(d, maxDay);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={picker.sheetBackdrop}>
        <View style={picker.sheet}>
          <Text style={picker.sheetTitle}>Meeting date</Text>
          <View style={picker.columns}>
            <ScrollView style={picker.col} showsVerticalScrollIndicator={false}>
              {MONTHS.map((name, idx) => (
                <TouchableOpacity
                  key={name}
                  style={[picker.option, idx === m && picker.optionActive]}
                  onPress={() => setM(idx)}
                >
                  <Text style={[picker.optionText, idx === m && picker.optionTextActive]}>
                    {name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <ScrollView style={picker.colNarrow} showsVerticalScrollIndicator={false}>
              {dayChoices.map((day) => (
                <TouchableOpacity
                  key={day}
                  style={[picker.option, day === safeDay && picker.optionActive]}
                  onPress={() => setD(day)}
                >
                  <Text style={[picker.optionText, day === safeDay && picker.optionTextActive]}>
                    {day}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <ScrollView style={picker.colNarrow} showsVerticalScrollIndicator={false}>
              {yearChoices.map((yr) => (
                <TouchableOpacity
                  key={yr}
                  style={[picker.option, yr === y && picker.optionActive]}
                  onPress={() => setY(yr)}
                >
                  <Text style={[picker.optionText, yr === y && picker.optionTextActive]}>
                    {yr}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          <View style={picker.sheetActions}>
            <TouchableOpacity style={picker.cancelBtn} onPress={onCancel}>
              <Text style={picker.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={picker.confirmBtn}
              onPress={() => onConfirm(new Date(y, m, safeDay))}
            >
              <Text style={picker.confirmBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: '92%',
    paddingTop: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerTitle: {
    ...typography.h2,
    color: colors.bodyText,
    fontSize: 17,
    fontWeight: '700',
  },
  scroll: { flexGrow: 0 },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  voiceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingVertical: 12,
    marginBottom: spacing.lg,
    ...shadow.raised,
  },
  voiceBtnRecording: {
    backgroundColor: '#E0352B',
  },
  voiceBtnText: {
    ...typography.bodyMedium,
    color: colors.white,
    fontWeight: '700',
    fontSize: 14,
  },
  label: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
    marginTop: spacing.md,
  },
  input: {
    backgroundColor: colors.white,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.select({ ios: 12, default: 10 }),
    ...typography.body,
    color: colors.bodyText,
    fontSize: 14,
  },
  inputMulti: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  selectField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.white,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
  },
  selectValue: {
    ...typography.body,
    color: colors.bodyText,
    fontSize: 14,
    fontWeight: '600',
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
  },
  ratePrefix: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 15,
    fontWeight: '700',
    marginRight: spacing.xs,
  },
  rateInput: {
    flex: 1,
    paddingVertical: Platform.select({ ios: 12, default: 10 }),
    ...typography.body,
    color: colors.bodyText,
    fontSize: 14,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingVertical: 15,
    marginTop: spacing.xl,
    ...shadow.raised,
  },
  saveBtnDim: { opacity: 0.7 },
  savingHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  savingHintText: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 13,
  },
  saveBtnText: {
    ...typography.bodyMedium,
    color: colors.white,
    fontWeight: '700',
    fontSize: 15,
  },
});

const picker = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  menu: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    ...shadow.raised,
  },
  menuTitle: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
  },
  menuItemActive: {
    backgroundColor: colors.midNavy,
  },
  menuItemText: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 15,
    fontWeight: '600',
  },
  menuItemTextActive: {
    color: colors.white,
  },
  sheetBackdrop: {
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
  },
  sheetTitle: {
    ...typography.h2,
    color: colors.bodyText,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  columns: {
    flexDirection: 'row',
    gap: spacing.sm,
    height: 220,
  },
  col: { flex: 2 },
  colNarrow: { flex: 1 },
  option: {
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    alignItems: 'center',
  },
  optionActive: {
    backgroundColor: colors.lightBlue,
  },
  optionText: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 14,
  },
  optionTextActive: {
    color: colors.navy,
    fontWeight: '700',
  },
  sheetActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  cancelBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.navy,
  },
  cancelBtnText: {
    ...typography.bodyMedium,
    color: colors.navy,
    fontWeight: '700',
    fontSize: 14,
  },
  confirmBtn: {
    flex: 1.4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 8,
    backgroundColor: colors.navy,
  },
  confirmBtnText: {
    ...typography.bodyMedium,
    color: colors.white,
    fontWeight: '700',
    fontSize: 14,
  },
});
