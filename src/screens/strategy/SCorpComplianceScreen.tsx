// S-Corp Compliance Documents screen.
//
// Eight required-document slots, each backed by a row in strategy_documents
// with strategy_key='s_corp' and a slot-unique document_key. The header
// shows X-of-8 progress in teal.

import React, { useCallback, useState } from 'react';
import {
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
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
import { AccountablePlanModal } from '../../components/AccountablePlanModal';
import { BoardResolutionModal } from '../../components/BoardResolutionModal';
import { ManualMinutesModal } from '../../components/ManualMinutesModal';
import { ComplianceReportButton } from '../../components/ComplianceReportButton';
import { generateSCorpReport } from '../../services/complianceReports';
import { useBusiness } from '../../business/BusinessContext';
import { useAuth } from '../../auth/AuthContext';
import {
  listStrategyDocuments,
  uploadStrategyDocument,
  replaceStrategyDocument,
  getStrategyDocumentSignedUrl,
  type StrategyDocumentRow,
} from '../../services/strategyDocuments';

const STRATEGY_KEY = 's_corp';

interface DocSlot {
  key: string;
  title: string;
  description: string;
}

const SLOTS: DocSlot[] = [
  {
    key: 'reasonable_compensation',
    title: 'REASONABLE COMPENSATION DOCUMENTATION',
    description:
      'Documentation supporting your reasonable salary determination including comparable industry salary data',
  },
  {
    key: 'annual_board_minutes',
    title: 'ANNUAL BOARD MEETING MINUTES',
    description:
      'Minutes from your annual board meeting documenting key business decisions and compensation discussions',
  },
  {
    key: 'board_of_directors',
    title: 'BOARD OF DIRECTORS DOCUMENTATION',
    description:
      'Documentation establishing your board of directors including member names and roles',
  },
  {
    key: 'accountable_plan',
    title: 'ACCOUNTABLE PLAN ADOPTION DOCUMENT',
    description:
      'Written accountable plan allowing tax-free reimbursement of business expenses to shareholders and employees',
  },
  {
    key: 'articles_of_incorporation',
    title: 'ARTICLES OF INCORPORATION',
    description:
      'Your state-filed articles of incorporation establishing the corporation',
  },
  {
    key: 's_election_acceptance',
    title: 'IRS S-ELECTION ACCEPTANCE LETTER',
    description:
      'IRS CP261 or equivalent letter confirming acceptance of your S-Corp election (Form 2553)',
  },
  {
    key: 'operating_agreement',
    title: 'OPERATING AGREEMENT',
    description:
      'Shareholder agreement governing the operation and management of the S-Corp',
  },
  {
    key: 'form_2553',
    title: 'IRS FORM 2553 — S-ELECTION FILING',
    description:
      'Your filed Form 2553 electing S-Corp tax treatment',
  },
];

export const SCorpComplianceScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { activeBusinessId, activeBusiness } = useBusiness();
  const { fullName } = useAuth();
  const [rows, setRows] = useState<StrategyDocumentRow[]>([]);
  const [planOpen, setPlanOpen] = useState(false);
  const [resolutionOpen, setResolutionOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  const businessName = activeBusiness?.business_name ?? 'Your Company';
  const signerName = fullName ?? '';

  const refresh = useCallback(async () => {
    try {
      const list = await listStrategyDocuments(STRATEGY_KEY, activeBusinessId);
      setRows(list);
    } catch (e) {
      Alert.alert('Could not load documents', e instanceof Error ? e.message : String(e));
    }
  }, [activeBusinessId]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  // Latest row per slot — slots are single-doc here, but if there are
  // duplicates we show the most recent (rows are pre-sorted desc by upload).
  const bySlot = new Map<string, StrategyDocumentRow>();
  for (const r of rows) if (!bySlot.has(r.document_key)) bySlot.set(r.document_key, r);

  const completedCount = SLOTS.reduce(
    (n, slot) => n + (bySlot.has(slot.key) ? 1 : 0),
    0,
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
      if (existingId) {
        await replaceStrategyDocument(existingId, input);
      } else {
        await uploadStrategyDocument(input);
      }
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

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.title}>S-Corp Compliance Documents</Text>
        <Text style={styles.subtitle}>
          Upload all required documents to establish and maintain your S-Corp strategy
        </Text>
      </View>

      <View style={styles.progressCard}>
        <View style={styles.progressRow}>
          <Text style={styles.progressLabel}>
            {completedCount} of {SLOTS.length} documents complete
          </Text>
          <Text style={styles.progressPct}>
            {Math.round((completedCount / SLOTS.length) * 100)}%
          </Text>
        </View>
        <ProgressBar
          value={completedCount}
          total={SLOTS.length}
          color={colors.teal}
          trackColor={colors.tealLight}
          height={10}
        />
      </View>

      <View style={styles.generateCard}>
        <Text style={styles.generateTitle}>Generate signed documents</Text>
        <Text style={styles.generateSub}>
          Create a pre-filled, signature-ready PDF for your S-Corp compliance file
        </Text>
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.generateBtn}
          onPress={() => setPlanOpen(true)}
        >
          <Ionicons name="create-outline" size={18} color={colors.white} />
          <Text style={styles.generateBtnText}>Generate Accountable Plan</Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.generateBtn, styles.generateBtnSpace]}
          onPress={() => setResolutionOpen(true)}
        >
          <Ionicons name="document-text-outline" size={18} color={colors.white} />
          <Text style={styles.generateBtnText}>Generate Board Resolution</Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.generateBtn, styles.generateBtnSpace]}
          onPress={() => setManualOpen(true)}
        >
          <Ionicons name="clipboard-outline" size={18} color={colors.white} />
          <Text style={styles.generateBtnText}>Create Manual Minutes</Text>
        </TouchableOpacity>
        <View style={styles.reportRow}>
          <ComplianceReportButton
            onGenerate={() =>
              generateSCorpReport({
                businessId: activeBusinessId,
                clientName: signerName || businessName,
              })
            }
          />
        </View>
      </View>

      <View style={styles.listCard}>
        {SLOTS.map((slot) => {
          const row = bySlot.get(slot.key) ?? null;
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

      <AccountablePlanModal
        visible={planOpen}
        businessId={activeBusinessId}
        businessName={businessName}
        defaultSignerName={signerName}
        onClose={() => setPlanOpen(false)}
        onGenerated={refresh}
      />
      <BoardResolutionModal
        visible={resolutionOpen}
        businessId={activeBusinessId}
        businessName={businessName}
        defaultSignerName={signerName}
        onClose={() => setResolutionOpen(false)}
        onGenerated={refresh}
      />
      <ManualMinutesModal
        visible={manualOpen}
        strategy="s_corp"
        businessId={activeBusinessId}
        businessName={businessName}
        clientName={signerName || null}
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
  progressCard: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadow.card,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  progressLabel: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 14,
    fontWeight: '600',
  },
  progressPct: {
    ...typography.bodyMedium,
    color: colors.teal,
    fontSize: 14,
    fontWeight: '700',
  },
  listCard: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    ...shadow.card,
  },
  generateCard: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    ...shadow.card,
  },
  generateTitle: {
    ...typography.h3,
    color: colors.navy,
    fontSize: 15,
    fontWeight: '700',
  },
  generateSub: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
    marginBottom: spacing.md,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingVertical: 13,
  },
  generateBtnSpace: {
    marginTop: spacing.sm,
  },
  reportRow: {
    marginTop: spacing.md,
  },
  generateBtnText: {
    ...typography.bodyMedium,
    color: colors.white,
    fontWeight: '700',
    fontSize: 14,
  },
});
