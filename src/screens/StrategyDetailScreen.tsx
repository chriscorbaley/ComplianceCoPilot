import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  useNavigation,
  useRoute,
  RouteProp,
  CommonActions,
  useFocusEffect,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, shadow, spacing, typography } from '../theme';
import { contentContainerStyle } from '../constants/layout';
import { ProgressBar } from '../components/ProgressBar';
import { StatusPill } from '../components/StatusPill';
import { AugustaActivityModal } from '../components/AugustaActivityModal';
import { RealEstateSettingsSheet } from '../components/RealEstateSettingsSheet';
import { ManualMinutesModal } from '../components/ManualMinutesModal';
import { ComplianceReportButton } from '../components/ComplianceReportButton';
import { ActivityLogSheet } from '../components/ActivityLogSheet';
import { supabase, type PropertyRow } from '../services/supabase';
import { listProperties } from '../services/properties';
import { generateRealEstateReport } from '../services/realEstateReport';
import { generateAugustaReport } from '../services/complianceReports';
import { useAuth } from '../auth/AuthContext';
import { useBusiness } from '../business/BusinessContext';
import type { RootStackParamList } from '../navigation/types';

type RouteProps = RouteProp<RootStackParamList, 'StrategyDetail'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

const REAL_ESTATE_STRATEGY_IDS = new Set(['s1', 'real_estate']);
const isRealEstateStrategy = (id: string, name: string): boolean =>
  REAL_ESTATE_STRATEGY_IDS.has(id) ||
  /material participation|real estate/i.test(name);

const isAugustaStrategy = (id: string, name: string): boolean =>
  id === 's2' || id === 'augusta_rule' || /augusta/i.test(name);

