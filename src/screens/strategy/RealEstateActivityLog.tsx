// Real Estate audit-ready activity log screen. Shows every logged activity in
// a grouped, audit-review table with a year selector, a From/To date-range
// filter, and an export button that produces a shareable plain-text document.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { colors, radius, shadow, spacing, typography } from '../../theme';
import { ActivityLogTable } from '../../components/ActivityLogTable';
import { StatusPill } from '../../components/StatusPill';
import { useAuth } from '../../auth/AuthContext';
import { useBusiness } from '../../business/BusinessContext';
import {
  buildExportHtml,
  fetchActivityLog,
  getRepsThreshold,
  groupByProperty,
  repsStatus,
  shareActivityLogPdf,
  toIsoDate,
  type GroupedActivityLog,
} from '../../services/activityLog';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const EMPTY_GROUPED: GroupedActivityLog = { groups: [], grandTotalHours: 0 };

const currentYear = (): number => new Date().getFullYear();

// Default range for a tax year: Jan 1 → today (current year) or Dec 31 (prior).
const defaultRange = (year: number): { from: Date; to: Date } => {
  const from = new Date(year, 0, 1);
  const now = new Date();
  const to = year === now.getFullYear() ? now : new Date(year, 11, 31);
  return { from, to };
};

const formatHuman = (d: Date): string =>
  `${MONTH_SHORT[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')} ${d.getFullYear()}`;

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'info'> = {
  Qualified: 'success',
  'On Track': 'info',
  'Needs Attention': 'warning',
};

