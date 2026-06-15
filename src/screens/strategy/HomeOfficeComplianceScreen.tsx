// Home Office Compliance Documents screen.
//
// Four sections:
//   1. Square-footage calculator + supporting doc upload
//   2. Utility records: download template + upload completed records
//   3. Residence documentation: own (closing disclosure) or rent (lease)
//   4. Renovation receipts: multiple uploads with per-receipt amount + total
//
// The four-of-four progress indicator at the top considers a section complete
// when at least one file is present for that section's document_key.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { colors, radius, shadow, spacing, typography } from '../../theme';
import { ProgressBar } from '../../components/ProgressBar';
import { DocumentUploadRow } from '../../components/DocumentUploadRow';
import { ComplianceReportButton } from '../../components/ComplianceReportButton';
import { generateHomeOfficeReport } from '../../services/complianceReports';
import { useBusiness } from '../../business/BusinessContext';
import { useAuth } from '../../auth/AuthContext';
import {
  listStrategyDocuments,
  uploadStrategyDocument,
  replaceStrategyDocument,
  deleteStrategyDocument,
  updateStrategyDocumentMetadata,
  getStrategyDocumentSignedUrl,
  type StrategyDocumentRow,
} from '../../services/strategyDocuments';

const STRATEGY_KEY = 'home_office';

const DOC_SQUARE_FOOTAGE = 'square_footage';
const DOC_UTILITIES = 'utilities';
const DOC_CLOSING = 'closing_disclosure';
const DOC_LEASE = 'lease_agreement';
const DOC_RENOVATION = 'renovation_receipt';

type Residence = 'own' | 'rent';

const calcPct = (office: number, total: number): number | null => {
  if (!Number.isFinite(office) || !Number.isFinite(total) || total <= 0 || office <= 0) {
    return null;
  }
  if (office > total) return null;
  return (office / total) * 100;
};

const formatPct = (pct: number | null): string => {
  if (pct === null) return '—';
  return `${pct.toFixed(1)}%`;
};

