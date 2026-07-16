import React, { useEffect, useState } from 'react';
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
import { scaled } from '../constants/layout';
import { DateInputField } from './DateInputField';
import {
  MANUAL_MINUTES_META,
  saveManualMinutes,
  shareManualMinutesPdf,
  type ManualMinutesStrategy,
  type ManualMinutesInput,
} from '../services/manualMinutes';
import { AugustaDocsModal, type AugustaDocsContext } from './AugustaDocsModal';

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

  // The Augusta Rule variant collects the extra rental fields and, after saving,
  // offers to generate the required lease agreement + invoice (same flow as the
  // Log Activity form). The other strategies keep the plain minutes-only path.
  const isAugusta = strategy === 'augusta_rule';

  const [date, setDate] = useState<Date | null>(null);
  const [location, setLocation] = useState('');
  const [attendees, setAttendees] = useState('');
  const [duration, setDuration] = useState('');
  const [rentalRate, setRentalRate] = useState('');
  const [topics, setTopics] = useState('');
  const [decisions, setDecisions] = useState('');
  const [actionItems, setActionItems] = useState('');
  const [busy, setBusy] = useState(false);

  // Post-save lease + invoice generation (Augusta only). iOS can only present a
  // single modal at a time, so on "Generate Both" we dismiss this modal first,
  // then open the docs modal once this one has finished animating out.
  const [docsContext, setDocsContext] = useState<AugustaDocsContext | null>(null);
  const [docsModalOpen, setDocsModalOpen] = useState(false);
  const [pendingDocs, setPendingDocs] = useState(false);

  // Android Modals don't fire onDismiss, so open the queued docs modal as soon
  // as this modal is hidden. On iOS the onDismiss handler below does this after
  // the slide-out animation so the two modals never overlap.
  useEffect(() => {
    if (Platform.OS === 'android' && !visible && pendingDocs) {
      setPendingDocs(false);
      setDocsModalOpen(true);
    }
  }, [visible, pendingDocs]);

  const parseNum = (s: string): number | null => {
    const n = parseFloat(s.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  const reset = () => {
    setDate(null);
    setLocation('');
    setAttendees('');
    setDuration('');
    setRentalRate('');
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

      if (isAugusta) {
        // Stage the rental context from the form so the lease + invoice pre-fill
        // correctly, then offer to generate both (mirrors the Log Activity path).
        const ctx: AugustaDocsContext = {
          businessId,
          businessEntityName: businessName ?? '',
          location: location.trim(),
          rentalDate: isoFor(date),
          durationHours: parseNum(duration),
          rentalRate: parseNum(rentalRate),
          meetingPurpose: [topics, decisions]
            .map((s) => s.trim())
            .filter(Boolean)
            .join('\n\n'),
        };
        setDocsContext(ctx);
        Alert.alert(
          'Generate Rental Documents',
          'Your meeting minutes are saved. Would you also like to generate the required lease agreement and invoice for this rental?',
          [
            { text: 'Skip', style: 'cancel', onPress: close },
            {
              text: 'Generate Both',
              onPress: () => {
                // Dismiss this modal first; the docs modal opens once it has
                // finished animating out (see onDismiss / the visible effect).
                setPendingDocs(true);
                close();
              },
            },
          ],
        );
        return;
      }

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
    <>
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={close}
      presentationStyle="pageSheet"
      onDismiss={() => {
        // iOS: this modal has finished dismissing — now it's safe to present the
        // docs modal without the two overlapping.
        if (pendingDocs) {
          setPendingDocs(false);
          setDocsModalOpen(true);
        }
      }}
    >
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
            contentContainerStyle={[
              styles.content,
              { paddingBottom: 48 + insets.bottom },
            ]}
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

            {/* Augusta Rule only: rental fields needed to pre-fill the lease + invoice. */}
            {isAugusta ? (
              <>
                <Text style={styles.label}>Meeting duration (hours)</Text>
                <TextInput
                  style={styles.input}
                  value={duration}
                  onChangeText={setDuration}
                  placeholder="e.g. 2.5"
                  keyboardType="decimal-pad"
                  placeholderTextColor={colors.subtleText}
                />

                <Text style={styles.label}>Rental rate agreed ($)</Text>
                <View style={styles.rateRow}>
                  <Text style={styles.ratePrefix}>$</Text>
                  <TextInput
                    style={styles.rateInput}
                    value={rentalRate}
                    onChangeText={setRentalRate}
                    placeholder="e.g. 850"
                    keyboardType="decimal-pad"
                    placeholderTextColor={colors.subtleText}
                  />
                </View>
              </>
            ) : null}

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

    <AugustaDocsModal
      visible={docsModalOpen}
      context={docsContext}
      defaultOwnerName={clientName ?? ''}
      onClose={() => setDocsModalOpen(false)}
      onGenerated={onSaved}
    />
    </>
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
    paddingVertical: scaled(12),
    minHeight: scaled(44),
    fontSize: 14,
    color: colors.bodyText,
  },
  multiline: {
    height: 96,
    textAlignVertical: 'top',
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    paddingHorizontal: spacing.md,
  },
  ratePrefix: {
    ...typography.bodyMedium,
    color: colors.mutedText,
    fontSize: 15,
    fontWeight: '700',
    marginRight: 6,
  },
  rateInput: {
    flex: 1,
    paddingVertical: scaled(12),
    minHeight: scaled(44),
    fontSize: 14,
    color: colors.bodyText,
  },
  generateBtn: {
    marginTop: spacing.xl,
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingVertical: scaled(15),
    minHeight: scaled(44),
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
