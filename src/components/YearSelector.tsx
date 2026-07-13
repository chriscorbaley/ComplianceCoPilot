import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../theme';
import { useYear } from '../context/YearContext';

const DARK_AMBER_TEXT = '#633806';

interface YearSelectorProps {
  // Optional wrapper style override (e.g. margins for a specific screen).
  style?: ViewStyle;
}

// Compact tax-year selector shown at the top of the year-aware screens (Hours,
// Mileage, Documents, Business Travel history, Minutes). Renders a pill showing
// the selected year that opens a dropdown of the current + 3 prior years, and an
// amber banner whenever a prior year is selected.
export const YearSelector: React.FC<YearSelectorProps> = ({ style }) => {
  const { year, setYear, options, isCurrentYear } = useYear();
  const [open, setOpen] = useState(false);

  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.row}>
        <Text style={styles.label}>Tax Year</Text>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setOpen(true)}
          style={styles.pill}
          accessibilityRole="button"
          accessibilityLabel={`Change tax year, currently ${year}`}
        >
          <Ionicons name="calendar-outline" size={14} color={colors.navy} />
          <Text style={styles.pillText}>{year}</Text>
          <Ionicons name="chevron-down" size={14} color={colors.navy} />
        </TouchableOpacity>
      </View>

      {!isCurrentYear ? (
        <View style={styles.banner}>
          <Ionicons name="information-circle" size={14} color={DARK_AMBER_TEXT} />
          <Text style={styles.bannerText}>
            Viewing {year} data — not current year
          </Text>
        </View>
      ) : null}

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.sheetTitle}>Select tax year</Text>
            {options.map((y) => {
              const active = y === year;
              return (
                <TouchableOpacity
                  key={y}
                  activeOpacity={0.8}
                  onPress={() => {
                    setYear(y);
                    setOpen(false);
                  }}
                  style={[styles.option, active && styles.optionActive]}
                >
                  <Text
                    style={[styles.optionText, active && styles.optionTextActive]}
                  >
                    {y}
                  </Text>
                  {active ? (
                    <Ionicons name="checkmark" size={18} color={colors.teal} />
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

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    ...typography.caption,
    color: colors.mutedText,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  pillText: {
    ...typography.bodyMedium,
    color: colors.navy,
    fontWeight: '700',
    fontSize: 14,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
    backgroundColor: colors.amberLight,
    borderWidth: 1,
    borderColor: colors.amber,
    borderRadius: radius.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bannerText: {
    ...typography.caption,
    color: DARK_AMBER_TEXT,
    fontWeight: '700',
    fontSize: 12,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  sheet: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  sheetTitle: {
    ...typography.h3,
    color: colors.bodyText,
    marginBottom: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.card,
  },
  optionActive: {
    backgroundColor: colors.tealLight,
  },
  optionText: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 15,
  },
  optionTextActive: {
    color: colors.teal,
    fontWeight: '700',
  },
});