export const StrategyDetailScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { activeBusinessId, activeBusiness } = useBusiness();
  const { session, fullName } = useAuth();
  const { params } = useRoute<RouteProps>();
  const { strategy } = params;
  const showProperties = isRealEstateStrategy(strategy.id, strategy.name);
  const isAugusta = isAugustaStrategy(strategy.id, strategy.name);
  const [augustaFormOpen, setAugustaFormOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [generating, setGenerating] = useState(false);
  const businessName = activeBusiness?.business_name ?? null;

  const onGenerateReport = useCallback(async () => {
    if (generating) return;
    const userId = session?.user?.id;
    if (!userId) {
      Alert.alert('Not signed in', 'Sign in to generate a compliance report.');
      return;
    }
    setGenerating(true);
    try {
      await generateRealEstateReport({
        userId,
        businessId: activeBusinessId,
        clientName: fullName ?? 'Client',
      });
    } catch (e) {
      Alert.alert(
        'Report failed',
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setGenerating(false);
    }
  }, [generating, session?.user?.id, activeBusinessId, fullName]);

  // For Augusta, show the same unified count the Dashboard uses: every
  // completed Augusta meeting this tax year, from either the Minutes screen or
  // the Log Activity form. Seeded with the value passed in, then refreshed live.
  const [augustaDays, setAugustaDays] = useState(strategy.progress);

  const loadAugustaCount = useCallback(async () => {
    const year = new Date().getFullYear();
    let q = supabase
      .from('meeting_minutes')
      .select('id', { count: 'exact', head: true })
      .ilike('meeting_type', 'Augusta%')
      .eq('status', 'complete')
      .gte('meeting_date', `${year}-01-01`)
      .lte('meeting_date', `${year}-12-31`);
    if (activeBusinessId) q = q.eq('business_id', activeBusinessId);
    const { count, error } = await q;
    if (!error && count != null) setAugustaDays(count);
  }, [activeBusinessId]);

  // For real-estate / material participation, mirror the Dashboard's hoursYTD:
  // sum every hours_log row this tax year. Seeded from the value passed in, then
  // refreshed live (on focus and after a manual log) so a new entry shows at
  // once without an app restart.
  const [reHours, setReHours] = useState(strategy.progress);

  const loadReHours = useCallback(async () => {
    const year = new Date().getFullYear();
    let q = supabase
      .from('hours_log')
      .select('hours')
      .gte('activity_date', `${year}-01-01`)
      .lte('activity_date', `${year}-12-31`);
    if (activeBusinessId) q = q.eq('business_id', activeBusinessId);
    const { data, error } = await q;
    if (!error && data) {
      const total = data.reduce((sum, r) => sum + (Number(r.hours) || 0), 0);
      setReHours(Math.round(total));
    }
  }, [activeBusinessId]);

  // Load the property list once (for the Log Activity picker) and keep the
  // material-participation hours count fresh whenever the screen regains focus.
  useFocusEffect(
    useCallback(() => {
      if (isAugusta) loadAugustaCount().catch(() => undefined);
      if (showProperties) {
        loadReHours().catch(() => undefined);
        listProperties(activeBusinessId)
          .then(setProperties)
          .catch(() => undefined);
      }
    }, [
      isAugusta,
      loadAugustaCount,
      showProperties,
      loadReHours,
      activeBusinessId,
    ]),
  );

  const progress = isAugusta
    ? augustaDays
    : showProperties
    ? reHours
    : strategy.progress;
  const pct = Math.round((progress / strategy.total) * 100);
  const accent = strategy.accentColor ?? colors.midNavy;
  const remaining = Math.max(0, strategy.total - progress);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={[contentContainerStyle, { gap: spacing.lg }]}>
      {showProperties ? (
        <View style={styles.reportRow}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={onGenerateReport}
            disabled={generating}
            style={[styles.reportBtn, generating && styles.reportBtnDisabled]}
          >
            {generating ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Ionicons name="download-outline" size={18} color={colors.white} />
            )}
            <Text style={styles.reportBtnText}>
              {generating ? 'Preparing your compliance report…' : 'Generate Report'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.card}>
        <View style={styles.header}>
          <View style={[styles.icon, { backgroundColor: colors.lightBlue }]}>
            <Ionicons name={strategy.icon} size={26} color={colors.midNavy} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.title}>{strategy.name}</Text>
            <Text style={styles.description}>{strategy.description}</Text>
          </View>
          <StatusPill label={strategy.status} variant={strategy.statusVariant} />
        </View>

        <View style={styles.divider} />

        <Text style={styles.sectionLabel}>Progress</Text>
        <View style={styles.progressRow}>
          <Text style={styles.progressValue}>
            {progress}
            <Text style={styles.progressTotal}>
              {' / '}
              {strategy.total} {strategy.unit}
            </Text>
          </Text>
          <Text style={[styles.pctText, { color: accent }]}>{pct}%</Text>
        </View>
        <ProgressBar
          value={progress}
          total={strategy.total}
          color={accent}
          trackColor={colors.lightBlue}
          height={10}
        />
        <Text style={styles.remaining}>
          {remaining} {strategy.unit} remaining to hit goal
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>About this strategy</Text>
        <Text style={styles.body}>
          {strategy.description}. Track activity throughout the year and keep
          substantiating documents in your vault so you can defend the
          deduction at audit time.
        </Text>
      </View>

      {showProperties ? (
        <>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setSettingsOpen(true)}
            style={styles.linkCard}
          >
            <View style={[styles.icon, styles.linkIcon]}>
              <Ionicons name="settings-outline" size={20} color={colors.midNavy} />
            </View>
            <View style={styles.linkText}>
              <Text style={styles.linkTitle}>Edit Tracker Settings</Text>
              <Text style={styles.linkBody}>
                Update your portfolio type, REPS pursuit, default material
                participation test, and total annual work hours.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.mutedText} />
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Properties')}
            style={styles.linkCard}
          >
            <View style={[styles.icon, styles.linkIcon]}>
              <Ionicons name="home-outline" size={20} color={colors.midNavy} />
            </View>
            <View style={styles.linkText}>
              <Text style={styles.linkTitle}>Manage Properties</Text>
              <Text style={styles.linkBody}>
                Track per-property hours, grouping elections, and material
                participation status.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.mutedText} />
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigation.navigate('RealEstateActivityLog')}
            style={styles.linkCard}
          >
            <View style={[styles.icon, styles.linkIcon]}>
              <Ionicons name="list-outline" size={20} color={colors.midNavy} />
            </View>
            <View style={styles.linkText}>
              <Text style={styles.linkTitle}>Activity Log</Text>
              <Text style={styles.linkBody}>
                Review every logged activity in an audit-ready table and export
                it for your tax advisor.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.mutedText} />
          </TouchableOpacity>
        </>
      ) : null}

      {isAugusta ? (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => navigation.navigate('AugustaCompliance')}
          style={styles.linkCard}
        >
          <View style={[styles.icon, styles.linkIcon]}>
            <Ionicons name="images-outline" size={20} color={colors.midNavy} />
          </View>
          <View style={styles.linkText}>
            <Text style={styles.linkTitle}>Comparable Rentals</Text>
            <Text style={styles.linkBody}>
              Upload comparable venue rates to justify your Augusta rental rates
              for each property.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.mutedText} />
        </TouchableOpacity>
      ) : null}

      {isAugusta ? (
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>Augusta documents</Text>
          <Text style={[styles.body, { marginBottom: spacing.sm }]}>
            Fill a template meeting-minutes record by hand, or export a full
            Augusta Rule compliance report for your tax advisor.
          </Text>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setManualOpen(true)}
            style={[styles.btn, styles.btnPrimary, styles.fullBtn]}
          >
            <Ionicons name="clipboard-outline" size={18} color={colors.white} />
            <Text style={styles.btnPrimaryText}>Create Manual Minutes</Text>
          </TouchableOpacity>
          <View style={{ marginTop: spacing.sm }}>
            <ComplianceReportButton
              onGenerate={() =>
                generateAugustaReport({
                  businessId: activeBusinessId,
                  clientName: businessName ?? fullName ?? 'Client',
                  taxYear: new Date().getFullYear(),
                })
              }
            />
          </View>
        </View>
      ) : null}

      <View style={styles.actions}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => {
            if (isAugusta) {
              setAugustaFormOpen(true);
              return;
            }
            if (showProperties) {
              setLogOpen(true);
              return;
            }
            Alert.alert('Log activity', `Logging activity for ${strategy.name}…`);
          }}
          style={[styles.btn, styles.btnPrimary]}
        >
          <Ionicons name="add-circle-outline" size={18} color={colors.white} />
          <Text style={styles.btnPrimaryText}>Log activity</Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() =>
            navigation.dispatch(
              CommonActions.navigate({ name: 'Tabs', params: { screen: 'Docs' } }),
            )
          }
          style={[styles.btn, styles.btnOutline]}
        >
          <Ionicons name="document-text-outline" size={18} color={colors.navy} />
          <Text style={styles.btnOutlineText}>View documents</Text>
        </TouchableOpacity>
      </View>

      {isAugusta ? (
        <AugustaActivityModal
          visible={augustaFormOpen}
          onClose={() => setAugustaFormOpen(false)}
          onSaved={() => loadAugustaCount().catch(() => undefined)}
        />
      ) : null}

      {isAugusta ? (
        <ManualMinutesModal
          visible={manualOpen}
          strategy="augusta_rule"
          businessId={activeBusinessId}
          businessName={businessName}
          clientName={fullName ?? null}
          onClose={() => setManualOpen(false)}
          onSaved={() => loadAugustaCount().catch(() => undefined)}
        />
      ) : null}

      {showProperties ? (
        <RealEstateSettingsSheet
          visible={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      {showProperties ? (
        <ActivityLogSheet
          mode="create"
          visible={logOpen}
          properties={properties}
          businessId={activeBusinessId}
          defaultHoursType="material_participation"
          onClose={() => setLogOpen(false)}
          onSaved={() => loadReHours().catch(() => undefined)}
        />
      ) : null}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  reportRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  reportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    ...shadow.raised,
  },
  reportBtnDisabled: {
    opacity: 0.7,
  },
  reportBtnText: {
    ...typography.bodyMedium,
    color: colors.white,
    fontWeight: '700',
    fontSize: 13,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadow.card,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  title: {
    ...typography.h2,
    color: colors.bodyText,
    fontSize: 17,
    fontWeight: '700',
  },
  description: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginVertical: spacing.xs,
  },
  sectionLabel: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  progressValue: {
    ...typography.h2,
    color: colors.bodyText,
    fontSize: 22,
    fontWeight: '700',
  },
  progressTotal: {
    ...typography.body,
    color: colors.mutedText,
    fontWeight: '500',
    fontSize: 14,
  },
  pctText: {
    ...typography.bodyMedium,
    fontWeight: '700',
    fontSize: 15,
  },
  remaining: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: spacing.sm,
  },
  body: {
    ...typography.body,
    color: colors.bodyText,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    borderRadius: radius.card,
    paddingVertical: 14,
  },
  fullBtn: {
    flex: 0,
    width: '100%',
  },
  btnPrimary: {
    backgroundColor: colors.navy,
    ...shadow.raised,
  },
  btnPrimaryText: {
    ...typography.bodyMedium,
    color: colors.white,
    fontWeight: '700',
    fontSize: 14,
  },
  btnOutline: {
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.navy,
  },
  btnOutlineText: {
    ...typography.bodyMedium,
    color: colors.navy,
    fontWeight: '700',
    fontSize: 14,
  },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    ...shadow.card,
  },
  linkIcon: {
    backgroundColor: colors.lightBlue,
  },
  linkText: {
    flex: 1,
  },
  linkTitle: {
    ...typography.h3,
    color: colors.bodyText,
    fontSize: 15,
  },
  linkBody: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 2,
  },
});
