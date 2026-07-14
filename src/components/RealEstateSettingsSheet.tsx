import React, { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { scaled } from '../constants/layout';
import { EditFormSheet } from './EditFormSheet';
import {
  supabase,
  requireUserId,
  type RePropertyType,
} from '../services/supabase';
import { MP_TEST_INT } from '../services/properties';
import {
  loadComplianceRules,
  ruleNumber,
  subscribeToRules,
  type ComplianceRules,
} from '../services/complianceRules';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

const PORTFOLIO_OPTIONS: Array<{ key: RePropertyType; title: string; sub: string }> = [
  { key: 'long_term', title: 'Long-Term Rental', sub: 'Average stay longer than 7 days' },
  { key: 'short_term', title: 'Short-Term Rental', sub: 'Average stay 7 days or fewer' },
  { key: 'both', title: 'Both', sub: 'Long-term and short-term properties' },
];

// The settings sheet (like onboarding) offers the three v2 tests; per-property
// setup still exposes the full set for overrides.
type GridTest = 1 | 3 | 5;

export const RealEstateSettingsSheet: React.FC<Props> = ({
  visible,
  onClose,
  onSaved,
}) => {
  const [rules, setRules] = useState<ComplianceRules | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [portfolioType, setPortfolioType] = useState<RePropertyType | null>(null);
  const [repsPursuit, setRepsPursuit] = useState<boolean>(false);
  const [mpTest, setMpTest] = useState<GridTest | null>(null);
  const [applyToAll, setApplyToAll] = useState(false);
  const [hoursText, setHoursText] = useState('');

  useEffect(() => {
    loadComplianceRules().then(setRules).catch(() => undefined);
    return subscribeToRules(setRules);
  }, []);

  // Hydrate the form from the current users row each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const uid = await requireUserId();
        const { data, error } = await supabase
          .from('users')
          .select(
            're_property_type, reps_pursuit_active, default_mp_test, total_work_hours_this_year',
          )
          .eq('id', uid)
          .maybeSingle();
        if (error) throw error;
        if (cancelled) return;
        const row = (data ?? {}) as {
          re_property_type?: RePropertyType | null;
          reps_pursuit_active?: boolean | null;
          default_mp_test?: number | null;
          total_work_hours_this_year?: number | null;
        };
        setPortfolioType(row.re_property_type ?? null);
        setRepsPursuit(row.reps_pursuit_active === true);
        setMpTest(
          row.default_mp_test === 1 || row.default_mp_test === 3 || row.default_mp_test === 5
            ? (row.default_mp_test as GridTest)
            : null,
        );
        setApplyToAll(false);
        setHoursText(
          row.total_work_hours_this_year != null
            ? String(row.total_work_hours_this_year)
            : '',
        );
      } catch (e) {
        if (!cancelled) {
          Alert.alert(
            'Could not load settings',
            e instanceof Error ? e.message : String(e),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const mp1 = ruleNumber(rules, 'real_estate', 'mp_test_1_hours', 500);
  const mp3 = ruleNumber(rules, 'real_estate', 'mp_test_3_hours', 100);
  const mp5 = ruleNumber(rules, 'real_estate', 'mp_test_5_prior_years', 5);

  const MP_CARDS: Array<{ key: GridTest; header: string; plain: string; badge: string | null; note: string | null }> = [
    {
      key: 1,
      header: `Test 1 — ${mp1} Hour Test`,
      plain: `More than ${mp1} hours managing this property each year`,
      badge: `${mp1} hrs/year`,
      note: null,
    },
    {
      key: 3,
      header: `Test 3 — ${mp3} Hour Test`,
      plain: `More than ${mp3} hours and no one else spends more time on it than you`,
      badge: `${mp3} hrs/year`,
      note: null,
    },
    {
      key: 5,
      header: 'Test 5 — Prior Years Test',
      plain: `Materially participated in at least ${mp5} of the last 10 years`,
      badge: null,
      note: 'Based on participation history',
    },
  ];

  const parsedHours = (() => {
    const trimmed = hoursText.trim();
    if (trimmed === '') return null;
    const n = parseFloat(trimmed.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const uid = await requireUserId();
      const update: Record<string, unknown> = {
        re_property_type: portfolioType,
        reps_pursuit_active: repsPursuit,
        default_mp_test: mpTest,
        total_work_hours_this_year: parsedHours,
      };
      const { error } = await supabase.from('users').update(update).eq('id', uid);
      if (error) throw error;

      // Optionally push the new default MP test onto every existing property.
      if (applyToAll && mpTest) {
        const { error: pErr } = await supabase
          .from('properties')
          .update({ mp_test_selected: MP_TEST_INT[`test_${mpTest}`] })
          .eq('user_id', uid)
          .eq('active', true);
        if (pErr) throw pErr;
      }

      onSaved?.();
      onClose();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <EditFormSheet
      title="Real Estate Settings"
      visible={visible}
      onClose={onClose}
      onSave={handleSave}
      saving={saving || loading}
      showDelete={false}
    >
      {/* Section 1 — Portfolio Type */}
      <Text style={styles.sectionLabel}>Portfolio Type</Text>
      {PORTFOLIO_OPTIONS.map((o) => {
        const active = portfolioType === o.key;
        return (
          <Pressable
            key={o.key}
            onPress={() => setPortfolioType(o.key)}
            style={[styles.toggle, active && styles.toggleActive]}
          >
            <View style={styles.toggleText}>
              <Text style={[styles.toggleTitle, active && styles.toggleTitleActive]}>
                {o.title}
              </Text>
              <Text style={[styles.toggleSub, active && styles.toggleSubActive]}>
                {o.sub}
              </Text>
            </View>
            {active ? (
              <Ionicons name="checkmark-circle" size={22} color={colors.white} />
            ) : null}
          </Pressable>
        );
      })}

      {/* Section 2 — REPS Pursuit */}
      <Text style={[styles.sectionLabel, styles.sectionSpacer]}>REPS Pursuit</Text>
      <View style={styles.repsRow}>
        <Text style={styles.repsRowLabel}>Tracking toward REPS qualification</Text>
        <View style={styles.segment}>
          {([['Off', false], ['On', true]] as Array<[string, boolean]>).map(
            ([label, val]) => {
              const active = repsPursuit === val;
              return (
                <Pressable
                  key={label}
                  onPress={() => setRepsPursuit(val)}
                  style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                >
                  <Text
                    style={[
                      styles.segmentLabel,
                      active && styles.segmentLabelActive,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            },
          )}
        </View>
      </View>

      {/* Section 3 — Default MP Test */}
      <Text style={[styles.sectionLabel, styles.sectionSpacer]}>Default MP Test</Text>
      {MP_CARDS.map((t) => {
        const active = mpTest === t.key;
        return (
          <Pressable
            key={t.key}
            onPress={() => setMpTest(t.key)}
            style={[styles.mpCard, active && styles.mpCardActive]}
          >
            {active ? (
              <View style={styles.mpCheck}>
                <Ionicons name="checkmark-circle" size={22} color={colors.teal} />
              </View>
            ) : null}
            <Text style={styles.mpHeader}>{t.header}</Text>
            <Text style={styles.mpPlain}>{t.plain}</Text>
            {t.badge ? (
              <View style={styles.pill}>
                <Text style={styles.pillText}>{t.badge}</Text>
              </View>
            ) : null}
            {t.note ? <Text style={styles.mpNote}>{t.note}</Text> : null}
          </Pressable>
        );
      })}
      <Pressable
        onPress={() => setApplyToAll((v) => !v)}
        style={styles.checkboxRow}
      >
        <View style={[styles.checkbox, applyToAll && styles.checkboxActive]}>
          {applyToAll ? (
            <Ionicons name="checkmark" size={14} color={colors.white} />
          ) : null}
        </View>
        <Text style={styles.checkboxLabel}>
          Apply this test to all existing properties
        </Text>
      </Pressable>

      {/* Section 4 — Total Annual Work Hours */}
      <Text style={[styles.sectionLabel, styles.sectionSpacer]}>
        Total Annual Work Hours
      </Text>
      <TextInput
        value={hoursText}
        onChangeText={setHoursText}
        placeholder="e.g. 2000"
        placeholderTextColor={colors.subtleText}
        keyboardType="number-pad"
        style={styles.input}
      />
      <Text style={styles.hint}>
        Used to compute the “more than 50%” REPS test and your effective hours
        target on the Hours screen and Dashboard.
      </Text>
    </EditFormSheet>
  );
};

const styles = StyleSheet.create({
  sectionLabel: {
    color: colors.mutedText,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  sectionSpacer: { marginTop: 8 },
  // Navy toggle (matches the onboarding portfolio-type toggles).
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.navy,
    paddingVertical: scaled(14),
    paddingHorizontal: 16,
  },
  toggleActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  toggleText: { flex: 1, gap: 3 },
  toggleTitle: { color: colors.navy, fontSize: 15, fontWeight: '700' },
  toggleTitleActive: { color: colors.white },
  toggleSub: { color: colors.navy, fontSize: 12, lineHeight: 16, opacity: 0.7 },
  toggleSubActive: { color: colors.white, opacity: 0.85 },
  // REPS pursuit On/Off segmented control.
  repsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  repsRowLabel: {
    flex: 1,
    color: colors.bodyText,
    fontSize: 14,
    fontWeight: '600',
  },
  segment: {
    flexDirection: 'row',
    gap: 8,
  },
  segmentBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.navy,
    backgroundColor: colors.white,
  },
  segmentBtnActive: { backgroundColor: colors.navy },
  segmentLabel: { color: colors.navy, fontSize: 13, fontWeight: '700' },
  segmentLabelActive: { color: colors.white },
  // MP test cards (match the onboarding grid).
  mpCard: {
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: '#CCCCCC',
    padding: 16,
    // Tablet touch-target scaling: overrides top/bottom padding only; the
    // `padding` shorthand still supplies horizontal padding. No-op on phones.
    paddingVertical: scaled(16),
    gap: 8,
  },
  mpCardActive: {
    borderColor: colors.teal,
    backgroundColor: colors.tealLight,
  },
  mpCheck: { position: 'absolute', top: 12, right: 12 },
  mpHeader: { color: '#042C53', fontSize: 15, fontWeight: '700', paddingRight: 28 },
  mpPlain: { color: colors.bodyText, fontSize: 13, lineHeight: 19 },
  pill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.teal,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginTop: 2,
  },
  pillText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  mpNote: { color: '#888888', fontSize: 12, fontStyle: 'italic', marginTop: 2 },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: scaled(10),
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  checkboxLabel: { flex: 1, color: colors.bodyText, fontSize: 13 },
  input: {
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: 14,
    paddingVertical: scaled(12),
    minHeight: scaled(44),
    fontSize: 16,
    color: colors.bodyText,
  },
  hint: { color: '#888888', fontSize: 12, lineHeight: 16 },
});
