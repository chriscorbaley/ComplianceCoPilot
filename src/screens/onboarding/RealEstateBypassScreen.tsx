import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme';
import { supabase } from '../../services/supabase';
import { useAuth } from '../../auth/AuthContext';
import type { OnboardingStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'RealEstateBypass'>;
type Route = RouteProp<OnboardingStackParamList, 'RealEstateBypass'>;

// First screen of the real estate v2 onboarding flow. "No, not yet" sets
// re_has_properties=false and completes onboarding immediately so the user
// lands on the Dashboard with an Add Property empty state on the Hours tab.
export const RealEstateBypassScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { session, refreshProfile } = useAuth();
  const [busy, setBusy] = useState<'yes' | 'no' | null>(null);
  const selectedStrategies = route.params.selectedStrategies;

  const handleNo = async () => {
    if (!session?.user.id) return;
    setBusy('no');
    try {
      const { error } = await supabase
        .from('users')
        .update({
          active_strategies: selectedStrategies,
          re_has_properties: false,
          onboarding_completed: true,
        })
        .eq('id', session.user.id);
      if (error) throw error;
      await refreshProfile();
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  const handleYes = () => {
    nav.navigate('RealEstateType', { selectedStrategies });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24 }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      >
        <Text style={styles.title}>Do you currently own rental properties?</Text>

        <Pressable
          onPress={handleYes}
          disabled={busy !== null}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        >
          <View style={styles.cardIcon}>
            <Ionicons name="home" size={22} color={colors.teal} />
          </View>
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>Yes, I own rental properties</Text>
            <Text style={styles.cardSub}>I will set up my properties now</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.mutedText} />
        </Pressable>

        <Pressable
          onPress={handleNo}
          disabled={busy !== null}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        >
          <View style={styles.cardIcon}>
            <Ionicons name="calendar-outline" size={22} color={colors.midNavy} />
          </View>
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>No, not yet</Text>
            <Text style={styles.cardSub}>
              I will add properties later when I acquire them
            </Text>
          </View>
          {busy === 'no' ? (
            <ActivityIndicator color={colors.mutedText} />
          ) : (
            <Ionicons name="chevron-forward" size={20} color={colors.mutedText} />
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: 20,
    gap: 16,
  },
  title: {
    color: '#042C53',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: 18,
    gap: 14,
  },
  cardPressed: {
    backgroundColor: colors.lightBlue,
    borderColor: colors.teal,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.tealLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: {
    flex: 1,
    gap: 4,
  },
  cardTitle: {
    color: colors.bodyText,
    fontSize: 15,
    fontWeight: '700',
  },
  cardSub: {
    color: '#888888',
    fontSize: 13,
    lineHeight: 18,
  },
});
