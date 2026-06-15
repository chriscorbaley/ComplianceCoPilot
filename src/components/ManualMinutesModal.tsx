import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../theme';
import { DateInputField } from './DateInputField';
import {
  MANUAL_MINUTES_META,
  saveManualMinutes,
  shareManualMinutesPdf,
  type ManualMinutesStrategy,
  type ManualMinutesInput,
} from '../services/manualMinutes';

interface ManualMinutesModalProps {
  visible: boolean;
  strategy: ManualMinutesStrategy;
  businessId: string | null;
  businessName: string | null;
  clientName: string | null;
  onClose: () => void;
  onSaved: () => void;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (n: number): string => String(n).padStart(2, '0');
const isoFor = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const labelFor = (d: Date): string =>
  `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;

export const ManualMinutesModal: React.FC<ManualMinutesModalProps> = ({
  visible,
  strategy,
  businessId,
  businessName,
  clientName,
  onClose,
  onSaved,
}) => {
  const insets = useSafeAreaInsets();
  const meta = MANUAL_MINUTES_META[strategy];

  const [date, setDate] = useState<Date | null>(null);
  const [location, setLocation] = useState('');
  const [attendees, setAttendees] = useState('');
  const [topics, setTopics] = useState('');
  const [decisions, setDecisions] = useState('');
  const [actionItems, setActionItems] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setDate(null);
    setLocation('');
    setAttendees('');
    setTopics('');
    setDecisions('');
    setActionItems('');
  };

  const close = () => {
    reset();
    onClose();
  };

  const buildInput = (d: Date): ManualMinutesInput => ({
    strategy,
    businessId,
    businessName,
    clientName,
    meetingDate: isoFor(d),
    meetingDateLabel: labelFor(d),
    location,
    attendees,
    topicsDiscussed: topics,
    decisionsMade: decisions,
    actionItems,
  });

  const onGenerate = async () => {
    if (!date) {
      Alert.alert('Meeting date required', 'Please choose the meeting date.');
      return;
    }
    setBusy(true);
    try {
      const input = buildInput(date);
      await saveManualMinutes(input);
      onSaved();
      Alert.alert('Minutes saved', 'Your meeting minutes have been added to your documents.', [
        {
          text: 'Export PDF',
          onPress: async () => {
            try {
              await shareManualMinutesPdf(input);
            } catch (e) {
              Alert.alert('Could not export', e instanceof Error ? e.message : String(e));
            }
            close();
          },
        },
        { text: 'Done', style: 'cancel', onPress: close },
      ]);
    } catch (e) {
      Alert.alert('Could not save minutes', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} presentationStyle="pageSheet">
      <View style={styles.root}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={close} hitSlop={8}>
            <Ionicons name="close" size={24} color={colors.white} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Manual Minutes</Text>
          <View style={{ width: 24 }} />
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.meetingType}>{meta.meetingType}</Text>

            <DateInputField
              label="Meeting date"
              value={date}
              onChange={setDate}
              maximumDate={new Date()}
            />

            <Text style={styles.label}>Location</Text>
            <TextInput
              style={styles.input}
              value={location}
              onChangeText={setLocation}
              placeholder="e.g. Primary residence, 123 Main St"
              placeholderTextColor={colors.subtleText}
            />

            <Text style={styles.label}>Attendees</Text>
            <TextInput
              style={styles.input}
              value={attendees}
              onChangeText={setAttendees}
              placeholder="Comma separated, e.g. Jane Doe, John Doe"
              placeholderTextColor={colors.subtleText}
            />

            <Text style={styles.label}>Topics discussed</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={topics}
              onChangeText={setTopics}
              placeholder="Describe the main topics and items discussed at this meeting"
              placeholderTextColor={colors.subtleText}
              multiline
            />

            <Text style={styles.label}>Decisions made</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={decisions}
              onChangeText={setDecisions}
              placeholder="List the key decisions and resolutions made"
              placeholderTextColor={colors.subtleText}
              multiline
            />

            <Text style={styles.label}>Action items</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={actionItems}
              onChangeText={setActionItems}
              placeholder="List follow-up items and who is responsible"
              placeholderTextColor={colors.subtleText}
              multiline
            />

            <TouchableOpacity
              activeOpacity={0.85}
              style={[styles.generateBtn, busy && styles.generateBtnDisabled]}
              onPress={onGenerate}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.generateText}>Generate Minutes</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.navy,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerTitle: {
    ...typography.h3,
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 48,
    gap: 6,
  },
  meetingType: {
    color: colors.midNavy,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  label: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 13,
    fontWeight: '700',
    marginTop: spacing.md,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.white,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.bodyText,
  },
  multiline: {
    height: 96,
    textAlignVertical: 'top',
  },
  generateBtn: {
    marginTop: spacing.xl,
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  generateBtnDisabled: {
    opacity: 0.7,
  },
  generateText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
});
