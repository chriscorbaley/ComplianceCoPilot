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
import { contentContainerStyle } from '../../constants/layout';
import type { OnboardingStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'RealEstateGrouping'>;
type Route = RouteProp<OnboardingStackParamList, 'RealEstateGrouping'>;

type GroupingPick = 'yes' | 'no' | 'unsure';

export const RealEstateGroupingScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const params = route.params;
  const [pick, setPick] = useState<GroupingPick | null>(null);

  const handleContinue = () => {
    // "Not sure" defaults to No grouping per spec.
    const grouping = pick === 'yes';
    nav.navigate('RealEstateComplete', {
      selectedStrategies: params.selectedStrategies,
      portfolioType: params.portfolioType,
      defaultMpTest: params.defaultMpTest,
      propertyTypes: params.propertyTypes,
      repsPursuit: params.repsPursuit,
      totalWorkHours: params.totalWorkHours,
      grouping,
    });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24 }]}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}>
        <View style={[contentContainerStyle, { gap: 12 }]}>
        <Text style={styles.title}>Rental Property Grouping Election</Text>
        <Text style={styles.question}>
          Has your tax advisor instructed you to group all your rental
          properties together for participation tracking?
        </Text>

        <GroupOption
          active={pick === 'yes'}
          title="Yes — group all my properties"
          icon="link-outline"
          onPress={() => setPick('yes')}
        />
        <GroupOption
          active={pick === 'no'}
          title="No — track each property separately"
          icon="albums-outline"
          onPress={() => setPick('no')}
        />
        <GroupOption
          active={pick === 'unsure'}
          title="Not sure"
          sub="Defaults to tracking separately"
          icon="help-circle-outline"
          onPress={() => setPick('unsure')}
        />
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleContinue}
          disabled={pick === null}
          style={[styles.btn, pick === null && styles.btnDisabled]}
        >
          <Text style={styles.btnText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

interface GroupOptionProps {
  active: boolean;
  title: string;
  sub?: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}

const GroupOption: React.FC<GroupOptionProps> = ({
  active,
  title,
  sub,
  icon,
  onPress,
}) => (
  <Pressable
    onPress={onPress}
    style={[styles.card, active && styles.cardActive]}
  >
    <View style={[styles.iconWrap, active && styles.iconWrapActive]}>
      <Ionicons
        name={icon}
        size={22}
        color={active ? colors.white : colors.midNavy}
      />
    </View>
    <View style={styles.textWrap}>
      <Text style={styles.cardTitle}>{title}</Text>
      {sub ? <Text style={styles.cardSub}>{sub}</Text> : null}
    </View>
    <View style={[styles.radio, active && styles.radioActive]}>
      {active ? <Ionicons name="checkmark" size={16} color={colors.white} /> : null}
    </View>
  </Pressable>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, gap: 12 },
  title: {
    color: '#042C53',
    fontSize: 22,
    fontWeight: '700',
  },
  question: {
    color: colors.bodyText,
    fontSize: 14,
    lineHeight: 20,
    marginVertical: 8,
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
  iconWrapActive: { backgroundColor: colors.teal },
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
  radioActive: { backgroundColor: colors.teal, borderColor: colors.teal },
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
