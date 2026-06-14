import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme';
import { useAuth } from '../../auth/AuthContext';
import { MP_TEST_SETUP_ORDER, mpTestSetupLabel } from '../../services/properties';
import {
  loadComplianceRules,
  ruleNumber,
  subscribeToRules,
  type ComplianceRules,
} from '../../services/complianceRules';
import type { OnboardingStackParamList } from '../../navigation/types';
import { supabase, type MpTestKey, type PropertyType } from '../../services/supabase';

// The properties.mp_test_selected column is an integer in Postgres, while the
// app models the choice as a string key for readability. Map at the boundary.
const MP_TEST_INT: Record<MpTestKey, number> = {
  test_1: 1,
  test_2: 2,
  test_3: 3,
  test_4: 4,
  test_5: 5,
  test_7: 7,
};

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'RealEstateProperties'>;
type Route = RouteProp<OnboardingStackParamList, 'RealEstateProperties'>;

interface DraftProperty {
  localId: string;
  nickname: string;
  // Tracks which class of rental this is. If the user selected both long-
  // and short-term on RE-1, each draft can be either; if they selected only
  // one class, this is pre-locked.
  type: PropertyType;
  mpTest: MpTestKey | null;
}

const newDraft = (
  defaultType: PropertyType,
  defaultMpTest: MpTestKey | null,
): DraftProperty => ({
  localId: Math.random().toString(36).slice(2),
  nickname: '',
  type: defaultType,
  // Pre-fill the MP test chosen during onboarding; still overridable per card.
  mpTest: defaultMpTest,
});

