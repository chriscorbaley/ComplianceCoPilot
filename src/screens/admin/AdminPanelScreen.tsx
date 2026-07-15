import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';
import { useAuth } from '../../auth/AuthContext';
import { usePendingAlertCount } from '../../services/regulatoryAlerts';
import type { AdminTabName, RootStackParamList } from '../../navigation/types';
import { RulesEditor } from './RulesEditor';
import { TemplatesEditor } from './TemplatesEditor';
import { FormFieldsManager } from './FormFieldsManager';
import { IrcReferencesEditor } from './IrcReferencesEditor';
import { StrategiesToggle } from './StrategiesToggle';
import { AnnouncementPublisher } from './AnnouncementPublisher';
import { RegulatoryAlertsInbox } from './RegulatoryAlertsInbox';
import { LegalDocumentsEditor } from './LegalDocumentsEditor';
import { PricingEditor } from './PricingEditor';
import { FeatureFlagsEditor } from './FeatureFlagsEditor';

type AdminRoute = RouteProp<RootStackParamList, 'AdminPanel'>;

interface TabSpec {
  key: AdminTabName;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const TABS: TabSpec[] = [
  { key: 'Rules',      label: 'Rules',         icon: 'list-outline' },
  { key: 'Templates',  label: 'Templates',     icon: 'document-text-outline' },
  { key: 'Fields',     label: 'Fields',        icon: 'options-outline' },
  { key: 'IRC',        label: 'IRC',           icon: 'book-outline' },
  { key: 'Strategies', label: 'Strategies',    icon: 'toggle-outline' },
  { key: 'Pricing',    label: 'Pricing',       icon: 'pricetags-outline' },
  { key: 'Flags',      label: 'Flags',         icon: 'flag-outline' },
  { key: 'Announce',   label: 'Announce',      icon: 'megaphone-outline' },
  { key: 'Inbox',      label: 'Inbox',         icon: 'mail-outline' },
  { key: 'Legal',      label: 'Legal',         icon: 'shield-outline' },
];

export const AdminPanelScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<AdminRoute>();
  const { isAdmin } = useAuth();
  const pendingCount = usePendingAlertCount();

  const initialTab: AdminTabName = route.params?.initialTab ?? 'Rules';
  const [tab, setTab] = useState<AdminTabName>(initialTab);

  useEffect(() => {
    if (route.params?.initialTab) setTab(route.params.initialTab);
  }, [route.params?.initialTab]);

  const prefillForRules = useMemo(() => {
    if (tab !== 'Rules') return undefined;
    if (!route.params?.prefillRuleKeys?.length) return undefined;
    return {
      ruleKeys: route.params.prefillRuleKeys,
      values: route.params.prefillValues ?? {},
    };
  }, [tab, route.params?.prefillRuleKeys, route.params?.prefillValues]);

  if (!isAdmin) {
    return (
      <View style={[styles.root, styles.denied, { paddingTop: insets.top }]}>
        <Ionicons name="lock-closed-outline" size={36} color={colors.white} />
        <Text style={styles.deniedText}>Admin access required</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.deniedBtn}>
          <Text style={styles.deniedBtnText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={styles.headerBack}
          >
            <Ionicons name="chevron-back" size={22} color={colors.white} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Admin Panel</Text>
            <Text style={styles.headerSubtitle}>Firm-wide configuration</Text>
          </View>
          <View style={styles.adminPill}>
            <Ionicons name="shield-checkmark" size={12} color={colors.white} />
            <Text style={styles.adminPillText}>ADMIN</Text>
          </View>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabsContent}
      >
        {TABS.map((t) => {
          const active = t.key === tab;
          const showBadge = t.key === 'Inbox' && pendingCount > 0;
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => setTab(t.key)}
              activeOpacity={0.85}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Ionicons
                name={t.icon}
                size={14}
                color={active ? colors.white : colors.midNavy}
              />
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                {t.label}
              </Text>
              {showBadge && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {pendingCount > 99 ? '99+' : pendingCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.body}>
        {tab === 'Rules' && <RulesEditor prefill={prefillForRules} />}
        {tab === 'Templates' && <TemplatesEditor />}
        {tab === 'Fields' && <FormFieldsManager />}
        {tab === 'IRC' && <IrcReferencesEditor />}
        {tab === 'Strategies' && <StrategiesToggle />}
        {tab === 'Pricing' && <PricingEditor />}
        {tab === 'Flags' && <FeatureFlagsEditor />}
        {tab === 'Announce' && <AnnouncementPublisher />}
        {tab === 'Legal' && <LegalDocumentsEditor />}
        {tab === 'Inbox' && <RegulatoryAlertsInbox onJumpToRules={(keys, values) => {
          navigation.setParams({
            initialTab: 'Rules',
            prefillRuleKeys: keys,
            prefillValues: values,
          } as never);
          setTab('Rules');
        }} />}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    backgroundColor: colors.navy,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    gap: spacing.md,
  },
  headerBack: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1 },
  headerTitle: {
    ...typography.h2,
    color: colors.white,
    fontSize: 17,
  },
  headerSubtitle: {
    ...typography.caption,
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 11,
    marginTop: 1,
  },
  adminPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.midNavy,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  adminPillText: {
    ...typography.micro,
    color: colors.white,
    fontSize: 10,
    letterSpacing: 0.5,
  },
  tabsScroll: {
    flexGrow: 0,
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  tabsContent: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    alignItems: 'center',
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.lightBlue,
  },
  tabActive: { backgroundColor: colors.midNavy },
  tabLabel: {
    ...typography.caption,
    color: colors.midNavy,
    fontSize: 12,
    fontWeight: '600',
  },
  tabLabelActive: { color: colors.white },
  badge: {
    backgroundColor: colors.orangeAlert,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.pill,
    marginLeft: 2,
    minWidth: 18,
    alignItems: 'center',
  },
  badgeText: {
    ...typography.micro,
    color: colors.white,
    fontSize: 10,
  },
  body: { flex: 1 },
  denied: {
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  deniedText: { ...typography.h2, color: colors.white },
  deniedBtn: {
    backgroundColor: colors.midNavy,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    marginTop: spacing.md,
  },
  deniedBtnText: { ...typography.bodyMedium, color: colors.white },
});
