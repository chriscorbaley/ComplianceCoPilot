// Family Management Company Compliance screen.
//
// Two parts under one screen:
//   Part A — six required document uploads (strategy_documents rows)
//   Part B — eight ongoing checklist items (compliance_checklist_items rows)
//
// Top of screen shows three indicators:
//   - Documents: X of 6 uploaded
//   - Checklist: X of 8 confirmed
//   - Overall compliance: weighted % of the two combined

import React, { useCallback, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { colors, radius, shadow, spacing, typography } from '../../theme';
import { ProgressBar } from '../../components/ProgressBar';
import { DocumentUploadRow } from '../../components/DocumentUploadRow';
import { ManualMinutesModal } from '../../components/ManualMinutesModal';
import { ComplianceReportButton } from '../../components/ComplianceReportButton';
import { generateFamilyMgmtReport } from '../../services/complianceReports';
import { useBusiness } from '../../business/BusinessContext';
import { useAuth } from '../../auth/AuthContext';
import {
  listStrategyDocuments,
  uploadStrategyDocument,
  replaceStrategyDocument,
  getStrategyDocumentSignedUrl,
  type StrategyDocumentRow,
} from '../../services/strategyDocuments';
import {
  listChecklistItems,
  setChecklistItem,
  type ComplianceChecklistRow,
} from '../../services/complianceChecklist';

const STRATEGY_KEY = 'family_management';

interface DocSlot {
  key: string;
  title: string;
  description: string;
}

const DOC_SLOTS: DocSlot[] = [
  {
    key: 'articles_of_organization',
    title: 'ARTICLES OF ORGANIZATION OR INCORPORATION',
    description:
      'State-filed formation documents establishing your family management company as a legal entity',
  },
  {
    key: 'operating_agreement',
    title: 'OPERATING AGREEMENT',
    description:
      'Agreement governing how the family management company operates, including member roles, profit distribution, and management authority',
  },
  {
    key: 'ein_ss4',
    title: 'EIN CONFIRMATION — IRS FORM SS-4',
    description:
      'IRS confirmation letter showing your Employer Identification Number assignment for the family management company',
  },
  {
    key: 'state_license',
    title: 'STATE BUSINESS LICENSE OR REGISTRATION',
    description:
      'Active state business license or registration confirming the entity is in good standing',
  },
  {
    key: 'bank_account',
    title: 'BANK ACCOUNT ESTABLISHMENT RECORD',
    description:
      'Bank statement or account opening documentation showing a separate business account for the family management company. This demonstrates separation from personal funds.',
  },
  {
    key: 'management_agreement',
    title: 'MANAGEMENT AGREEMENT',
    description:
      'Signed management agreement between the family management company and the managed entity, documenting the scope of services and fee structure',
  },
];

interface ChecklistDef {
  key: string;
  label: string;
}

const CHECKLIST: ChecklistDef[] = [
  { key: 'mgmt_agreement_current', label: 'Management agreement still in effect and current' },
  { key: 'fee_benchmarking', label: 'Fee benchmarking reviewed against market rates' },
  { key: 'invoices_paid', label: 'All invoices issued and paid per agreement terms' },
  { key: 'time_logs', label: 'Time logs current and complete' },
  { key: 'payroll_filings', label: 'Payroll filings current' },
  { key: 'entity_tax_return', label: 'Entity tax return filed' },
  { key: 'meeting_minutes', label: 'Meeting minutes completed' },
  { key: 'no_commingling', label: 'No commingling of personal and business funds' },
];

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const formatConfirmedDate = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `Confirmed ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};

export const FamilyMgmtComplianceScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { activeBusinessId, activeBusiness } = useBusiness();
  const { fullName } = useAuth();
  const [docs, setDocs] = useState<StrategyDocumentRow[]>([]);
  const [checklist, setChecklist] = useState<ComplianceChecklistRow[]>([]);
  const [manualOpen, setManualOpen] = useState(false);
  const businessName = activeBusiness?.business_name ?? null;

  const refresh = useCallback(async () => {
    try {
      const [docRows, listRows] = await Promise.all([
        listStrategyDocuments(STRATEGY_KEY, activeBusinessId),
        listChecklistItems(STRATEGY_KEY),
      ]);
      setDocs(docRows);
      setChecklist(listRows);
    } catch (e) {
      Alert.alert('Could not load', e instanceof Error ? e.message : String(e));
    }
  }, [activeBusinessId]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const docBySlot = new Map<string, StrategyDocumentRow>();
  for (const r of docs) if (!docBySlot.has(r.document_key)) docBySlot.set(r.document_key, r);

  const checklistByKey = new Map<string, ComplianceChecklistRow>();
  for (const c of checklist) checklistByKey.set(c.item_key, c);

  const docsComplete = DOC_SLOTS.reduce((n, s) => n + (docBySlot.has(s.key) ? 1 : 0), 0);
  const checklistComplete = CHECKLIST.reduce(
    (n, c) => n + (checklistByKey.get(c.key)?.is_checked ? 1 : 0),
    0,
  );
  const overallPct = Math.round(
    ((docsComplete + checklistComplete) / (DOC_SLOTS.length + CHECKLIST.length)) * 100,
  );

  const pickAndUpload = async (slot: DocSlot, existingId: string | null) => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const file = result.assets?.[0];
      if (!file) return;
      const input = {
        strategyKey: STRATEGY_KEY,
        documentKey: slot.key,
        businessId: activeBusinessId,
        localUri: file.uri,
        fileName: file.name,
        mimeType: file.mimeType ?? null,
      };
      if (existingId) await replaceStrategyDocument(existingId, input);
      else await uploadStrategyDocument(input);
      await refresh();
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : String(e));
    }
  };

  const viewDoc = async (row: StrategyDocumentRow) => {
    if (!row.file_url) return;
    try {
      const url = await getStrategyDocumentSignedUrl(row.file_url);
      const supported = await Linking.canOpenURL(url);
      if (supported) Linking.openURL(url);
      else Alert.alert('Cannot open document', 'No app is available to view this file.');
    } catch (e) {
      Alert.alert('Could not open document', e instanceof Error ? e.message : String(e));
    }
  };

  const toggleChecklistItem = async (item: ChecklistDef) => {
    const existing = checklistByKey.get(item.key);
    const nextChecked = !(existing?.is_checked ?? false);
    // Optimistic update so the checkbox responds instantly.
    setChecklist((prev) => {
      const without = prev.filter((c) => c.item_key !== item.key);
      return [
        ...without,
        {
          id: existing?.id ?? `temp-${item.key}`,
          user_id: existing?.user_id ?? '',
          strategy_key: STRATEGY_KEY,
          item_key: item.key,
          item_label: item.label,
          is_checked: nextChecked,
          last_confirmed_at: nextChecked ? new Date().toISOString() : existing?.last_confirmed_at ?? null,
          created_at: existing?.created_at ?? new Date().toISOString(),
        },
      ];
    });
    try {
      await setChecklistItem(STRATEGY_KEY, item.key, item.label, nextChecked);
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
      await refresh();
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Family Management Company Compliance</Text>
        <Text style={styles.subtitle}>
          Maintain complete documentation for your family management company strategy
        </Text>
      </View>

      <View style={styles.overallCard}>
        <Text style={styles.overallLabel}>Overall compliance</Text>
        <Text style={styles.overallValue}>{overallPct}%</Text>

        <View style={styles.miniProgressBlock}>
          <View style={styles.miniProgressRow}>
            <Text style={styles.miniProgressLabel}>Documents: {docsComplete} of {DOC_SLOTS.length} uploaded</Text>
          </View>
          <ProgressBar
            value={docsComplete}
            total={DOC_SLOTS.length}
            color={colors.teal}
            trackColor={colors.tealLight}
            height={8}
          />
        </View>

        <View style={styles.miniProgressBlock}>
          <View style={styles.miniProgressRow}>
            <Text style={styles.miniProgressLabel}>Checklist: {checklistComplete} of {CHECKLIST.length} confirmed</Text>
          </View>
          <ProgressBar
            value={checklistComplete}
            total={CHECKLIST.length}
            color={colors.teal}
            trackColor={colors.tealLight}
            height={8}
          />
        </View>
      </View>

      <View style={styles.actionCard}>
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.actionBtn}
          onPress={() => setManualOpen(true)}
        >
          <Ionicons name="clipboard-outline" size={18} color={colors.white} />
          <Text style={styles.actionBtnText}>Create Manual Minutes</Text>
        </TouchableOpacity>
        <View style={styles.actionSpace}>
          <ComplianceReportButton
            onGenerate={() =>
              generateFamilyMgmtReport({
                businessId: activeBusinessId,
                clientName: businessName ?? fullName ?? 'Client',
              })
            }
          />
        </View>
      </View>

      {/* ─── Part A: Document uploads ─────────────────────────────────── */}
      <View style={styles.partCard}>
        <Text style={styles.partTitle}>Required Documents</Text>
        {DOC_SLOTS.map((slot) => {
          const row = docBySlot.get(slot.key) ?? null;
          return (
            <DocumentUploadRow
              key={slot.key}
              title={slot.title}
              description={slot.description}
              uploaded={
                row && row.file_url
                  ? {
                      fileName: row.document_name ?? 'Document',
                      uploadedAt: row.uploaded_at,
                    }
                  : null
              }
              onUpload={() => pickAndUpload(slot, null)}
              onReplace={row ? () => pickAndUpload(slot, row.id) : undefined}
              onView={row ? () => viewDoc(row) : undefined}
            />
          );
        })}
      </View>

      {/* ─── Part B: Ongoing compliance checklist ─────────────────────── */}
      <View style={styles.partCard}>
        <Text style={styles.partTitle}>Ongoing Compliance Checklist</Text>
        <Text style={styles.partSubtitle}>
          Confirm these items are current each quarter
        </Text>

        {CHECKLIST.map((item, idx) => {
          const state = checklistByKey.get(item.key);
          const checked = state?.is_checked ?? false;
          const confirmedDate = checked
            ? formatConfirmedDate(state?.last_confirmed_at ?? null)
            : null;
          return (
            <View
              key={item.key}
              style={[
                styles.checkRow,
                idx < CHECKLIST.length - 1 && styles.checkRowDivider,
              ]}
            >
              <View style={styles.checkText}>
                <Text style={styles.checkLabel}>{item.label}</Text>
                {confirmedDate ? (
                  <Text style={styles.checkMeta}>{confirmedDate}</Text>
                ) : null}
              </View>
              <Switch
                value={checked}
                onValueChange={() => toggleChecklistItem(item)}
                trackColor={{ false: '#D1D5DB', true: colors.teal }}
                thumbColor={Platform.OS === 'android' ? colors.white : undefined}
                ios_backgroundColor="#D1D5DB"
              />
            </View>
          );
        })}
      </View>

      <ManualMinutesModal
        visible={manualOpen}
        strategy="family_management"
        businessId={activeBusinessId}
        businessName={businessName}
        clientName={fullName ?? null}
        onClose={() => setManualOpen(false)}
        onSaved={refresh}
      />
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
  header: {
    gap: spacing.xs,
  },
  title: {
    ...typography.h1,
    color: colors.navy,
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 13,
    lineHeight: 18,
  },
  overallCard: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadow.card,
  },
  overallLabel: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  overallValue: {
    fontSize: 40,
    fontWeight: '800',
    color: colors.teal,
    letterSpacing: -0.8,
    marginTop: -spacing.xs,
  },
  miniProgressBlock: {
    gap: 6,
  },
  miniProgressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  miniProgressLabel: {
    ...typography.caption,
    color: colors.bodyText,
    fontSize: 12,
    fontWeight: '600',
  },
  partCard: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    ...shadow.card,
  },
  actionCard: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    ...shadow.card,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingVertical: 13,
  },
  actionBtnText: {
    ...typography.bodyMedium,
    color: colors.white,
    fontWeight: '700',
    fontSize: 14,
  },
  actionSpace: {
    marginTop: spacing.sm,
  },
  partTitle: {
    ...typography.h2,
    color: colors.navy,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  partSubtitle: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: spacing.md,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  checkRowDivider: {
    borderBottomWidth: 0.5,
    borderBottomColor: '#CCCCCC',
  },
  checkText: {
    flex: 1,
  },
  checkLabel: {
    color: '#1A1A2E',
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'left',
    lineHeight: 18,
  },
  checkMeta: {
    color: '#888888',
    fontSize: 11,
    marginTop: 3,
  },
});
