import React, { useEffect, useState } from 'react';
import {
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
import {
  loadComplianceRules,
  ruleNumber,
  subscribeToRules,
  type ComplianceRules,
} from '../../services/complianceRules';
import type { OnboardingStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'RealEstateReps'>;
type Route = RouteProp<OnboardingStackParamList, 'RealEstateReps'>;

export const RealEstateRepsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { selectedStrategies, portfolioType, defaultMpTest, propertyTypes } =
    route.params;
  const [pursuing, setPursuing] = useState<boolean | null>(null);
  const [hoursText, setHoursText] = useState('');
  const [rules, setRules] = useState<ComplianceRules | null>(null);

  useEffect(() => {
    loadComplianceRules().then(setRules).catch(() => undefined);
    return subscribeToRules(setRules);
  }, []);

  // Thresholds for the requirement descriptions — read from compliance_rules.
  const reps750 = ruleNumber(rules, 'real_estate', 'reps_gate1_hours', 750);
  const majorityPct = ruleNumber(rules, 'real_estate', 'reps_majority_services_pct', 50);
  const mp1 = ruleNumber(rules, 'real_estate', 'mp_test_1_hours', 500);
  const mp3 = ruleNumber(rules, 'real_estate', 'mp_test_3_hours', 100);

  const parsedHours = (() => {
    const n = parseFloat(hoursText.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  const continueDisabled =
    pursuing === null || (pursuing === true && parsedHours === null);

  const handleContinue = () => {
    if (continueDisabled) return;
    nav.navigate('RealEstateProperties', {
      selectedStrategies,
      portfolioType,
      defaultMpTest,
      propertyTypes,
      repsPursuit: pursuing,
      totalWorkHours: pursuing ? parsedHours : null,
    });
  };

  const REQUIREMENTS: Array<{ header: string; desc: string; note: string }> = [
    {
      header: 'More Than 50% Test',
      desc: `You must spend more than ${majorityPct}% of your total working hours during the tax year performing services in real estate trades or businesses.`,
      note: 'The app tracks this automatically using your logged RE hours vs your total annual work hours',
    },
    {
      header: `${reps750}-Hour Test`,
      desc: `You must devote more than ${reps750} hours of services to real estate trades or businesses during the tax year.`,
      note: 'The app tracks your cumulative RE hours toward this goal',
    },
    {
      header: 'Material Participation Test',
      desc: `You must actively and regularly manage or operate your real property trades. This means logging over ${mp1} hours in an activity, or spending more than ${mp3} hours on a single property where no one else works more than you.`,
      note: 'Tracked per property using the MP test you selected',
    },
  ];

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24 }]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
      >
        <Text style={styles.title}>
          Real Estate Professional Status (REPS) Qualification
        </Text>
        <Text style={styles.subtitle}>
          To qualify as a Real Estate Professional you must satisfy ALL three of
          the following tests
        </Text>

        {REQUIREMENTS.map((r) => (
          <View key={r.header} style={styles.infoCard}>
            <Text style={styles.infoHeader}>{r.header}</Text>
            <Text style={styles.infoDesc}>{r.desc}</Text>
            <View style={styles.noteRow}>
              <Ionicons
                name="checkmark-circle"
                size={15}
                color={colors.teal}
                style={{ marginTop: 1 }}
              />
              <Text style={styles.infoNote}>{r.note}</Text>
            </View>
          </View>
        ))}

        <Text style={styles.question}>
          Are you actively pursuing REPS qualification this tax year?
        </Text>

        <Pressable
          onPress={() => setPursuing(true)}
          style={[styles.choice, pursuing === true && styles.choiceActive]}
        >
          <View style={[styles.iconWrap, pursuing === true && styles.iconWrapActive]}>
            <Ionicons
              name="trophy-outline"
              size={22}
              color={pursuing === true ? colors.white : colors.teal}
            />
          </View>
          <Text style={styles.choiceText}>Yes — track my REPS qualification</Text>
        </Pressable>

        <Pressable
          onPress={() => setPursuing(false)}
          style={[styles.choice, pursuing === false && styles.choiceActive]}
        >
          <View style={[styles.iconWrap, pursuing === false && styles.iconWrapActive]}>
            <Ionicons
              name="time-outline"
              size={22}
              color={pursuing === false ? colors.white : colors.midNavy}
            />
          </View>
          <Text style={styles.choiceText}>No — track material participation only</Text>
        </Pressable>

        {pursuing === true ? (
          <View style={styles.hoursBlock}>
            <Text style={styles.hoursLabel}>
              Approximately how many total hours do you work across all jobs and
              professions in a year?
            </Text>
            <TextInput
              value={hoursText}
              onChangeText={setHoursText}
              placeholder="e.g. 2000"
              placeholderTextColor={colors.subtleText}
              keyboardType="number-pad"
              style={styles.input}
            />
            <Text style={styles.hoursHint}>
              This figure is used to compute the {majorityPct}% majority-services
              test on your Hours screen.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleContinue}
          disabled={continueDisabled}
          style={[styles.btn, continueDisabled && styles.btnDisabled]}
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
    fontSize: 21,
    fontWeight: '700',
    lineHeight: 28,
  },
  subtitle: {
    color: '#888888',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 4,
  },
  // Information card: navy left border + light blue background. Not selectable.
  infoCard: {
    backgroundColor: colors.lightBlue,
    borderLeftWidth: 4,
    borderLeftColor: colors.navy,
    borderRadius: 12,
    padding: 16,
    gap: 6,
  },
  infoHeader: {
    color: '#042C53',
    fontSize: 15,
    fontWeight: '700',
  },
  infoDesc: {
    color: colors.bodyText,
    fontSize: 13,
    lineHeight: 19,
  },
  noteRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 2,
  },
  infoNote: {
    flex: 1,
    color: colors.teal,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  question: {
    color: '#042C53',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
    marginTop: 8,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: 16,
    gap: 14,
  },
  choiceActive: {
    borderColor: colors.teal,
    borderWidth: 2,
    backgroundColor: colors.tealLight,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.tealLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: { backgroundColor: colors.teal },
  choiceText: {
    flex: 1,
    color: colors.bodyText,
    fontSize: 15,
    fontWeight: '700',
  },
  hoursBlock: {
    marginTop: 4,
    gap: 8,
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: 16,
  },
  hoursLabel: {
    color: colors.bodyText,
    fontSize: 14,
    lineHeight: 20,
  },
  input: {
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.bodyText,
  },
  hoursHint: {
    color: '#888888',
    fontSize: 12,
    lineHeight: 16,
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
