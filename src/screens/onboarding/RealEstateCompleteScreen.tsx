import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme';
import { supabase, type PropertyRow } from '../../services/supabase';
import { MP_TEST_INT } from '../../services/properties';
import { useAuth } from '../../auth/AuthContext';
import type { OnboardingStackParamList } from '../../navigation/types';

type Route = RouteProp<OnboardingStackParamList, 'RealEstateComplete'>;

const trackLabel = (
  propertyTypes: readonly string[],
  repsPursuit: boolean | null,
): string => {
  const hasLong = propertyTypes.includes('long_term');
  const hasShort = propertyTypes.includes('short_term');
  const labels: string[] = [];
  if (hasLong && repsPursuit) labels.push('Track A');
  if (hasShort) labels.push('Track B');
  if (hasLong && repsPursuit === false) labels.push('Track C');
  if (labels.length === 0) return '—';
  if (labels.length === 1) return labels[0];
  return `Mixed (${labels.join(' + ')})`;
};

export const RealEstateCompleteScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const route = useRoute<Route>();
  const { session, refreshProfile } = useAuth();
  const params = route.params;
  const [savedProperties, setSavedProperties] = useState<PropertyRow[] | null>(null);
  const [persisting, setPersisting] = useState(true);
  const [navigating, setNavigating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!session?.user.id) return;
      try {
        // Persist user-level RE flags + complete onboarding. Property rows
        // were already inserted on RE-3; if a grouping election applies,
        // mirror it onto each long-term property too.
        const userUpdate: Record<string, unknown> = {
          active_strategies: params.selectedStrategies,
          re_has_properties: true,
          re_property_type: params.portfolioType,
          default_mp_test: MP_TEST_INT[params.defaultMpTest],
          reps_pursuit_active: params.repsPursuit,
          total_work_hours_this_year: params.totalWorkHours,
          re_grouping_election: params.grouping,
          onboarding_completed: true,
        };
        const { error: uErr } = await supabase
          .from('users')
          .update(userUpdate)
          .eq('id', session.user.id);
        if (uErr) throw uErr;

        if (params.grouping !== null) {
          const { error: pErr } = await supabase
            .from('properties')
            .update({ grouping_election: params.grouping })
            .eq('user_id', session.user.id)
            .eq('property_type', 'long_term');
          if (pErr) throw pErr;
        }

        const { data, error: lErr } = await supabase
          .from('properties')
          .select('*')
          .eq('user_id', session.user.id)
          .eq('active', true)
          .order('created_at', { ascending: true });
        if (lErr) throw lErr;

        if (!cancelled) setSavedProperties((data ?? []) as PropertyRow[]);
      } catch (err) {
        Alert.alert(
          'Could not finish setup',
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        if (!cancelled) setPersisting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGo = async () => {
    setNavigating(true);
    try {
      await refreshProfile();
      // Gate in App.tsx swaps to RootStack once onboarding_completed=true.
    } catch (err) {
      Alert.alert('Could not enter app', err instanceof Error ? err.message : String(err));
      setNavigating(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 16 }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 24 },
        ]}
      >
        <Image
          source={require('../../../assets/logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />

        <View style={styles.checkBubble}>
          <Ionicons name="checkmark" size={44} color={colors.white} />
        </View>

        <Text style={styles.title}>Your dashboard is ready</Text>
        <Text style={styles.subtitle}>
          Start logging your activity to track your compliance progress.
        </Text>

        <View style={styles.summaryCard}>
          <SummaryRow label="Strategy" value="Real Estate" />
          <SummaryRow
            label="Track"
            value={trackLabel(params.propertyTypes, params.repsPursuit)}
          />
          <SummaryRow
            label="Properties"
            value={
              persisting
                ? 'Loading…'
                : savedProperties && savedProperties.length > 0
                  ? savedProperties.map((p) => p.property_name).join(', ')
                  : '—'
            }
          />
          {params.grouping !== null ? (
            <SummaryRow label="Grouping" value={params.grouping ? 'Yes' : 'No'} />
          ) : null}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleGo}
          disabled={persisting || navigating}
          style={[styles.btn, (persisting || navigating) && styles.btnDisabled]}
        >
          {persisting || navigating ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.btnText}>Go to Dashboard</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const SummaryRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.summaryRow}>
    <Text style={styles.summaryLabel}>{label}</Text>
    <Text style={styles.summaryValue} numberOfLines={3}>
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#042C53',
  },
  content: {
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 16,
  },
  logo: {
    height: 28,
    width: 180,
    marginBottom: 16,
  },
  checkBubble: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 16,
  },
  title: {
    color: colors.white,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: '#85B7EB',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 16,
  },
  summaryCard: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    padding: 18,
    gap: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 16,
  },
  summaryLabel: {
    color: '#85B7EB',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    width: 92,
  },
  summaryValue: {
    flex: 1,
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  btn: {
    backgroundColor: '#BA7517',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.7 },
  btnText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
});
