import React, { useState } from 'react';
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
import type {
  OnboardingStackParamList,
  RePropertyTypeKey,
} from '../../navigation/types';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'RealEstateType'>;
type Route = RouteProp<OnboardingStackParamList, 'RealEstateType'>;

interface TypeOption {
  key: RePropertyTypeKey;
  title: string;
  sub: string;
}

const OPTIONS: TypeOption[] = [
  {
    key: 'long_term',
    title: 'Long-term rentals only',
    sub: 'Average stay longer than 7 days',
  },
  {
    key: 'short_term',
    title: 'Short-term rentals only',
    sub: 'Average stay 7 days or fewer',
  },
  {
    key: 'both',
    title: 'Both long-term and short-term',
    sub: 'Mixed portfolio',
  },
];

export const RealEstateTypeScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const selectedStrategies = route.params.selectedStrategies;
  // Spec calls these options multi-select. In practice they're three mutually
  // exclusive labels (long-only, short-only, both), so we treat them as
  // single-select but store the "both" case as the union of the two tracks
  // when persisting later.
  const [pick, setPick] = useState<RePropertyTypeKey | null>(null);

  const expanded: RePropertyTypeKey[] = (() => {
    if (pick === 'both') return ['long_term', 'short_term'];
    if (pick) return [pick];
    return [];
  })();

  const handleContinue = () => {
    if (!pick) return;
    const includesLongTerm = expanded.includes('long_term');
    if (includesLongTerm) {
      nav.navigate('RealEstateReps', {
        selectedStrategies,
        propertyTypes: expanded,
      });
    } else {
      // STR-only: skip REPS question, go straight to property setup.
      nav.navigate('RealEstateProperties', {
        selectedStrategies,
        propertyTypes: expanded,
        repsPursuit: null,
        totalWorkHours: null,
      });
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24 }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}>
        <Text style={styles.title}>What type of rental properties do you have?</Text>

        {OPTIONS.map((o) => {
          const active = pick === o.key;
          return (
            <Pressable
              key={o.key}
              onPress={() => setPick(o.key)}
              style={[styles.card, active && styles.cardActive]}
            >
              <View style={[styles.iconWrap, active && styles.iconWrapActive]}>
                <Ionicons
                  name={
                    o.key === 'short_term'
                      ? 'bed-outline'
                      : o.key === 'long_term'
                        ? 'home-outline'
                        : 'business-outline'
                  }
                  size={22}
                  color={active ? colors.white : colors.midNavy}
                />
              </View>
              <View style={styles.textWrap}>
                <Text style={styles.cardTitle}>{o.title}</Text>
                <Text style={styles.cardSub}>{o.sub}</Text>
              </View>
              <View
                style={[styles.radio, active && styles.radioActive]}
              >
                {active ? (
                  <Ionicons name="checkmark" size={16} color={colors.white} />
                ) : null}
              </View>
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
    marginBottom: 12,
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
    backgroundColor: colors.lightBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: colors.teal,
  },
  textWrap: { flex: 1, gap: 2 },
  cardTitle: {
    color: colors.bodyText,
    fontSize: 15,
    fontWeight: '700',
  },
  cardSub: { color: '#888888', fontSize: 12 },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: {
    backgroundColor: colors.teal,
    borderColor: colors.teal,
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
