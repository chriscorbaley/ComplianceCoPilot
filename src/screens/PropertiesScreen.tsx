import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, radius, shadow, spacing, typography } from '../theme';
import { StatusPill, type StatusVariant } from '../components/StatusPill';
import { useAuth } from '../auth/AuthContext';
import { useBusiness } from '../business/BusinessContext';
import {
  supabase,
  type HoursLogRow,
  type PropertyRow,
} from '../services/supabase';
import {
  PROPERTY_TYPE_LABEL,
  computeParticipation,
  computePropertyWarnings,
  deleteProperty,
  listProperties,
  type ParticipationStatus,
} from '../services/properties';
import {
  loadComplianceRules,
  subscribeToRules,
  type ComplianceRules,
} from '../services/complianceRules';
import { readThresholds } from '../services/realEstate';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const STATUS_VARIANT: Record<ParticipationStatus, StatusVariant> = {
  Met: 'success',
  'On Track': 'success',
  'At Risk': 'warning',
  'Not Met': 'warning',
};

const ruleNumber = (
  rules: ComplianceRules | null,
  strategy: string,
  key: string,
  fallback: number,
): number => {
  const row = rules?.rawDb.find((r) => r.strategy_name === strategy && r.rule_key === key);
  if (!row) return fallback;
  const n = parseFloat(row.rule_value);
  return Number.isFinite(n) ? n : fallback;
};

