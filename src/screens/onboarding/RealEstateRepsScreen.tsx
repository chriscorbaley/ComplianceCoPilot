import React, { useState } from 'react';
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
import type { OnboardingStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'RealEstateReps'>;
type Route = RouteProp<OnboardingStackParamList, 'RealEstateReps'>;

export const RealEstateRepsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { selectedStrategies, propertyTypes } = route.params;
  const [pursuing, setPursuing] = useState<boolean | null>(null);
  const [hoursText, setHoursText] = useState('');

  const parsedHours = (() => {
    const n = parseFloat(hoursText.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  const continueDisabled =
    pursuing === null || (pursuing === true && parsedHours === null);

  const handleContinue = () => {
    nav.navigate('RealEstateProperties', {
      selectedStrategies,
      propertyTypes,
      repsPursuit: pursuing,
      totalWorkHours: pursuing ? parsedHours : null,
    });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24 }]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
      >
        <Text style={styles.title}>
          Are you tracking your hours to qualify as a Real Estate Professional this year?
        </Text>
        <Text style={styles.subtitle}>
          Your tax advisor will have told you if this applies to you.
        </Text>

        <Pressable
          onPress={() => setPursuing(true)}
          style={[styles.card, pursuing === true && styles.cardActive]}
        >
          <View
            style={[styles.iconWrap, pursuing === true && styles.iconWrapActive]}
          >
            <Ionicons
              name="trophy-outline"
              size={22}
              color={pursuing === true ? colors.white : colors.teal}
            />
          </View>
          <View style={styles.textWrap}>
            <Text style={styles.cardTitle}>Yes — I am pursuing REPS this year</Text>
            <Text style={styles.cardSub}>Activates Gate 1 tracking</Text>
          </View>
        </Pressable>

        <Pressable
          onPress={() => setPursuing(false)}
          style={[styles.card, pursuing === false && styles.cardActive]}
        >
          <View
            style={[styles.iconWrap, pursuing === false && styles.iconWrapActive]}
          >
            <Ionicons
              name="time-outline"
              size={22}
              color={pursuing === false ? colors.white : colors.midNavy}
            />
          </View>
          <View style={styles.textWrap}>
            <Text style={styles.cardTitle}>No — I am not pursuing REPS</Text>
            <Text style={styles.cardSub}>
              Track per-property material participation only
            </Text>
          </View>
        </Pressable>

        {pursuing === true ? (
          <View style={styles.hoursBlock}>
            <Text style={styles.hoursLabel}>
              Approximately how many total hours do you work across all jobs
              and professions in a year?
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
              This figure is used to compute the 50% majority-services
              percentage in Gate 1.
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
    marginBottom: 8,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: 16,
    gap: 14,
  },
  cardActive: {
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
  textWrap: { flex: 1, gap: 2 },
  cardTitle: {
    color: colors.bodyText,
    fontSize: 15,
    fontWeight: '700',
  },
  cardSub: { color: '#888888', fontSize: 12 },
  hoursBlock: {
    marginTop: 8,
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