export const RealEstateActivityLog: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { session, fullName } = useAuth();
  const { activeBusinessId } = useBusiness();
  const userId = session?.user?.id ?? null;

  const [year, setYear] = useState<number>(currentYear());
  const initial = defaultRange(currentYear());
  const [fromDate, setFromDate] = useState<Date>(initial.from);
  const [toDate, setToDate] = useState<Date>(initial.to);

  const [grouped, setGrouped] = useState<GroupedActivityLog>(EMPTY_GROUPED);
  const [threshold, setThreshold] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [yearOpen, setYearOpen] = useState(false);
  const [picker, setPicker] = useState<null | 'from' | 'to'>(null);

  const yearOptions = useMemo(() => {
    const top = currentYear();
    return Array.from({ length: 7 }, (_, i) => top - i);
  }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const entries = await fetchActivityLog({
        userId,
        businessId: activeBusinessId,
        fromDate: toIsoDate(fromDate),
        toDate: toIsoDate(toDate),
      });
      setGrouped(groupByProperty(entries));
    } catch (e) {
      Alert.alert('Could not load activity log', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [userId, activeBusinessId, fromDate, toDate]);

  useEffect(() => {
    load();
  }, [load]);

  // Threshold comes from compliance_rules — refresh it whenever the screen
  // regains focus so admin changes flow through.
  useFocusEffect(
    useCallback(() => {
      getRepsThreshold()
        .then(setThreshold)
        .catch(() => undefined);
    }, []),
  );

  const onSelectYear = (y: number) => {
    setYear(y);
    const range = defaultRange(y);
    setFromDate(range.from);
    setToDate(range.to);
    setYearOpen(false);
  };

  const onReset = () => {
    const range = defaultRange(year);
    setFromDate(range.from);
    setToDate(range.to);
  };

  const status = useMemo(
    () => repsStatus(grouped.grandTotalHours, threshold, year),
    [grouped.grandTotalHours, threshold, year],
  );

  const onExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const html = buildExportHtml({
        clientName: fullName ?? 'Client',
        year,
        generatedDate: formatHuman(new Date()),
        grouped,
        threshold,
      });
      await shareActivityLogPdf(html);
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.introCard}>
        <Text style={styles.introTitle}>Activity Log</Text>
        <Text style={styles.introBody}>
          A contemporaneous, audit-ready record of every logged real estate
          activity. Filter by tax year and date range, then export a shareable
          document for your tax advisor or an IRS examination.
        </Text>
      </View>

      {/* Year selector + Export */}
      <View style={styles.controlsRow}>
        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.yearDropdown}
          onPress={() => setYearOpen(true)}
        >
          <Text style={styles.yearLabel}>Tax Year</Text>
          <View style={styles.yearValueRow}>
            <Text style={styles.yearValue}>{year}</Text>
            <Ionicons name="chevron-down" size={16} color={colors.navy} />
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.exportBtn, exporting && styles.exportBtnDisabled]}
          onPress={onExport}
          disabled={exporting}
        >
          {exporting ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Ionicons name="download-outline" size={18} color={colors.white} />
          )}
          <Text style={styles.exportBtnText}>
            {exporting ? 'Preparing export…' : 'Export Activity Log'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Date range filter */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.dateField}
          onPress={() => setPicker('from')}
        >
          <Text style={styles.dateFieldLabel}>From</Text>
          <Text style={styles.dateFieldValue}>{formatHuman(fromDate)}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.dateField}
          onPress={() => setPicker('to')}
        >
          <Text style={styles.dateFieldLabel}>To</Text>
          <Text style={styles.dateFieldValue}>{formatHuman(toDate)}</Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.8} style={styles.resetBtn} onPress={onReset}>
          <Ionicons name="refresh" size={16} color={colors.navy} />
          <Text style={styles.resetBtnText}>Reset</Text>
        </TouchableOpacity>
      </View>

      {/* Status summary */}
      <View style={styles.statusRow}>
        <Text style={styles.statusText}>
          {grouped.grandTotalHours.toFixed(1)} of {threshold || '—'} REPS hours
        </Text>
        <StatusPill label={status} variant={STATUS_VARIANT[status] ?? 'info'} />
      </View>

      {loading ? (
        <View style={styles.loadingCard}>
          <ActivityIndicator size="small" color={colors.midNavy} />
        </View>
      ) : (
        <ActivityLogTable grouped={grouped} />
      )}

      <YearPickerModal
        visible={yearOpen}
        years={yearOptions}
        selected={year}
        onSelect={onSelectYear}
        onClose={() => setYearOpen(false)}
      />

      <DatePickerModal
        visible={picker !== null}
        title={picker === 'from' ? 'From date' : 'To date'}
        value={picker === 'from' ? fromDate : toDate}
        onCancel={() => setPicker(null)}
        onConfirm={(d) => {
          if (picker === 'from') setFromDate(d);
          else if (picker === 'to') setToDate(d);
          setPicker(null);
        }}
      />
    </ScrollView>
  );
};

// ── Year picker ───────────────────────────────────────────────────────────

interface YearPickerModalProps {
  visible: boolean;
  years: number[];
  selected: number;
  onSelect: (y: number) => void;
  onClose: () => void;
}