export const PropertiesScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const { session, refreshProfile } = useAuth();
  const { activeBusinessId, activeBusiness } = useBusiness();
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [yearHours, setYearHours] = useState<HoursLogRow[]>([]);
  const [rules, setRules] = useState<ComplianceRules | null>(null);
  const [loading, setLoading] = useState(true);
  // Transient inline feedback for the grouping toggle, scoped to one property
  // row so the user gets confirmation the change saved (not a visual glitch).
  const [toggleFeedback, setToggleFeedback] = useState<
    { id: string; ok: boolean; text: string } | null
  >(null);

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      const props = await listProperties(activeBusinessId);
      setProperties(props);
      const year = new Date().getFullYear();
      let q = supabase
        .from('hours_log')
        .select('*')
        .gte('activity_date', `${year}-01-01`)
        .lte('activity_date', `${year}-12-31`);
      if (activeBusinessId) q = q.eq('business_id', activeBusinessId);
      const { data, error } = await q;
      if (error) throw error;
      setYearHours((data ?? []) as HoursLogRow[]);
    } catch (e) {
      Alert.alert('Could not load properties', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [activeBusinessId]);

  useFocusEffect(
    useCallback(() => {
      reload().catch(() => undefined);
    }, [reload]),
  );

  useEffect(() => {
    loadComplianceRules().then(setRules).catch(() => undefined);
    return subscribeToRules(setRules);
  }, []);

  // Auto-dismiss the toggle feedback message after a short moment.
  useEffect(() => {
    if (!toggleFeedback) return;
    const timer = setTimeout(() => setToggleFeedback(null), 2500);
    return () => clearTimeout(timer);
  }, [toggleFeedback]);

  const threshold = ruleNumber(rules, 'real_estate', 'hours_required', 750);
  const strMaxDays = rules ? readThresholds(rules.rawDb).str_avg_period_max_days : 7;

  const handleGroupingToggle = async (propertyId: string, newValue: boolean) => {
    const userId = session?.user.id;
    if (!userId) {
      Alert.alert('Could not update', 'You must be signed in to change this setting.');
      return;
    }

    // Snapshot for revert if the save fails.
    const previous = properties;
    // Optimistic UI update so the toggle does not snap back while the server
    // request is in flight.
    const next = properties.map((p) =>
      p.id === propertyId ? { ...p, grouping_election: newValue } : p,
    );
    setProperties(next);
    setToggleFeedback(null);

    try {
      // Step 1 — update the specific property.
      const { error } = await supabase
        .from('properties')
        .update({ grouping_election: newValue })
        .eq('id', propertyId)
        .eq('user_id', userId);
      if (error) throw error;

      // Steps 2 & 3 — keep users.re_grouping_election in sync. Turning a
      // property off means the portfolio is no longer fully elected, so the
      // user-level flag goes false. Turning one on only flips the user-level
      // flag true once every long-term property is elected.
      if (!newValue) {
        const { error: userError } = await supabase
          .from('users')
          .update({ re_grouping_election: false })
          .eq('id', userId);
        if (userError) throw userError;
      } else {
        const longTerm = next.filter((p) => p.property_type === 'long_term');
        const allElected =
          longTerm.length > 0 && longTerm.every((p) => p.grouping_election);
        if (allElected) {
          const { error: userError } = await supabase
            .from('users')
            .update({ re_grouping_election: true })
            .eq('id', userId);
          if (userError) throw userError;
        }
      }

      await refreshProfile();
      setToggleFeedback({ id: propertyId, ok: true, text: 'Grouping election updated' });
    } catch (error) {
      console.error('[GroupingToggle] save failed', { error, propertyId });
      // Revert the optimistic change so the UI reflects the real saved state.
      setProperties(previous);
      setToggleFeedback({
        id: propertyId,
        ok: false,
        text: 'Could not save grouping election — please try again',
      });
    }
  };

  const handleDelete = (prop: PropertyRow) => {
    Alert.alert(
      'Delete property?',
      `${prop.property_name} will be removed. Hours previously logged to it will become general/administrative.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteProperty(prop.id);
              await reload();
            } catch (e) {
              Alert.alert('Could not delete', e instanceof Error ? e.message : String(e));
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.midNavy} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerBlock}>
          <Text style={styles.title}>Properties</Text>
          <Text style={styles.subtitle}>
            {activeBusiness?.business_name
              ? `${activeBusiness.business_name} · `
              : ''}
            {threshold}-hour material participation threshold per property
          </Text>
        </View>

        {properties.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="home-outline" size={28} color={colors.midNavy} />
            <Text style={styles.emptyTitle}>No properties yet</Text>
            <Text style={styles.emptyBody}>
              Add your first property so we can track hours and material
              participation per address.
            </Text>
          </View>
        ) : (
          properties.map((p) => {
            const r = computeParticipation(p, properties, yearHours, threshold);
            const grouped = p.has_grouping_election && !!p.grouping_group_name;
            const groupMembers = grouped
              ? properties.filter(
                  (x) =>
                    x.has_grouping_election &&
                    x.grouping_group_name === p.grouping_group_name,
                )
              : [];
            const warnings = computePropertyWarnings(
              p,
              properties,
              yearHours,
              threshold,
              { strMaxDays },
            );
            return (
              <View key={p.id} style={styles.propertyBlock}>
              <View style={styles.card}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() =>
                    navigation.navigate('PropertyEdit', { propertyId: p.id })
                  }
                >
                  <View style={styles.cardHeader}>
                    <View style={styles.iconWrap}>
                      <Ionicons name="home-outline" size={20} color={colors.midNavy} />
                    </View>
                    <View style={styles.cardText}>
                      <Text style={styles.cardName} numberOfLines={1}>
                        {p.property_name}
                      </Text>
                      {p.property_type ? (
                        <Text style={styles.cardType}>
                          {PROPERTY_TYPE_LABEL[p.property_type]}
                        </Text>
                      ) : null}
                    </View>
                    <StatusPill label={r.status} variant={STATUS_VARIANT[r.status]} />
                  </View>

                  <View style={styles.hoursRow}>
                    <Text style={styles.hoursValue}>
                      {r.hours.toFixed(0)}
                      <Text style={styles.hoursTotal}>
                        {' / '}
                        {threshold} hrs this year
                      </Text>
                    </Text>
                    {grouped && groupMembers.length > 1 ? (
                      <View style={styles.groupBadge}>
                        <Ionicons
                          name="layers-outline"
                          size={11}
                          color={colors.midNavy}
                        />
                        <Text style={styles.groupBadgeText} numberOfLines={1}>
                          Group total
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  {grouped ? (
                    <View style={styles.groupBanner}>
                      <Ionicons
                        name="layers-outline"
                        size={14}
                        color={colors.midNavy}
                      />
                      <Text style={styles.groupBannerText} numberOfLines={2}>
                        {p.grouping_group_name}
                        {groupMembers.length > 1
                          ? ` · ${groupMembers.length} properties combined`
                          : ''}
                      </Text>
                    </View>
                  ) : null}
                </TouchableOpacity>

                <View style={styles.toggleRow}>
                  <View style={styles.toggleText}>
                    <Text style={styles.toggleTitle}>Grouping election</Text>
                    <Text style={styles.toggleHint}>
                      Combine hours across all long-term properties for the
                      material participation test.
                    </Text>
                  </View>
                  <Switch
                    value={p.grouping_election}
                    onValueChange={(value) => handleGroupingToggle(p.id, value)}
                    trackColor={{ false: colors.divider, true: colors.midNavy }}
                    thumbColor={colors.white}
                  />
                </View>

                <Text style={styles.groupingExplain}>
                  When on, your hours for all long-term properties are combined
                  for participation tracking.
                </Text>

                {toggleFeedback?.id === p.id ? (
                  <Text
                    style={[
                      styles.toggleFeedback,
                      toggleFeedback.ok
                        ? styles.toggleFeedbackOk
                        : styles.toggleFeedbackErr,
                    ]}
                  >
                    {toggleFeedback.text}
                  </Text>
                ) : null}

                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() =>
                      navigation.navigate('PropertyEdit', { propertyId: p.id })
                    }
                  >
                    <Ionicons name="create-outline" size={16} color={colors.midNavy} />
                    <Text style={styles.actionText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => handleDelete(p)}>
                    <Ionicons name="trash-outline" size={16} color="#C0392B" />
                    <Text style={[styles.actionText, { color: '#C0392B' }]}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {warnings.length > 0 ? (
                <View style={styles.warningCard}>
                  <View style={styles.warningIcon}>
                    <Ionicons name="warning" size={16} color={colors.amber} />
                  </View>
                  <View style={styles.warningTextWrap}>
                    <Text style={styles.warningHeading}>
                      Compliance {warnings.length > 1 ? 'warnings' : 'warning'}
                    </Text>
                    {warnings.map((w, i) => (
                      <Text
                        key={w.kind}
                        style={[
                          styles.warningMessage,
                          i > 0 && { marginTop: spacing.sm },
                        ]}
                      >
                        {w.message}
                      </Text>
                    ))}
                  </View>
                </View>
              ) : null}
              </View>
            );
          })
        )}

        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => navigation.navigate('PropertyEdit')}
          activeOpacity={0.85}
        >
          <Ionicons name="add-circle-outline" size={18} color={colors.white} />
          <Text style={styles.addBtnText}>Add Property</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  headerBlock: {
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.h1,
    color: colors.bodyText,
  },
  subtitle: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 2,
  },
  emptyCard: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
  },
  emptyTitle: {
    ...typography.h2,
    color: colors.bodyText,
  },
  emptyBody: {
    ...typography.body,
    color: colors.mutedText,
    textAlign: 'center',
  },
  propertyBlock: {
    gap: spacing.sm,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    padding: spacing.lg,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    gap: spacing.md,
    ...shadow.card,
  },
  warningCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.amberLight,
    borderRadius: radius.card,
    borderLeftWidth: 4,
    borderLeftColor: colors.amber,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  warningIcon: {
    marginTop: 1,
  },
  warningTextWrap: {
    flex: 1,
  },
  warningHeading: {
    color: colors.amber,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  warningMessage: {
    color: colors.bodyText,
    fontSize: 13,
    lineHeight: 18,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.lightBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: {
    flex: 1,
  },
  cardName: {
    ...typography.h3,
    color: colors.bodyText,
  },
  cardAddress: {
    ...typography.caption,
    color: colors.mutedText,
    marginTop: 2,
  },
  cardType: {
    ...typography.micro,
    color: colors.midNavy,
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  hoursRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hoursValue: {
    ...typography.h2,
    color: colors.bodyText,
    fontSize: 20,
    fontWeight: '700',
  },
  hoursTotal: {
    ...typography.body,
    color: colors.mutedText,
    fontWeight: '500',
    fontSize: 13,
  },
  groupBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.lightBlue,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  groupBadgeText: {
    ...typography.micro,
    color: colors.midNavy,
  },
  groupBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.lightBlue,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  groupBannerText: {
    ...typography.caption,
    color: colors.midNavy,
    flex: 1,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  toggleText: {
    flex: 1,
  },
  toggleTitle: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontWeight: '700',
    fontSize: 13,
  },
  toggleHint: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 11,
    marginTop: 2,
  },
  groupingExplain: {
    fontSize: 11,
    color: '#888888',
    marginTop: -spacing.sm + 2,
    lineHeight: 15,
  },
  toggleFeedback: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  toggleFeedbackOk: {
    color: '#1B873F',
  },
  toggleFeedbackErr: {
    color: '#C0392B',
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionText: {
    ...typography.caption,
    color: colors.midNavy,
    fontWeight: '600',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.midNavy,
    paddingVertical: 14,
    borderRadius: 8,
    marginTop: spacing.sm,
  },
  addBtnText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
});