const parseAmount = (s: string): number => {
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const formatMoney = (n: number): string =>
  `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const buildUtilityTemplateHtml = (): string => `
<!DOCTYPE html>
<html><head><meta charset="utf-8"/><style>
  body { font-family: -apple-system, system-ui, sans-serif; padding: 32px; color: #1A1A2E; }
  h1 { color: #042C53; font-size: 22px; margin-bottom: 4px; }
  p.sub { color: #6B7280; font-size: 12px; margin-top: 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 24px; font-size: 12px; }
  th, td { border: 1px solid #CCCCCC; padding: 8px; text-align: left; }
  th { background: #E1F5EE; color: #085041; }
  td.amount { text-align: right; }
</style></head><body>
  <h1>Home Office — Utility Tracking</h1>
  <p class="sub">Record monthly utility costs. Your deductible portion equals your home office percentage applied to each total.</p>
  <table>
    <thead><tr>
      <th>Month</th><th>Electric</th><th>Gas</th><th>Water</th><th>Internet</th><th>Trash</th><th class="amount">Total</th>
    </tr></thead>
    <tbody>
      ${['January','February','March','April','May','June','July','August','September','October','November','December']
        .map((m) => `<tr><td>${m}</td><td></td><td></td><td></td><td></td><td></td><td class="amount"></td></tr>`)
        .join('')}
      <tr><td><strong>Annual Total</strong></td><td></td><td></td><td></td><td></td><td></td><td class="amount"></td></tr>
    </tbody>
  </table>
</body></html>
`;

export const HomeOfficeComplianceScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useBusiness();
  const { fullName } = useAuth();

  const [rows, setRows] = useState<StrategyDocumentRow[]>([]);
  const [totalSqft, setTotalSqft] = useState('');
  const [officeSqft, setOfficeSqft] = useState('');
  const [residence, setResidence] = useState<Residence>('own');

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

  const squareFootageRow = useMemo(
    () => rows.find((r) => r.document_key === DOC_SQUARE_FOOTAGE) ?? null,
    [rows],
  );
  const utilitiesRow = useMemo(
    () => rows.find((r) => r.document_key === DOC_UTILITIES) ?? null,
    [rows],
  );
  const closingRow = useMemo(
    () => rows.find((r) => r.document_key === DOC_CLOSING) ?? null,
    [rows],
  );
  const leaseRow = useMemo(
    () => rows.find((r) => r.document_key === DOC_LEASE) ?? null,
    [rows],
  );
  const renovationRows = useMemo(
    () => rows.filter((r) => r.document_key === DOC_RENOVATION),
    [rows],
  );

  // Hydrate inputs and the residence radio from saved metadata on first load.
  useEffect(() => {
    if (squareFootageRow && totalSqft === '' && officeSqft === '') {
      const total = squareFootageRow.metadata?.total_sqft;
      const office = squareFootageRow.metadata?.office_sqft;
      if (typeof total === 'number' && total > 0) setTotalSqft(String(total));
      if (typeof office === 'number' && office > 0) setOfficeSqft(String(office));
    }
    if (closingRow && !leaseRow) setResidence('own');
    else if (leaseRow && !closingRow) setResidence('rent');
  }, [squareFootageRow, closingRow, leaseRow]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalN = parseFloat(totalSqft);
  const officeN = parseFloat(officeSqft);
  const pct = calcPct(officeN, totalN);

  // Persist the calc to the square_footage row's metadata if it already
  // exists; otherwise the calc is stored as part of the next upload.
  const persistCalc = useCallback(async () => {
    if (!squareFootageRow) return;
    try {
      await updateStrategyDocumentMetadata(squareFootageRow.id, {
        ...squareFootageRow.metadata,
        total_sqft: Number.isFinite(totalN) ? totalN : null,
        office_sqft: Number.isFinite(officeN) ? officeN : null,
        percentage: pct,
      });
    } catch {
      // Best-effort: silent failure is preferable to a popup on every blur.
    }
  }, [squareFootageRow, totalN, officeN, pct]);

  const pickFile = async (): Promise<DocumentPicker.DocumentPickerAsset | null> => {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return null;
    return result.assets?.[0] ?? null;
  };

  const handleUpload = async (
    documentKey: string,
    existingId: string | null,
    extraMetadata: Record<string, unknown> = {},
  ) => {
    try {
      const file = await pickFile();
      if (!file) return;
      const input = {
        strategyKey: STRATEGY_KEY,
        documentKey,
        businessId: activeBusinessId,
        localUri: file.uri,
        fileName: file.name,
        mimeType: file.mimeType ?? null,
        metadata: extraMetadata,
      };
      if (existingId) await replaceStrategyDocument(existingId, input);
      else await uploadStrategyDocument(input);
      await refresh();
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : String(e));
    }
  };

  const handleSqftUpload = async (existingId: string | null) => {
    await handleUpload(DOC_SQUARE_FOOTAGE, existingId, {
      total_sqft: Number.isFinite(totalN) ? totalN : null,
      office_sqft: Number.isFinite(officeN) ? officeN : null,
      percentage: pct,
    });
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

  const downloadUtilityTemplate = async () => {
    try {
      const { uri } = await Print.printToFileAsync({ html: buildUtilityTemplateHtml() });
      const available = await Sharing.isAvailableAsync();
      if (available) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Utility Tracking Template',
          UTI: 'com.adobe.pdf',
        });
      } else {
        Alert.alert('Template generated', `Saved to ${uri}`);
      }
    } catch (e) {
      Alert.alert('Could not generate template', e instanceof Error ? e.message : String(e));
    }
  };

  const addReceipt = async () => {
    try {
      const file = await pickFile();
      if (!file) return;
      await uploadStrategyDocument({
        strategyKey: STRATEGY_KEY,
        documentKey: DOC_RENOVATION,
        businessId: activeBusinessId,
        localUri: file.uri,
        fileName: file.name,
        mimeType: file.mimeType ?? null,
        metadata: { amount: 0 },
      });
      await refresh();
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : String(e));
    }
  };

  const updateReceiptAmount = async (row: StrategyDocumentRow, raw: string) => {
    const amount = parseAmount(raw);
    // Update local list optimistically so the running total moves immediately.
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id ? { ...r, metadata: { ...r.metadata, amount } } : r,
      ),
    );
    try {
      await updateStrategyDocumentMetadata(row.id, { ...row.metadata, amount });
    } catch (e) {
      Alert.alert('Could not save amount', e instanceof Error ? e.message : String(e));
      await refresh();
    }
  };

  const removeReceipt = async (row: StrategyDocumentRow) => {
    try {
      await deleteStrategyDocument(row.id);
      await refresh();
    } catch (e) {
      Alert.alert('Could not remove', e instanceof Error ? e.message : String(e));
    }
  };

  const renovationTotal = renovationRows.reduce((sum, r) => {
    const amt = r.metadata?.amount;
    return sum + (typeof amt === 'number' ? amt : 0);
  }, 0);
  const deductiblePortion = pct !== null ? renovationTotal * (pct / 100) : 0;

  // Section completion: each of the four sections counts independently.
  const section1Done = squareFootageRow !== null && squareFootageRow.file_url !== null;
  const section2Done = utilitiesRow !== null && utilitiesRow.file_url !== null;
  const section3Done =
    (residence === 'own' && closingRow !== null) ||
    (residence === 'rent' && leaseRow !== null) ||
    closingRow !== null ||
    leaseRow !== null;
  const section4Done = renovationRows.length > 0;
  const sectionsComplete =
    Number(section1Done) + Number(section2Done) + Number(section3Done) + Number(section4Done);

  const pctLabel = pct !== null ? `${pct.toFixed(1)}%` : 'your calculated percentage';

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.title}>Home Office Compliance Documents</Text>
        <Text style={styles.subtitle}>
          Document your home office deduction and maintain required records
        </Text>
      </View>

      <View style={styles.progressCard}>
        <View style={styles.progressRow}>
          <Text style={styles.progressLabel}>
            {sectionsComplete} of 4 sections complete
          </Text>
          <Text style={styles.progressPct}>
            {Math.round((sectionsComplete / 4) * 100)}%
          </Text>
        </View>
        <ProgressBar
          value={sectionsComplete}
          total={4}
          color={colors.teal}
          trackColor={colors.tealLight}
          height={10}
        />
        <View style={styles.reportRow}>
          <ComplianceReportButton
            onGenerate={() =>
              generateHomeOfficeReport({
                businessId: activeBusinessId,
                clientName: fullName ?? 'Client',
              })
            }
          />
        </View>
      </View>

      {/* ─── Section 1: Square footage calculator ─────────────────────── */}
      <View style={styles.sectionCard}>
        <SectionHeading icon={section1Done ? 'checkmark-circle' : 'calculator-outline'} title="Square Footage Calculator" done={section1Done} />
        <View style={styles.calcRow}>
          <View style={styles.calcInputWrap}>
            <Text style={styles.inputLabel}>Total home square footage</Text>
            <TextInput
              value={totalSqft}
              onChangeText={setTotalSqft}
              onBlur={persistCalc}
              placeholder="e.g. 2400"
              keyboardType="numeric"
              style={styles.input}
              placeholderTextColor={colors.subtleText}
            />
          </View>
          <View style={styles.calcInputWrap}>
            <Text style={styles.inputLabel}>Home office square footage</Text>
            <TextInput
              value={officeSqft}
              onChangeText={setOfficeSqft}
              onBlur={persistCalc}
              placeholder="e.g. 300"
              keyboardType="numeric"
              style={styles.input}
              placeholderTextColor={colors.subtleText}
            />
          </View>
        </View>
        <View style={styles.pctCard}>
          <Text style={styles.pctCardLabel}>Your home office deduction percentage is</Text>
          <Text style={styles.pctCardValue}>{formatPct(pct)}</Text>
        </View>
        <Text style={styles.pctNote}>
          This percentage applies to eligible home expenses including utilities, mortgage interest, and repairs
        </Text>

        <DocumentUploadRow
          title="SQUARE FOOTAGE DOCUMENTATION"
          description="Upload a document, floor plan, or measurement record confirming your home's total square footage and the exclusive business use area"
          uploaded={
            squareFootageRow && squareFootageRow.file_url
              ? {
                  fileName: squareFootageRow.document_name ?? 'Document',
                  uploadedAt: squareFootageRow.uploaded_at,
                }
              : null
          }
          onUpload={() => handleSqftUpload(null)}
          onReplace={squareFootageRow ? () => handleSqftUpload(squareFootageRow.id) : undefined}
          onView={squareFootageRow ? () => viewDoc(squareFootageRow) : undefined}
        />
      </View>

      {/* ─── Section 2: Utilities ─────────────────────────────────────── */}
      <View style={styles.sectionCard}>
        <SectionHeading icon={section2Done ? 'checkmark-circle' : 'flash-outline'} title="Utilities" done={section2Done} />
        <Text style={styles.sectionDesc}>
          Upload your utility bills showing home expenses. Your deductible portion is {pctLabel} of total utilities.
        </Text>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={downloadUtilityTemplate}
          style={styles.downloadBtn}
        >
          <Ionicons name="download-outline" size={18} color={colors.navy} />
          <Text style={styles.downloadBtnText}>Download Utilities Tracking Template</Text>
        </TouchableOpacity>

        <DocumentUploadRow
          title="UPLOAD COMPLETED UTILITY RECORDS"
          description="After you fill in the tracking template, upload the completed file here"
          uploaded={
            utilitiesRow && utilitiesRow.file_url
              ? {
                  fileName: utilitiesRow.document_name ?? 'Document',
                  uploadedAt: utilitiesRow.uploaded_at,
                }
              : null
          }
          onUpload={() => handleUpload(DOC_UTILITIES, null)}
          onReplace={utilitiesRow ? () => handleUpload(DOC_UTILITIES, utilitiesRow.id) : undefined}
          onView={utilitiesRow ? () => viewDoc(utilitiesRow) : undefined}
        />
      </View>

      {/* ─── Section 3: Residence documentation ───────────────────────── */}
      <View style={styles.sectionCard}>
        <SectionHeading icon={section3Done ? 'checkmark-circle' : 'home-outline'} title="Closing Disclosure or Lease Agreement" done={section3Done} />
        <Text style={styles.sectionDesc}>
          Upload your closing disclosure if you own your home, or your lease agreement if you rent. This establishes your housing costs for deduction purposes.
        </Text>

        <View style={styles.radioGroup}>
          <RadioRow
            label="I own my home — upload Closing Disclosure"
            selected={residence === 'own'}
            onPress={() => setResidence('own')}
          />
          <RadioRow
            label="I rent — upload Lease Agreement"
            selected={residence === 'rent'}
            onPress={() => setResidence('rent')}
          />
        </View>

        {residence === 'own' ? (
          <DocumentUploadRow
            title="CLOSING DISCLOSURE"
            uploaded={
              closingRow && closingRow.file_url
                ? {
                    fileName: closingRow.document_name ?? 'Document',
                    uploadedAt: closingRow.uploaded_at,
                  }
                : null
            }
            onUpload={() => handleUpload(DOC_CLOSING, null)}
            onReplace={closingRow ? () => handleUpload(DOC_CLOSING, closingRow.id) : undefined}
            onView={closingRow ? () => viewDoc(closingRow) : undefined}
          />
        ) : (
          <DocumentUploadRow
            title="LEASE AGREEMENT"
            uploaded={
              leaseRow && leaseRow.file_url
                ? {
                    fileName: leaseRow.document_name ?? 'Document',
                    uploadedAt: leaseRow.uploaded_at,
                  }
                : null
            }
            onUpload={() => handleUpload(DOC_LEASE, null)}
            onReplace={leaseRow ? () => handleUpload(DOC_LEASE, leaseRow.id) : undefined}
            onView={leaseRow ? () => viewDoc(leaseRow) : undefined}
          />
        )}
      </View>

      {/* ─── Section 4: Renovation receipts (multi) ───────────────────── */}
      <View style={styles.sectionCard}>
        <SectionHeading icon={section4Done ? 'checkmark-circle' : 'hammer-outline'} title="Major Renovation Receipts" done={section4Done} />
        <Text style={styles.sectionDesc}>
          Upload receipts for significant home improvements. Your deductible portion is {pctLabel} of qualifying renovation costs.
        </Text>

        {renovationRows.map((row) => {
          const amount = typeof row.metadata?.amount === 'number' ? row.metadata.amount : 0;
          return (
            <View key={row.id} style={styles.receiptCard}>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => viewDoc(row)}
                style={styles.receiptHeader}
              >
                <Ionicons name="document-text" size={16} color={colors.teal} />
                <View style={styles.receiptHeaderText}>
                  <Text style={styles.receiptName} numberOfLines={1}>
                    {row.document_name ?? 'Receipt'}
                  </Text>
                  <Text style={styles.receiptMeta}>
                    {new Date(row.uploaded_at).toLocaleDateString()}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => removeReceipt(row)} hitSlop={8}>
                  <Ionicons name="close-circle" size={20} color={colors.mutedText} />
                </TouchableOpacity>
              </TouchableOpacity>
              <View style={styles.receiptAmountRow}>
                <Text style={styles.receiptAmountLabel}>Receipt total</Text>
                <View style={styles.receiptAmountInputWrap}>
                  <Text style={styles.dollar}>$</Text>
                  <TextInput
                    value={amount > 0 ? String(amount) : ''}
                    onChangeText={(t) => updateReceiptAmount(row, t)}
                    placeholder="0.00"
                    keyboardType="decimal-pad"
                    style={styles.amountInput}
                    placeholderTextColor={colors.subtleText}
                  />
                </View>
              </View>
            </View>
          );
        })}

        <TouchableOpacity activeOpacity={0.85} onPress={addReceipt} style={styles.addReceiptBtn}>
          <Ionicons name="add-circle-outline" size={18} color={colors.navy} />
          <Text style={styles.addReceiptText}>Add Receipt</Text>
        </TouchableOpacity>

        {renovationRows.length > 0 ? (
          <View style={styles.totalsCard}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Total renovation costs</Text>
              <Text style={styles.totalsValue}>{formatMoney(renovationTotal)}</Text>
            </View>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Deductible portion {pct !== null ? `(${pct.toFixed(1)}%)` : ''}</Text>
              <Text style={[styles.totalsValue, { color: colors.teal }]}>{formatMoney(deductiblePortion)}</Text>
            </View>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
};

const SectionHeading: React.FC<{ title: string; icon: keyof typeof Ionicons.glyphMap; done: boolean }> = ({
  title, icon, done,
}) => (
  <View style={headingStyles.row}>
    <View
      style={[
        headingStyles.iconWrap,
        { backgroundColor: done ? colors.tealLight : colors.lightBlue },
      ]}
    >
      <Ionicons name={icon} size={18} color={done ? colors.teal : colors.midNavy} />
    </View>
    <Text style={headingStyles.title}>{title}</Text>
  </View>
);

const RadioRow: React.FC<{ label: string; selected: boolean; onPress: () => void }> = ({
  label, selected, onPress,
}) => (
  <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={radioStyles.row}>
    <View style={[radioStyles.outer, selected && radioStyles.outerSelected]}>
      {selected ? <View style={radioStyles.inner} /> : null}
    </View>
    <Text style={radioStyles.label}>{label}</Text>
  </TouchableOpacity>
);

const headingStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.h3,
    color: colors.navy,
    fontSize: 16,
    fontWeight: '700',
  },
});

const radioStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 8,
  },
  outer: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#CCCCCC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outerSelected: {
    borderColor: colors.teal,
  },
  inner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.teal,
  },
  label: {
    ...typography.body,
    color: colors.bodyText,
    fontSize: 13,
    flex: 1,
  },
});

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
  reportRow: {
    marginTop: spacing.md,
  },
  sectionCard: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    ...shadow.card,
  },
  sectionDesc: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: spacing.md,
  },
  calcRow: {
    gap: spacing.md,
  },
  calcInputWrap: {
    gap: 4,
  },
  inputLabel: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  input: {
    ...typography.body,
    fontSize: 14,
    color: colors.bodyText,
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pctCard: {
    backgroundColor: colors.tealLight,
    borderRadius: 10,
    padding: spacing.lg,
    marginTop: spacing.md,
    alignItems: 'center',
    gap: 4,
  },
  pctCardLabel: {
    ...typography.caption,
    color: colors.teal,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  pctCardValue: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.teal,
    letterSpacing: -0.5,
  },
  pctNote: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: spacing.md,
  },
  downloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.navy,
    backgroundColor: colors.white,
    marginBottom: spacing.md,
  },
  downloadBtnText: {
    ...typography.bodyMedium,
    color: colors.navy,
    fontSize: 13,
    fontWeight: '700',
  },
  radioGroup: {
    gap: 2,
    marginBottom: spacing.md,
  },
  receiptCard: {
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    padding: 12,
    marginBottom: spacing.sm,
  },
  receiptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  receiptHeaderText: {
    flex: 1,
  },
  receiptName: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 13,
    fontWeight: '600',
  },
  receiptMeta: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    marginTop: 1,
  },
  receiptAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  receiptAmountLabel: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 12,
  },
  receiptAmountInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: 8,
    minWidth: 120,
  },
  dollar: {
    ...typography.bodyMedium,
    color: colors.mutedText,
    fontSize: 13,
  },
  amountInput: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 13,
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 4,
    textAlign: 'right',
  },
  addReceiptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#CCCCCC',
    marginTop: spacing.sm,
  },
  addReceiptText: {
    ...typography.bodyMedium,
    color: colors.navy,
    fontSize: 13,
    fontWeight: '600',
  },
  totalsCard: {
    backgroundColor: colors.tealLight,
    borderRadius: 10,
    padding: spacing.md,
    marginTop: spacing.md,
    gap: 6,
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalsLabel: {
    ...typography.body,
    color: colors.bodyText,
    fontSize: 12,
    fontWeight: '500',
  },
  totalsValue: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 14,
    fontWeight: '700',
  },
});