const YearPickerModal: React.FC<YearPickerModalProps> = ({
  visible,
  years,
  selected,
  onSelect,
  onClose,
}) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <TouchableOpacity style={modal.backdrop} activeOpacity={1} onPress={onClose}>
      <View style={modal.menu}>
        <Text style={modal.menuTitle}>Select tax year</Text>
        {years.map((y) => {
          const active = y === selected;
          return (
            <TouchableOpacity
              key={y}
              activeOpacity={0.8}
              style={[modal.menuItem, active && modal.menuItemActive]}
              onPress={() => onSelect(y)}
            >
              <Text style={[modal.menuItemText, active && modal.menuItemTextActive]}>
                {y}
              </Text>
              {active ? (
                <Ionicons name="checkmark" size={18} color={colors.white} />
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </TouchableOpacity>
  </Modal>
);

// ── Date picker (Month / Day / Year scroll columns) ─────────────────────────

interface DatePickerModalProps {
  visible: boolean;
  title: string;
  value: Date;
  onCancel: () => void;
  onConfirm: (d: Date) => void;
}

const daysInMonth = (year: number, monthIdx: number): number =>
  new Date(year, monthIdx + 1, 0).getDate();

const DatePickerModal: React.FC<DatePickerModalProps> = ({
  visible,
  title,
  value,
  onCancel,
  onConfirm,
}) => {
  const [m, setM] = useState(value.getMonth());
  const [d, setD] = useState(value.getDate());
  const [y, setY] = useState(value.getFullYear());

  // Re-sync the columns whenever a different field is opened.
  useEffect(() => {
    if (visible) {
      setM(value.getMonth());
      setD(value.getDate());
      setY(value.getFullYear());
    }
  }, [visible, value]);

  const yearChoices = useMemo(() => {
    const top = new Date().getFullYear();
    return Array.from({ length: 8 }, (_, i) => top - i);
  }, []);

  const maxDay = daysInMonth(y, m);
  const dayChoices = useMemo(
    () => Array.from({ length: maxDay }, (_, i) => i + 1),
    [maxDay],
  );
  const safeDay = Math.min(d, maxDay);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={modal.sheetBackdrop}>
        <View style={modal.sheet}>
          <Text style={modal.sheetTitle}>{title}</Text>
          <View style={modal.columns}>
            <ScrollView style={modal.col} showsVerticalScrollIndicator={false}>
              {MONTHS.map((name, idx) => (
                <TouchableOpacity
                  key={name}
                  style={[modal.option, idx === m && modal.optionActive]}
                  onPress={() => setM(idx)}
                >
                  <Text style={[modal.optionText, idx === m && modal.optionTextActive]}>
                    {name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <ScrollView style={modal.colNarrow} showsVerticalScrollIndicator={false}>
              {dayChoices.map((day) => (
                <TouchableOpacity
                  key={day}
                  style={[modal.option, day === safeDay && modal.optionActive]}
                  onPress={() => setD(day)}
                >
                  <Text style={[modal.optionText, day === safeDay && modal.optionTextActive]}>
                    {day}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <ScrollView style={modal.colNarrow} showsVerticalScrollIndicator={false}>
              {yearChoices.map((yr) => (
                <TouchableOpacity
                  key={yr}
                  style={[modal.option, yr === y && modal.optionActive]}
                  onPress={() => setY(yr)}
                >
                  <Text style={[modal.optionText, yr === y && modal.optionTextActive]}>
                    {yr}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          <View style={modal.sheetActions}>
            <TouchableOpacity style={modal.cancelBtn} onPress={onCancel}>
              <Text style={modal.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={modal.confirmBtn}
              onPress={() => onConfirm(new Date(y, m, safeDay))}
            >
              <Text style={modal.confirmBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  introCard: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    ...shadow.card,
  },
  introTitle: {
    ...typography.h2,
    color: colors.bodyText,
    fontSize: 17,
    fontWeight: '700',
  },
  introBody: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.xs,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
  },
  yearDropdown: {
    backgroundColor: colors.white,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: '#CCCCCC',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
    minWidth: 110,
  },
  yearLabel: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  yearValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
  },
  yearValue: {
    ...typography.h3,
    color: colors.navy,
    fontSize: 18,
    fontWeight: '700',
  },
  exportBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    ...shadow.raised,
  },
  exportBtnDisabled: {
    opacity: 0.7,
  },
  exportBtnText: {
    ...typography.bodyMedium,
    color: colors.white,
    fontWeight: '700',
    fontSize: 13,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
  },
  dateField: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: '#CCCCCC',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  dateFieldLabel: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  dateFieldValue: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.white,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.navy,
    paddingHorizontal: spacing.md,
  },
  resetBtnText: {
    ...typography.bodyMedium,
    color: colors.navy,
    fontWeight: '700',
    fontSize: 13,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  statusText: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 13,
    fontWeight: '700',
  },
  loadingCard: {
    backgroundColor: colors.white,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: '#CCCCCC',
    paddingVertical: spacing.xxl,
    alignItems: 'center',
  },
});

const modal = StyleSheet.create({
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
  col: {
    flex: 2,
  },
  colNarrow: {
    flex: 1,
  },
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
