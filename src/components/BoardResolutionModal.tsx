// "Generate Board Resolution" flow for the S-Corp compliance screen. Collects
// the meeting details (date, location, directors, subject, resolution text,
// unanimous consent), pre-fills the resolution language from the subject, then
// captures the director's signature and generates + saves + shares the PDF.

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, shadow, spacing, typography } from '../theme';
import { scaled } from '../constants/layout';
import { DatePickerModal } from './DateInputField';
import { SignaturePad } from './SignaturePad';
import {
  generateBoardResolution,
  defaultResolutionText,
  formatLongDate,
  RESOLUTION_SUBJECTS,
} from '../services/scorpDocuments';

interface Props {
  visible: boolean;
  businessId: string | null;
  businessName: string;
  defaultSignerName: string;
  onClose: () => void;
  onGenerated: () => void;
}

export const BoardResolutionModal: React.FC<Props> = ({
  visible,
  businessId,
  businessName,
  defaultSignerName,
  onClose,
  onGenerated,
}) => {
  const insets = useSafeAreaInsets();
  const [meetingDate, setMeetingDate] = useState<Date>(new Date());
  const [meetingTime, setMeetingTime] = useState('10:00 AM');
  const [location, setLocation] = useState('');
  const [directors, setDirectors] = useState('');
  const [subject, setSubject] = useState<string>(RESOLUTION_SUBJECTS[0]);
  const [customSubject, setCustomSubject] = useState('');
  const [resolutionText, setResolutionText] = useState(
    defaultResolutionText(RESOLUTION_SUBJECTS[0], businessName),
  );
  const [unanimous, setUnanimous] = useState(true);
  const [signerName, setSignerName] = useState(defaultSignerName);
  const [generating, setGenerating] = useState(false);
  // Locked while the user draws in the signature pad so strokes don't scroll.
  const [scrollEnabled, setScrollEnabled] = useState(true);

  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [subjectPickerOpen, setSubjectPickerOpen] = useState(false);

  useEffect(() => {
    if (visible) {
      setMeetingDate(new Date());
      setMeetingTime('10:00 AM');
      setLocation('');
      setDirectors('');
      setSubject(RESOLUTION_SUBJECTS[0]);
      setCustomSubject('');
      setResolutionText(defaultResolutionText(RESOLUTION_SUBJECTS[0], businessName));
      setUnanimous(true);
      setSignerName(defaultSignerName);
      setGenerating(false);
      setScrollEnabled(true);
    }
  }, [visible, businessName, defaultSignerName]);

  const onSubjectSelect = (next: string) => {
    setSubject(next);
    setSubjectPickerOpen(false);
    // Re-seed the resolution language when the subject changes.
    setResolutionText(defaultResolutionText(next, businessName));
  };

  const effectiveSubject =
    subject === 'Other' ? customSubject.trim() || 'Other' : subject;

  const onConfirm = async (signatureDataUrl: string) => {
    if (!signerName.trim()) {
      Alert.alert('Name required', 'Enter the director name before signing.');
      return;
    }
    if (!resolutionText.trim()) {
      Alert.alert('Resolution required', 'Enter the resolution text before signing.');
      return;
    }
    setGenerating(true);
    try {
      await generateBoardResolution({
        businessId,
        businessName,
        meetingDate,
        meetingTime: meetingTime.trim(),
        location: location.trim(),
        directorsPresent: directors.trim(),
        subject: effectiveSubject,
        resolutionText: resolutionText.trim(),
        unanimous,
        signatureDataUrl,
        signerName: signerName.trim(),
      });
      onGenerated();
      onClose();
      Alert.alert(
        'Board Resolution signed and saved',
        'Your Board Resolution has been signed and added to your S-Corp compliance documents automatically.',
      );
    } catch (e) {
      Alert.alert('Could not generate resolution', e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Generate Board Resolution</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.mutedText} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              { paddingBottom: spacing.xxl + insets.bottom },
            ]}
            showsVerticalScrollIndicator={false}
            scrollEnabled={scrollEnabled}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.label}>Meeting date</Text>
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.selectField}
              onPress={() => setDatePickerOpen(true)}
            >
              <Text style={styles.selectValue}>{formatLongDate(meetingDate)}</Text>
              <Ionicons name="calendar-outline" size={18} color={colors.midNavy} />
            </TouchableOpacity>

            <Text style={styles.label}>Meeting time</Text>
            <TextInput
              style={styles.input}
              value={meetingTime}
              onChangeText={setMeetingTime}
              placeholder="e.g. 10:00 AM"
              placeholderTextColor={colors.subtleText}
            />

            <Text style={styles.label}>Meeting location</Text>
            <TextInput
              style={styles.input}
              value={location}
              onChangeText={setLocation}
              placeholder="e.g. 123 Main St, Scottsdale"
              placeholderTextColor={colors.subtleText}
            />

            <Text style={styles.label}>Directors present</Text>
            <TextInput
              style={styles.input}
              value={directors}
              onChangeText={setDirectors}
              placeholder="Comma-separated names"
              placeholderTextColor={colors.subtleText}
            />

            <Text style={styles.label}>Resolution subject</Text>
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.selectField}
              onPress={() => setSubjectPickerOpen(true)}
            >
              <Text style={styles.selectValue}>{subject}</Text>
              <Ionicons name="chevron-down" size={18} color={colors.midNavy} />
            </TouchableOpacity>

            {subject === 'Other' ? (
              <>
                <Text style={styles.label}>Subject (describe)</Text>
                <TextInput
                  style={styles.input}
                  value={customSubject}
                  onChangeText={setCustomSubject}
                  placeholder="Describe the resolution subject"
                  placeholderTextColor={colors.subtleText}
                />
              </>
            ) : null}

            <Text style={styles.label}>Resolution text</Text>
            <TextInput
              style={[styles.input, styles.inputMulti]}
              value={resolutionText}
              onChangeText={setResolutionText}
              placeholder="Resolution language"
              placeholderTextColor={colors.subtleText}
              multiline
            />

            <View style={styles.toggleRow}>
              <View style={styles.toggleText}>
                <Text style={styles.toggleTitle}>Unanimous consent</Text>
                <Text style={styles.toggleSub}>All directors voted in favor</Text>
              </View>
              <Switch
                value={unanimous}
                onValueChange={setUnanimous}
                trackColor={{ false: '#CCCCCC', true: colors.midNavy }}
                thumbColor={colors.white}
              />
            </View>

            <Text style={styles.label}>Director name</Text>
            <TextInput
              style={styles.input}
              value={signerName}
              onChangeText={setSignerName}
              placeholder="Signer full name"
              placeholderTextColor={colors.subtleText}
            />

            <Text style={styles.sigHeading}>Director Signature</Text>
            <Text style={styles.sigSub}>Sign below to adopt this resolution</Text>
            <SignaturePad
              onConfirm={onConfirm}
              confirming={generating}
              confirmLabel="Adopt & generate"
              onDrawStart={() => setScrollEnabled(false)}
              onDrawEnd={() => setScrollEnabled(true)}
            />
          </ScrollView>
        </View>
      </View>

      <DatePickerModal
        visible={datePickerOpen}
        title="Meeting date"
        value={meetingDate}
        onCancel={() => setDatePickerOpen(false)}
        onConfirm={(d) => {
          setMeetingDate(d);
          setDatePickerOpen(false);
        }}
      />

      <Modal
        visible={subjectPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSubjectPickerOpen(false)}
      >
        <TouchableOpacity
          style={picker.backdrop}
          activeOpacity={1}
          onPress={() => setSubjectPickerOpen(false)}
        >
          <View style={picker.menu}>
            <Text style={picker.menuTitle}>Resolution subject</Text>
            {RESOLUTION_SUBJECTS.map((opt) => {
              const active = opt === subject;
              return (
                <TouchableOpacity
                  key={opt}
                  activeOpacity={0.8}
                  style={[picker.menuItem, active && picker.menuItemActive]}
                  onPress={() => onSubjectSelect(opt)}
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
    maxHeight: '94%',
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
    paddingVertical: scaled(12),
    minHeight: scaled(44),
    ...typography.body,
    color: colors.bodyText,
    fontSize: 14,
  },
  inputMulti: {
    minHeight: scaled(110),
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
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.white,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    marginTop: spacing.lg,
  },
  toggleText: { flex: 1, paddingRight: spacing.md },
  toggleTitle: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 14,
    fontWeight: '700',
  },
  toggleSub: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 2,
  },
  sigHeading: {
    ...typography.h3,
    color: colors.bodyText,
    fontSize: 15,
    fontWeight: '700',
    marginTop: spacing.xl,
  },
  sigSub: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    marginBottom: spacing.md,
    marginTop: 2,
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
  menuItemActive: { backgroundColor: colors.midNavy },
  menuItemText: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 15,
    fontWeight: '600',
  },
  menuItemTextActive: { color: colors.white },
});