export const RealEstatePropertiesScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { session } = useAuth();
  const {
    selectedStrategies,
    portfolioType,
    defaultMpTest,
    propertyTypes,
    repsPursuit,
    totalWorkHours,
  } = route.params;

  const defaultType: PropertyType = propertyTypes.includes('long_term')
    ? 'long_term'
    : 'short_term';
  const allowToggle = propertyTypes.length > 1; // "both" case

  const [drafts, setDrafts] = useState<DraftProperty[]>([
    newDraft(defaultType, defaultMpTest),
  ]);
  const [saving, setSaving] = useState(false);
  const [rules, setRules] = useState<ComplianceRules | null>(null);

  useEffect(() => {
    loadComplianceRules().then(setRules).catch(() => undefined);
    return subscribeToRules(setRules);
  }, []);

  // The three setup tests with thresholds sourced from compliance_rules.
  const mpOptions = useMemo(() => {
    const nums = {
      mp1: ruleNumber(rules, 'real_estate', 'mp_test_1_hours', 500),
      mp3: ruleNumber(rules, 'real_estate', 'mp_test_3_hours', 100),
      mp5: ruleNumber(rules, 'real_estate', 'mp_test_5_prior_years', 5),
    };
    return MP_TEST_SETUP_ORDER.map((key) => ({
      key,
      label: mpTestSetupLabel(key, nums),
    }));
  }, [rules]);

  const valid = useMemo(
    () =>
      drafts.length > 0 &&
      drafts.every((d) => d.nickname.trim().length > 0 && d.mpTest !== null),
    [drafts],
  );

  const addDraft = () =>
    setDrafts((p) => [...p, newDraft(defaultType, defaultMpTest)]);

  const removeDraft = (id: string) =>
    setDrafts((p) => (p.length === 1 ? p : p.filter((d) => d.localId !== id)));

  const patchDraft = (id: string, patch: Partial<DraftProperty>) =>
    setDrafts((p) => p.map((d) => (d.localId === id ? { ...d, ...patch } : d)));

  const handleContinue = async () => {
    if (!session?.user.id || !valid) return;
    setSaving(true);
    try {
      for (const d of drafts) {
        const propertyName = d.nickname.trim();
        const propertyType: PropertyType = d.type;
        const mpTestSelected: number | null =
          d.mpTest ? MP_TEST_INT[d.mpTest] : null;

        const { error } = await supabase
          .from('properties')
          .insert({
            user_id: session.user.id,
            property_name: propertyName,
            property_type: propertyType,
            mp_test_selected: mpTestSelected,
            grouping_election: false,
            active: true,
          });

        if (error) {
          console.error('[RealEstateProperties] insert failed', {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint,
          });
          const parts = [
            error.message,
            error.code ? `(code ${error.code})` : null,
            error.hint ? `Hint: ${error.hint}` : null,
            error.details ? `Details: ${error.details}` : null,
          ].filter(Boolean);
          throw new Error(
            parts.length > 0 ? parts.join(' — ') : 'Could not save property',
          );
        }
      }

      const longTermCount = drafts.filter((d) => d.type === 'long_term').length;
      if (longTermCount >= 2) {
        nav.navigate('RealEstateGrouping', {
          selectedStrategies,
          portfolioType,
          defaultMpTest,
          propertyTypes,
          repsPursuit,
          totalWorkHours,
          propertyCount: drafts.length,
        });
      } else {
        nav.navigate('RealEstateComplete', {
          selectedStrategies,
          portfolioType,
          defaultMpTest,
          propertyTypes,
          repsPursuit,
          totalWorkHours,
          grouping: null,
        });
      }
    } catch (err) {
      console.error('[RealEstateProperties] save failed', err);
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null
            ? // Pull readable fields off a raw Supabase/Postgrest error before
              // falling back to JSON so we never alert "[object Object]".
              [
                (err as { message?: string }).message,
                (err as { code?: string }).code
                  ? `(code ${(err as { code?: string }).code})`
                  : null,
                (err as { hint?: string }).hint
                  ? `Hint: ${(err as { hint?: string }).hint}`
                  : null,
                (err as { details?: string }).details
                  ? `Details: ${(err as { details?: string }).details}`
                  : null,
              ]
                .filter(Boolean)
                .join(' — ') || JSON.stringify(err)
            : String(err);
      Alert.alert('Could not save property', msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={{ paddingTop: insets.top + 16 }} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
      >
        <Text style={styles.title}>Add your rental properties</Text>
        <Text style={styles.subtitle}>Add each property you want to track</Text>

        {drafts.map((d, idx) => (
          <PropertyDraftCard
            key={d.localId}
            index={idx}
            draft={d}
            allowToggle={allowToggle}
            allowRemove={drafts.length > 1}
            mpOptions={mpOptions}
            onPatch={(patch) => patchDraft(d.localId, patch)}
            onRemove={() => removeDraft(d.localId)}
          />
        ))}

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={addDraft}
          style={styles.addBtn}
        >
          <Ionicons name="add-circle-outline" size={20} color={colors.midNavy} />
          <Text style={styles.addBtnText}>Add Another Property</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleContinue}
          disabled={!valid || saving}
          style={[styles.btn, (!valid || saving) && styles.btnDisabled]}
        >
          {saving ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.btnText}>Continue</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

interface DraftCardProps {
  index: number;
  draft: DraftProperty;
  allowToggle: boolean;
  allowRemove: boolean;
  mpOptions: Array<{ key: MpTestKey; label: string }>;
  onPatch: (patch: Partial<DraftProperty>) => void;
  onRemove: () => void;
}

const PropertyDraftCard: React.FC<DraftCardProps> = ({
  index,
  draft,
  allowToggle,
  allowRemove,
  mpOptions,
  onPatch,
  onRemove,
}) => {
  return (
    <View style={styles.draftCard}>
      <View style={styles.draftHeader}>
        <Text style={styles.draftTitle}>Property {index + 1}</Text>
        {allowRemove ? (
          <TouchableOpacity
            onPress={onRemove}
            hitSlop={8}
            style={styles.removeBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="trash-outline" size={18} color={colors.amber} />
          </TouchableOpacity>
        ) : null}
      </View>

      <Text style={styles.fieldLabel}>Nickname</Text>
      <TextInput
        value={draft.nickname}
        onChangeText={(v) => onPatch({ nickname: v })}
        placeholder="e.g. Scottsdale House or Unit 4B"
        placeholderTextColor={colors.subtleText}
        style={styles.input}
      />

      {allowToggle ? (
        <View style={styles.toggleRow}>
          {(['long_term', 'short_term'] as PropertyType[]).map((t) => {
            const active = draft.type === t;
            return (
              <Pressable
                key={t}
                onPress={() => onPatch({ type: t })}
                style={[styles.toggleChip, active && styles.toggleChipActive]}
              >
                <Text
                  style={[
                    styles.toggleChipText,
                    active && styles.toggleChipTextActive,
                  ]}
                >
                  {t === 'long_term' ? 'Long-term' : 'Short-term'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text style={styles.fixedTypeLabel}>
          {draft.type === 'long_term' ? 'Long-term rental' : 'Short-term rental'}
        </Text>
      )}

      <Text style={styles.fieldLabel}>Material Participation Test</Text>
      <View style={styles.mpList}>
        {mpOptions.map((opt) => {
          const active = draft.mpTest === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              activeOpacity={0.85}
              style={[styles.mpRow, active && styles.mpRowActive]}
              onPress={() => onPatch({ mpTest: opt.key })}
            >
              <View style={[styles.mpDot, active && styles.mpDotActive]} />
              <Text style={styles.mpText}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, gap: 16 },
  title: {
    color: '#042C53',
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    color: '#888888',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 4,
  },
  draftCard: {
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: 16,
    gap: 10,
  },
  draftHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  draftTitle: {
    flex: 1,
    color: '#042C53',
    fontSize: 15,
    fontWeight: '700',
  },
  removeBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: colors.amberLight,
  },
  fieldLabel: {
    color: colors.mutedText,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 6,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.bodyText,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  toggleChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.white,
    alignItems: 'center',
  },
  toggleChipActive: {
    backgroundColor: colors.midNavy,
    borderColor: colors.midNavy,
  },
  toggleChipText: {
    color: colors.bodyText,
    fontSize: 13,
    fontWeight: '600',
  },
  toggleChipTextActive: {
    color: colors.white,
  },
  fixedTypeLabel: {
    color: colors.mutedText,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  mpList: { gap: 8 },
  mpRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: 12,
  },
  mpRowActive: {
    borderColor: colors.teal,
    borderWidth: 2,
    backgroundColor: colors.tealLight,
  },
  mpDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.divider,
    marginTop: 2,
  },
  mpDotActive: { borderColor: colors.teal, backgroundColor: colors.teal },
  mpText: {
    flex: 1,
    color: colors.bodyText,
    fontSize: 13,
    lineHeight: 18,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.midNavy,
    backgroundColor: colors.lightBlue,
  },
  addBtnText: {
    color: colors.midNavy,
    fontSize: 14,
    fontWeight: '700',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  btn: {
    backgroundColor: '#042C53',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  btnDisabled: { backgroundColor: '#C7CDD3' },
  btnText: { color: colors.white, fontSize: 15, fontWeight: '700' },
});
