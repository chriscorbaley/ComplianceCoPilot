import React, { useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { colors, typography } from '../theme';
import { scaled } from '../constants/layout';

interface DateInputFieldProps {
  label: string;
  value: Date | null;
  onChange: (date: Date) => void;
  minimumDate?: Date;
  maximumDate?: Date;
  placeholder?: string;
  style?: ViewStyle;
  // Controlled-picker mode. When `onPickerVisibleChange` is provided the field
  // no longer renders its own inline picker — the parent owns visibility and
  // renders a full-width <DatePickerPanel/> wherever it wants (e.g. below a
  // two-column row so the spinner is never clipped). The calendar button then
  // just toggles the parent's state.
  pickerVisible?: boolean;
  onPickerVisibleChange?: (visible: boolean) => void;
}

// Inline error color from the spec — slightly deeper than the verdict red.
const ERROR_RED = '#A32D2D';
const CALENDAR_BLUE = '#185FA5';

// Format a Date as MM/DD/YYYY for display in the text input.
const formatDate = (date: Date): string => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}/${day}/${date.getFullYear()}`;
};

// Insert slashes as the user types: 11202025 → 11/20/2025. Works incrementally
// (e.g. "112" → "11/2") and survives backspacing because it always rebuilds
// from the raw digits.
const autoFormat = (text: string): string => {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  let out = digits.slice(0, 2);
  if (digits.length > 2) out += '/' + digits.slice(2, 4);
  if (digits.length > 4) out += '/' + digits.slice(4, 8);
  return out;
};

// Parse a strict MM/DD/YYYY string to a Date, rejecting impossible dates
// (e.g. 02/30/2025) and anything outside the allowed range. Returns null when
// the text is not a valid in-range date.
const parseDate = (
  text: string,
  minimumDate?: Date,
  maximumDate?: Date,
): Date | null => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  // Reject overflow dates like 02/30 — JS would roll them into the next month.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  if (minimumDate && date < stripTime(minimumDate)) return null;
  if (maximumDate && date > stripTime(maximumDate)) return null;
  return date;
};

// Compare on calendar day only, ignoring the time component.
const stripTime = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * A date field that accepts BOTH manual typing (MM/DD/YYYY, auto-formatted)
 * and calendar selection. Renders as a single bordered unit: a borderless text
 * input on the left and a 44×44 calendar button on the right.
 *
 * Reusable on any form needing date input.
 */
export const DateInputField: React.FC<DateInputFieldProps> = ({
  label,
  value,
  onChange,
  minimumDate,
  maximumDate,
  placeholder = 'MM/DD/YYYY',
  style,
  pickerVisible: pickerVisibleProp,
  onPickerVisibleChange,
}) => {
  const [text, setText] = useState(value ? formatDate(value) : '');
  const [error, setError] = useState(false);
  const [pickerVisibleState, setPickerVisibleState] = useState(false);

  // Controlled when the parent passes a visibility handler; otherwise the field
  // manages its own inline picker (legacy behavior, still used by other forms).
  const controlled = onPickerVisibleChange !== undefined;
  const pickerVisible = controlled ? !!pickerVisibleProp : pickerVisibleState;
  const setPickerVisible = (next: boolean) => {
    if (controlled) onPickerVisibleChange?.(next);
    else setPickerVisibleState(next);
  };

  // Keep the text in sync when the date is changed from outside (calendar
  // confirm, parent recalculation). Typing never triggers this because we only
  // call onChange for valid dates. A valid external value also clears any error.
  useEffect(() => {
    setText(value ? formatDate(value) : '');
    if (value) setError(false);
  }, [value]);

  const handleChangeText = (raw: string) => {
    const formatted = autoFormat(raw);
    setText(formatted);
    // Clear the error as soon as the user starts correcting the field.
    if (error) setError(false);
    // Typing a complete, valid date closes any open picker automatically.
    if (pickerVisible && parseDate(formatted, minimumDate, maximumDate)) {
      setPickerVisible(false);
    }
  };

  const handleBlur = () => {
    if (text.trim() === '') {
      setError(false);
      return;
    }
    const parsed = parseDate(text, minimumDate, maximumDate);
    if (parsed) {
      setError(false);
      onChange(parsed);
    } else {
      setError(true);
    }
  };

  return (
    <View style={[styles.field, style]}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputRow, error && styles.inputRowError]}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={handleChangeText}
          onBlur={handleBlur}
          placeholder={placeholder}
          placeholderTextColor={colors.subtleText}
          keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
          maxLength={10}
        />
        <TouchableOpacity
          activeOpacity={0.7}
          // Tapping the icon toggles the picker — tapping again closes it.
          onPress={() => setPickerVisible(!pickerVisible)}
          style={styles.calendarButton}
          accessibilityRole="button"
          accessibilityLabel={`Open calendar for ${label}`}
        >
          <Ionicons name="calendar-outline" size={20} color={CALENDAR_BLUE} />
        </TouchableOpacity>
      </View>
      {error ? (
        <Text style={styles.errorText}>
          Please enter a valid date MM/DD/YYYY
        </Text>
      ) : null}

      {/* Inline picker rendered directly below the field — part of the form
          scroll view, not a modal. The textColor / themeVariant / accentColor /
          white background props together force dark text on white, fixing the
          invisible-text bug in Expo Go regardless of iOS dark-mode settings.
          Skipped in controlled mode: the parent renders a full-width
          <DatePickerPanel/> instead so the spinner is never clipped. */}
      {!controlled && pickerVisible && (
        <DatePickerPanel
          value={value}
          onChange={onChange}
          onClose={() => setPickerVisible(false)}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
        />
      )}
    </View>
  );
};

interface DatePickerPanelProps {
  value: Date | null;
  // Selected date is committed via onChange; the panel closes via onClose.
  onChange: (date: Date) => void;
  onClose?: () => void;
  // Shown when `value` is null (e.g. seed the return picker at the departure
  // date so its spinner doesn't open on today).
  fallback?: Date;
  minimumDate?: Date;
  maximumDate?: Date;
}

/**
 * A full-width spinner picker wrapped in a bordered white container. Render it
 * wherever full screen width is available — never inside a half-width column,
 * or the year column gets clipped. The explicit `width: '100%'` + `height: 180`
 * guarantees all three columns (month, day, year) stay visible.
 */
export const DatePickerPanel: React.FC<DatePickerPanelProps> = ({
  value,
  onChange,
  onClose,
  fallback,
  minimumDate,
  maximumDate,
}) => {
  const handleChange = (event: { type: string }, selectedDate?: Date) => {
    if (event.type === 'set' && selectedDate) {
      onChange(selectedDate);
      onClose?.();
    } else if (event.type === 'dismissed') {
      onClose?.();
    }
  };

  return (
    <View style={styles.pickerContainer}>
      <DateTimePicker
        value={value ?? fallback ?? new Date()}
        mode="date"
        display="spinner"
        onChange={handleChange}
        minimumDate={minimumDate}
        maximumDate={maximumDate}
        textColor="#1A1A2E"
        accentColor={CALENDAR_BLUE}
        themeVariant="light"
        style={styles.pickerSpinner}
      />
    </View>
  );
};

interface DatePickerModalProps {
  visible: boolean;
  // Shown in the toolbar so the user knows which date they're setting.
  title: string;
  value: Date | null;
  // Used to seed the spinner when `value` is null (e.g. open the return picker
  // at the departure date instead of today).
  fallback?: Date;
  minimumDate?: Date;
  maximumDate?: Date;
  // Fired with the chosen date when OK is tapped.
  onConfirm: (date: Date) => void;
  // Fired when Cancel is tapped or the dark overlay is dismissed.
  onCancel: () => void;
}

/**
 * A bottom-sheet date picker with explicit OK / Cancel buttons.
 *
 * Unlike the inline spinner, scrolling a column here only updates an internal
 * TEMP date — the value isn't committed until OK is tapped. This lets the user
 * adjust month, day, AND year before confirming, instead of the picker closing
 * the moment any column moves. Cancel (or tapping the dark overlay) discards
 * the temp selection and leaves the original value unchanged.
 */
export const DatePickerModal: React.FC<DatePickerModalProps> = ({
  visible,
  title,
  value,
  fallback,
  minimumDate,
  maximumDate,
  onConfirm,
  onCancel,
}) => {
  const [tempDate, setTempDate] = useState<Date>(
    value ?? fallback ?? new Date(),
  );

  // Each time the sheet opens, copy the current value into the temp state so
  // the spinner starts where the field currently is (or at the fallback).
  useEffect(() => {
    if (visible) setTempDate(value ?? fallback ?? new Date());
    // Only re-seed on open; live scrolling updates tempDate directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      {/* Tapping the dark area above the sheet acts as Cancel. */}
      <TouchableWithoutFeedback onPress={onCancel}>
        <View style={styles.modalOverlay}>
          {/* Swallow taps on the sheet itself so they don't dismiss. */}
          <TouchableWithoutFeedback onPress={() => undefined}>
            <View style={styles.pickerSheet}>
              <View style={styles.pickerToolbar}>
                <TouchableOpacity onPress={onCancel} style={styles.cancelBtn}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>

                <Text style={styles.pickerTitle}>{title}</Text>

                <TouchableOpacity
                  onPress={() => onConfirm(tempDate)}
                  style={styles.okBtn}
                >
                  <Text style={styles.okText}>OK</Text>
                </TouchableOpacity>
              </View>

              <DateTimePicker
                value={tempDate}
                mode="date"
                display="spinner"
                onChange={(_event, date) => {
                  if (date) setTempDate(date);
                }}
                minimumDate={minimumDate}
                maximumDate={maximumDate}
                textColor="#1A1A2E"
                themeVariant="light"
                accentColor={CALENDAR_BLUE}
                style={styles.modalPickerSpinner}
              />
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  field: {
    marginBottom: 16,
  },
  label: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  // The text input and calendar button together form one visual unit.
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderWidth: 0.5,
    borderColor: '#CCCCCC',
    borderRadius: 8,
  },
  inputRowError: {
    borderColor: ERROR_RED,
  },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.bodyText,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: scaled(Platform.select({ ios: 12, default: 10 }) as number),
    minHeight: scaled(44),
  },
  // 44×44 tappable calendar button, separated by an internal left divider only.
  calendarButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 0.5,
    borderLeftColor: '#CCCCCC',
    backgroundColor: colors.white,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
  },
  errorText: {
    color: ERROR_RED,
    fontSize: 11,
    marginTop: 4,
  },
  // Full-width bordered shell for the spinner. Always renders at full screen
  // width so the picker is never clipped by a half-width parent column.
  pickerContainer: {
    width: '100%',
    backgroundColor: 'white',
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: '#CCCCCC',
    marginTop: 8,
    overflow: 'hidden',
  },
  // White background guarantees the spinner text is dark-on-white in Expo Go.
  // Explicit width/height keeps all three columns (month, day, year) visible.
  pickerSpinner: {
    backgroundColor: 'white',
    width: '100%',
    height: 180,
  },
  // ── Bottom-sheet picker (DatePickerModal) ──
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  pickerSheet: {
    backgroundColor: 'white',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 34,
  },
  pickerToolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: '#CCCCCC',
  },
  cancelBtn: {},
  okBtn: {},
  cancelText: {
    color: '#888888',
    fontSize: 16,
  },
  okText: {
    color: CALENDAR_BLUE,
    fontSize: 16,
    fontWeight: '600',
  },
  pickerTitle: {
    color: '#1A1A2E',
    fontSize: 15,
    fontWeight: '500',
  },
  modalPickerSpinner: {
    backgroundColor: 'white',
    width: '100%',
    height: 200,
  },
});
