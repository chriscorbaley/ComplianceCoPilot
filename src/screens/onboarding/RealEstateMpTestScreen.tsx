import React, { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme';
import {
  loadComplianceRules,
  ruleNumber,
  subscribeToRules,
  type ComplianceRules,
} from '../../services/complianceRules';
import type { MpTestKey, PropertyType } from '../../services/supabase';
import type {
  OnboardingStackParamList,
  RePropertyTypeKey,
} from '../../navigation/types';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'RealEstateMpTest'>;
type Route = RouteProp<OnboardingStackParamList, 'RealEstateMpTest'>;

// The grid only offers the three tests in the v2 onboarding spec. Per-property
// setup still exposes the full MP_TEST_ORDER for overrides.
type GridTestKey = Extract<MpTestKey, 'test_1' | 'test_3' | 'test_5'>;

const expandPropertyTypes = (t: RePropertyTypeKey): PropertyType[] =>
  t === 'both' ? ['long_term', 'short_term'] : [t];

export const RealEstateMpTestScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { selectedStrategies, portfolioType } = route.params;
  const [pick, setPick] = useState<GridTestKey | null>(null);
  const [rules, setRules] = useState<ComplianceRules | null>(null);

  useEffect(() => {
    loadComplianceRules().then(setRules).catch(() => undefined);
    return subscribeToRules(setRules);
  }, []);

  // All thresholds come from compliance_rules — never hardcoded.
  const mp1 = ruleNumber(rules, 'real_estate', 'mp_test_1_hours', 500);
  const mp3 = ruleNumber(rules, 'real_estate', 'mp_test_3_hours', 100);
  const mp5 = ruleNumber(rules, 'real_estate', 'mp_test_5_prior_years', 5);

  const TESTS: Array<{
    key: GridTestKey;
    header: string;
    plain: string;
    badge: string | null;
    note: string | null;
  }> = [
    {
      key: 'test_1',
      header: `Test 1 — ${mp1} Hour Test`,
      plain: `I spend more than ${mp1} hours managing this property each year`,
      badge: `${mp1} hrs/year`,
      note: null,
    },
    {
      key: 'test_3',
      header: `Test 3 — ${mp3} Hour Test`,
      plain: `I spend more than ${mp3} hours and no one else spends more time on it than I do`,
      badge: `${mp3} hrs/year`,
      note: null,
    },
    {
      key: 'test_5',
      header: 'Test 5 — Prior Years Test',
      plain: `I materially participated in this property in at least ${mp5} of the last 10 years`,
      badge: null,
      note: 'Based on participation history',
    },
  ];

  const handleContinue = () => {
    if (!pick) return;
    const propertyTypes = expandPropertyTypes(portfolioType);
    if (portfolioType === 'short_term') {
      // STR-only: skip the REPS qualification screen.
      nav.navigate('RealEstateProperties', {
        selectedStrategies,
        portfolioType,
        defaultMpTest: pick,
        propertyTypes,
        repsPursuit: null,
        totalWorkHours: null,
      });
    } else {
      nav.navigate('RealEstateReps', {
        selectedStrategies,
        portfolioType,
        defaultMpTest: pick,
        propertyTypes,
      });
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24 }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}>
        <Text style={styles.title}>Select Your Material Participation Test</Text>
        <Text style={styles.subtitle}>
          Choose the test your tax advisor has recommended for your rental
          properties
        </Text>

        {TESTS.map((t) => {
          const active = pick === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => setPick(t.key)}
              style={[styles.card, active && styles.cardActive]}
            >
              {active ? (
                <View style={styles.check}>
                  <Ionicons name="checkmark-circle" size={22} color={colors.teal} />
                </View>
              ) : null}
              <Text style={styles.cardHeader}>{t.header}</Text>
              <Text style={styles.cardPlain}>{t.plain}</Text>
              {t.badge ? (
                <View style={styles.pill}>
                  <Text style={styles.pillText}>{t.badge}</Text>
                </View>
              ) : null}
              {t.note ? <Text style={styles.cardNote}>{t.note}</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleContinue}
          disabled={!pick}
          style={[styles.btn, !pick && styles.btnDisabled]}
        >
          <Text style={styles.btnText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, gap: 12 },
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
  card: {
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: '#CCCCCC',
    padding: 16,
    gap: 8,
  },
  cardActive: {
    borderColor: colors.teal,
    borderWidth: 0.5,
    backgroundColor: colors.tealLight,
  },
  check: {
    position: 'absolute',
    top: 12,
    right: 12,
  },
  cardHeader: {
    color: '#042C53',
    fontSize: 15,
    fontWeight: '700',
    paddingRight: 28,
  },
  cardPlain: {
    color: colors.bodyText,
    fontSize: 13,
    lineHeight: 19,
  },
  pill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.teal,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginTop: 2,
  },
  pillText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '700',
  },
  cardNote: {
    color: '#888888',
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 2,
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
