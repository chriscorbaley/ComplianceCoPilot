import React, { useMemo, useState } from 'react';
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
import { contentContainerStyle } from '../../constants/layout';
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
    title: 'Long-Term Rental',
    sub: 'Average stay longer than 7 days',
  },
  {
    key: 'short_term',
    title: 'Short-Term Rental',
    sub: 'Average stay 7 days or fewer',
  },
  {
    key: 'both',
    title: 'My portfolio contains both',
    sub: 'I have both long-term and short-term rental properties',
  },
];

export const RealEstateTypeScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const selectedStrategies = route.params.selectedStrategies;
  const [pick, setPick] = useState<RePropertyTypeKey | null>(null);

  // The portfolio type selection is carried through the flow and persisted
  // (as users.re_property_type) on the final completion screen, alongside the
  // other RE onboarding flags.
  const portfolioType = useMemo(() => pick, [pick]);

  const handleContinue = () => {
    if (!portfolioType) return;
    nav.navigate('RealEstateMpTest', {
      selectedStrategies,
      portfolioType,
    });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24 }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}>
        <View style={[contentContainerStyle, { gap: 12 }]}>
        <Text style={styles.title}>
          What is your Real Estate portfolio property type?
        </Text>

        {OPTIONS.map((o) => {
          const active = pick === o.key;
          return (
            <Pressable
              key={o.key}
              onPress={() => setPick(o.key)}
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
        </View>
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
  // App toggle style (matches the Domestic/International segments): navy fill +
  // white text when selected, white fill + navy border + navy text otherwise.
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.navy,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  toggleActive: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  toggleText: { flex: 1, gap: 3 },
  toggleTitle: {
    color: colors.navy,
    fontSize: 15,
    fontWeight: '700',
  },
  toggleTitleActive: { color: colors.white },
  toggleSub: {
    color: colors.navy,
    fontSize: 12,
    lineHeight: 16,
    opacity: 0.7,
  },
  toggleSubActive: { color: colors.white, opacity: 0.85 },
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
