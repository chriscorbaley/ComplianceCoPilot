import React, { useEffect, useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '../theme';
import { EditFormSheet } from './EditFormSheet';
import { DatePickerModal } from './DateInputField';
import { type ActivityHoursType } from '../services/activityLog';
import {
  supabase,
  requireUserId,
  type HoursLogRow,
  type PropertyRow,
} from '../services/supabase';

// The three participation buckets every hours_log row carries (no "all").
const HOURS_TYPE_EDIT_OPTIONS: Array<{ key: ActivityHoursType; label: string }> = [
  { key: 'reps_general', label: 'REPS General' },
  { key: 'material_participation', label: 'Material Participation' },
  { key: 'str_participation', label: 'STR Participation' },
];

// A sensible category for a manually-created row, keyed off its participation
// bucket. category drives the Activity Log icon + meta label, so mapping it
// keeps a hand-logged entry visually consistent with voice-logged ones.
const HOURS_TYPE_TO_CATEGORY: Record<ActivityHoursType, string> = {
  reps_general: 'Property Management',
  material_participation: 'Property Management',
  str_participation: 'Short-term Rental',
};

const MIN_ACTIVITY_DATE = new Date('2020-01-01');

// Local-time YYYY-MM-DD for a Date — matches how hours_log.activity_date is
// stored so string comparisons never drift across time zones.
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

// MM/DD/YYYY display for the date field.
const formatDateMMDDYYYY = (date: Date): string => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}/${date.getFullYear()}`;
};

const FieldLabel: React.FC<{ text: string }> = ({ text }) => (
  <Text style={styles.fieldLabel}>{text}</Text>
);

const OptionRow: React.FC<{
  label: string;
  active: boolean;
  onPress: () => void;
}> = ({ label, active, onPress }) => (
  <TouchableOpacity
    activeOpacity={0.8}
    onPress={onPress}
    style={[styles.option, active && styles.optionActive]}
  >
    <Text
      style={[styles.optionText, active && styles.optionTextActive]}
      numberOfLines={1}
    >
      {label}
    </Text>
    {active ? <Ionicons name="checkmark" size={18} color={colors.white} /> : null}
  </TouchableOpacity>
);

export interface ActivityLogSheetProps {
  // 'create' → blank form, INSERT a new hours_log row, no Delete button.
  // 'edit'   → pre-filled from `row`, UPDATE that row, Delete shown.
  mode: 'create' | 'edit';
  visible: boolean;
  properties: PropertyRow[];
  // Required in edit mode: the row being edited.
  row?: HoursLogRow | null;
  // Written to business_id on create so the entry is scoped to the active
  // business (and counts toward that business's Dashboard totals).
  businessId?: string | null;
  // Initial participation bucket in create mode (defaults to reps_general).
  defaultHoursType?: ActivityHoursType;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

/**
 * A single manual activity form for the hours_log table, shared by the Hours
 * screen (edit an existing row) and the strategy detail screens (log a new
 * activity). Renders inside the app's standard EditFormSheet.
 */
export const ActivityLogSheet: React.FC<ActivityLogSheetProps> = ({
  mode,
  visible,
  properties,
  row,
  businessId,
  defaultHoursType = 'reps_general',
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

  // Seed the form whenever the sheet opens: from the tapped record in edit
  // mode, or with sensible defaults (today, General, chosen bucket) in create.
  useEffect(() => {
    if (!visible) return;
    if (mode === 'edit' && row) {
      setDescription(row.description ?? '');
      setDate(parseISODateLocal(row.activity_date));
      setHours(row.hours != null ? String(row.hours) : '');
      setHoursType((row.hours_type as ActivityHoursType) ?? 'reps_general');
      setPropertyId(row.property_id ?? null);
    } else if (mode === 'create') {
      setDescription('');
      setDate(new Date());
      setHours('');
      setHoursType(defaultHoursType);
      setPropertyId(null);
    }
  }, [visible, mode, row, defaultHoursType]);

  const handleSave = async () => {
    const hoursNum = parseFloat(hours);
    const safeHours = Number.isFinite(hoursNum) ? hoursNum : 0;
    setSaving(true);
    try {
      const userId = await requireUserId();
      if (mode === 'edit') {
        if (!row) return;
        const { error } = await supabase
          .from('hours_log')
          .update({
            description: description.trim() || null,
            activity_date: date ? toISODateLocal(date) : row.activity_date,
            hours: safeHours,
            hours_type: hoursType,
            property_id: propertyId,
          })
          .eq('id', row.id)
          .eq('user_id', userId);
        if (error) throw new Error(error.message);
      } else {
        // Full field set so the row surfaces everywhere a voice-logged one
        // does: Activity Log table, auditor export, and Dashboard totals.
        const { error } = await supabase.from('hours_log').insert({
          user_id: userId,
          business_id: businessId ?? null,
          property_id: propertyId,
          description: description.trim() || null,
          category: HOURS_TYPE_TO_CATEGORY[hoursType],
          hours: safeHours,
          activity_date: toISODateLocal(date ?? new Date()),
          hours_type: hoursType,
        });
        if (error) throw new Error(error.message);
      }
      await onSaved();
      onClose();
    } catch (e) {
      Alert.alert(
        'Could not save activity',
        e instanceof Error ? e.message : String(e),
      );
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
      Alert.alert(
        'Could not delete activity',
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setSaving(false);
    }
  };

  const isCreate = mode === 'create';

  return (
    <EditFormSheet
      title={isCreate ? 'Log Activity' : 'Edit Activity'}
      saveLabel={isCreate ? 'Log Activity' : 'Save Changes'}
      visible={visible}
      onClose={onClose}
      onSave={handleSave}
      onDelete={isCreate ? undefined : handleDelete}
      showDelete={!isCreate}
      saving={saving}
      deleteLabel="Delete Activity"
      deleteConfirmTitle="Delete this activity?"
      deleteConfirmMessage="Delete this activity? This cannot be undone."
    >
      <View>
        <FieldLabel text="Activity description" />
        <TextInput
          style={[styles.input, styles.inputMulti]}
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
          style={styles.dateField}
        >
          <Text style={[styles.dateText, !date && styles.datePlaceholder]}>
            {date ? formatDateMMDDYYYY(date) : 'MM/DD/YYYY'}
          </Text>
          <Ionicons name="calendar-outline" size={20} color={colors.midNavy} />
        </TouchableOpacity>
      </View>

      <View>
        <FieldLabel text="Hours" />
        <TextInput
          style={styles.input}
          value={hours}
          onChangeText={setHours}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={colors.subtleText}
        />
      </View>

      <View>
        <FieldLabel text="Hours type" />
        <View style={styles.optionList}>
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
          <View style={styles.optionList}>
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

const styles = StyleSheet.create({
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
