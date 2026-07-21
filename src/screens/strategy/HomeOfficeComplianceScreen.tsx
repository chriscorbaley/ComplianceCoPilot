// Home Office Compliance Documents screen.
//
// Four sections:
//   1. Square-footage calculator + supporting doc upload
//   2. Utility expenses: required utility-bill upload + per-category tracker
//   3. Residence documentation: own (closing disclosure) or rent (lease)
//   4. Renovation receipts: multiple uploads with per-receipt amount + total
//
// The four-of-four progress indicator uses computeStrategyCompletion — the same
// shared source of truth the Dashboard cards and Documents tab use — so a
// section counts complete only when a file is present for its registry slot
// (square_footage, utilities, closing_disclosure/lease, renovation_receipt).
// The numeric utility tracker is supplementary metadata that feeds the
// deduction report; the required "utilities" slot is the uploaded utility bill.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
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
import { colors, radius, shadow, spacing, typography } from '../../theme';
import { contentContainerStyle } from '../../constants/layout';
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
  upsertStrategyMetadataRow,
  getStrategyDocumentSignedUrl,
  type StrategyDocumentRow,
} from '../../services/strategyDocuments';
import { computeStrategyCompletion } from '../../services/strategyComplianceSlots';

const STRATEGY_KEY = 'home_office';

const DOC_SQUARE_FOOTAGE = 'square_footage';
// Uploaded utility bill — the required document the compliance registry scores
// (key 'utilities'). Distinct from DOC_UTILITY_DATA below, which is the
// metadata-only numeric tracker that feeds the deduction estimate/report.
const DOC_UTILITY_BILL = 'utilities';
const DOC_UTILITY_DATA = 'utility_expenses';
const DOC_CLOSING = 'closing_disclosure';
const DOC_LEASE = 'lease_agreement';
const DOC_RENOVATION = 'renovation_receipt';

type Residence = 'own' | 'rent';
type UtilityMethod = 'monthly' | 'annual';

// One tracked utility/home-expense category. Each is stored independently under
// metadata.categories[key] with its own method + monthly/annual values.
interface CategoryData {
  method: UtilityMethod;
  monthly_entries: Record<string, number>;
  annual_total: number;
}

// The selectable expense categories (Fix 3). `key` is the stable metadata key.
const UTILITY_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: 'mortgage_interest', label: 'Mortgage Interest' },
  { key: 'property_taxes', label: 'Property Taxes' },
  { key: 'rent', label: 'Rent' },
  { key: 'hoa_condo_fees', label: 'HOA / Condo Fees' },
  { key: 'homeowners_renters_insurance', label: "Homeowner's / Renter's Insurance" },
  { key: 'electricity', label: 'Electricity' },
  { key: 'gas', label: 'Gas' },
  { key: 'water_sewage', label: 'Water & Sewage' },
  { key: 'trash', label: 'Trash' },
  { key: 'internet', label: 'Internet' },
  { key: 'heating_cooling', label: 'Heating and Cooling' },
  { key: 'general_repairs', label: 'General Repairs' },
  { key: 'cleaning', label: 'Cleaning' },
  { key: 'pest_control', label: 'Pest Control' },
  { key: 'landscaping', label: 'Landscaping' },
  { key: 'other', label: 'Other' },
];

const categoryLabel = (key: string): string =>
  UTILITY_CATEGORIES.find((c) => c.key === key)?.label ?? key;

// Month keys stored in metadata.categories[*].monthly_entries and display labels.
const UTILITY_MONTHS: Array<{ key: string; label: string }> = [
  { key: 'january', label: 'January' },
  { key: 'february', label: 'February' },
  { key: 'march', label: 'March' },
  { key: 'april', label: 'April' },
  { key: 'may', label: 'May' },
  { key: 'june', label: 'June' },
  { key: 'july', label: 'July' },
  { key: 'august', label: 'August' },
  { key: 'september', label: 'September' },
  { key: 'october', label: 'October' },
  { key: 'november', label: 'November' },
  { key: 'december', label: 'December' },
];

// The annual amount a single category contributes (monthly sum or annual total).
const categoryAnnual = (d: CategoryData): number =>
  d.method === 'annual'
    ? d.annual_total
    : UTILITY_MONTHS.reduce((s, { key }) => s + (d.monthly_entries[key] ?? 0), 0);

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

export const HomeOfficeComplianceScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useBusiness();
  const { fullName } = useAuth();

  const [rows, setRows] = useState<StrategyDocumentRow[]>([]);
  const [totalSqft, setTotalSqft] = useState('');
  const [officeSqft, setOfficeSqft] = useState('');
  const [residence, setResidence] = useState<Residence>('own');

  // Utility expense tracking (Fix 3): one entry per category, each with its own
  // monthly/annual method. `categories` is the committed numeric model persisted
  // to a metadata-only strategy_documents row. The currently-selected category
  // is edited through string buffers (catMethod/catMonthly/catAnnual) and
  // committed back into `categories` on blur or method change.
  const [categories, setCategories] = useState<Record<string, CategoryData>>({});
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [catMethod, setCatMethod] = useState<UtilityMethod>('monthly');
  const [catMonthly, setCatMonthly] = useState<Record<string, string>>({});
  const [catAnnual, setCatAnnual] = useState('');
  const [catPickerOpen, setCatPickerOpen] = useState(false);
  const [utilityHydrated, setUtilityHydrated] = useState(false);

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
  const utilityBillRow = useMemo(
    () => rows.find((r) => r.document_key === DOC_UTILITY_BILL) ?? null,
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

  // Persist the calc even when no supporting document has been uploaded yet, so
  // the sqft-derived percentage is always available to the compliance report.
  // upsertStrategyMetadataRow updates the existing row's metadata in place
  // (preserving any uploaded file) or creates a metadata-only row (file_url
  // null, which never counts toward "documents complete").
  const persistCalc = useCallback(async () => {
    // Nothing to persist until at least one dimension has been entered.
    if (!Number.isFinite(totalN) && !Number.isFinite(officeN)) return;
    try {
      const savedMetadata = {
        ...(squareFootageRow?.metadata ?? {}),
        total_sqft: Number.isFinite(totalN) ? totalN : null,
        office_sqft: Number.isFinite(officeN) ? officeN : null,
        percentage: pct,
      };
      console.log('[HomeOffice Save] metadata:', JSON.stringify(savedMetadata));
      const saved = await upsertStrategyMetadataRow({
        strategyKey: STRATEGY_KEY,
        documentKey: DOC_SQUARE_FOOTAGE,
        businessId: activeBusinessId,
        metadata: savedMetadata,
      });
      // Keep the local row list in sync so the row id exists for a later upload
      // without a full refresh (which would clobber in-progress input elsewhere).
      setRows((prev) => [saved, ...prev.filter((r) => r.id !== saved.id)]);
    } catch {
      // Best-effort: silent failure is preferable to a popup on every blur.
    }
  }, [squareFootageRow, totalN, officeN, pct, activeBusinessId]);

  // ── Utility expense tracking (per category) ──────────────────────────────
  const utilityRow = useMemo(
    () => rows.find((r) => r.document_key === DOC_UTILITY_DATA) ?? null,
    [rows],
  );

  // Hydrate categories from saved metadata once, when the row first loads.
  useEffect(() => {
    if (utilityHydrated || !utilityRow) return;
    const m = utilityRow.metadata ?? {};
    const saved = (m.categories ?? {}) as Record<string, unknown>;
    const seeded: Record<string, CategoryData> = {};
    for (const [catKey, raw] of Object.entries(saved)) {
      const v = (raw ?? {}) as {
        method?: string;
        monthly_entries?: Record<string, unknown>;
        annual_total?: unknown;
      };
      const monthly_entries: Record<string, number> = {};
      for (const { key } of UTILITY_MONTHS) {
        const n = v.monthly_entries?.[key];
        monthly_entries[key] = typeof n === 'number' ? n : 0;
      }
      seeded[catKey] = {
        method: v.method === 'annual' ? 'annual' : 'monthly',
        monthly_entries,
        annual_total: typeof v.annual_total === 'number' ? v.annual_total : 0,
      };
    }
    setCategories(seeded);
    setUtilityHydrated(true);
  }, [utilityRow, utilityHydrated]);

  // Grand total across all committed categories, and the deductible portion.
  const utilityGrandTotal = useMemo(
    () => Object.values(categories).reduce((s, d) => s + categoryAnnual(d), 0),
    [categories],
  );
  const utilityDeduction = pct !== null ? utilityGrandTotal * (pct / 100) : 0;

  // Persist the full category set to the metadata-only row. Best-effort: a
  // silent failure is preferable to a popup on every blur.
  const persistUtilities = useCallback(
    async (cats: Record<string, CategoryData>) => {
      const grand = Object.values(cats).reduce((s, d) => s + categoryAnnual(d), 0);
      const deduction = pct !== null ? grand * (pct / 100) : 0;
      try {
        const savedMetadata = {
          categories: cats,
          calculated_deduction: deduction,
          office_percentage: pct ?? 0,
          last_updated: new Date().toISOString(),
        };
        console.log('[HomeOffice Save] metadata:', JSON.stringify(savedMetadata));
        const saved = await upsertStrategyMetadataRow({
          strategyKey: STRATEGY_KEY,
          documentKey: DOC_UTILITY_DATA,
          businessId: activeBusinessId,
          metadata: savedMetadata,
        });
        // Keep the local row list in sync so the row id exists for later updates
        // without forcing a full refresh (which would clobber in-progress input).
        setRows((prev) => {
          const without = prev.filter(
            (r) => r.id !== saved.id && r.document_key !== DOC_UTILITY_DATA,
          );
          return [saved, ...without];
        });
      } catch {
        // Best-effort: silent failure is preferable to a popup on every blur.
      }
    },
    [pct, activeBusinessId],
  );

  // Load a category's saved values into the editing buffers for display/edit.
  const selectCategory = useCallback(
    (key: string) => {
      const d = categories[key];
      setSelectedCat(key);
      setCatMethod(d?.method ?? 'monthly');
      const seeded: Record<string, string> = {};
      if (d) {
        for (const { key: mk } of UTILITY_MONTHS) {
          const v = d.monthly_entries[mk];
          if (typeof v === 'number' && v > 0) seeded[mk] = String(v);
        }
      }
      setCatMonthly(seeded);
      setCatAnnual(d && d.annual_total > 0 ? String(d.annual_total) : '');
    },
    [categories],
  );

  // Commit the current editing buffers into `categories` and persist. A category
  // with no data is dropped so it never appears in the summary or the report.
  const saveSelectedCategory = useCallback(
    (overrideMethod?: UtilityMethod) => {
      if (!selectedCat) return;
      const method = overrideMethod ?? catMethod;
      const monthly_entries: Record<string, number> = {};
      for (const { key } of UTILITY_MONTHS) {
        monthly_entries[key] = parseAmount(catMonthly[key] ?? '');
      }
      const data: CategoryData = {
        method,
        monthly_entries,
        annual_total: parseAmount(catAnnual),
      };
      const next = { ...categories };
      if (categoryAnnual(data) > 0) next[selectedCat] = data;
      else delete next[selectedCat];
      setCategories(next);
      void persistUtilities(next);
    },
    [selectedCat, catMethod, catMonthly, catAnnual, categories, persistUtilities],
  );

  // Live total for the category being edited (reflects un-committed input).
  const editingCategoryTotal = useMemo(
    () =>
      catMethod === 'annual'
        ? parseAmount(catAnnual)
        : UTILITY_MONTHS.reduce((s, { key }) => s + parseAmount(catMonthly[key] ?? ''), 0),
    [catMethod, catAnnual, catMonthly],
  );

  // Categories with data, for the summary list.
  const enteredCategories = useMemo(
    () =>
      Object.entries(categories)
        .filter(([, d]) => categoryAnnual(d) > 0)
        .sort((a, b) => categoryLabel(a[0]).localeCompare(categoryLabel(b[0]))),
    [categories],
  );

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

  // Section completion is derived from the SHARED source of truth
  // (computeStrategyCompletion) so this screen's "4 of 4" can never disagree
  // with the Dashboard card or the Documents tab. A slot counts only when a
  // file is uploaded for its document_key; the closing-disclosure slot is also
  // satisfied by a lease agreement (alias handled inside the helper).
  const completion = useMemo(
    () => computeStrategyCompletion(STRATEGY_KEY, rows),
    [rows],
  );
  const section1Done = completion.satisfied.has(DOC_SQUARE_FOOTAGE);
  const section2Done = completion.satisfied.has(DOC_UTILITY_BILL);
  const section3Done = completion.satisfied.has(DOC_CLOSING);
  const section4Done = completion.satisfied.has(DOC_RENOVATION);
  const sectionsComplete = completion.completed;

  const pctLabel = pct !== null ? `${pct.toFixed(1)}%` : 'your calculated percentage';

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[contentContainerStyle, { gap: spacing.lg }]}>
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
          onUpload={() => handleSqftUpload(squareFootageRow?.id ?? null)}
          onReplace={squareFootageRow ? () => handleSqftUpload(squareFootageRow.id) : undefined}
          onView={squareFootageRow && squareFootageRow.file_url ? () => viewDoc(squareFootageRow) : undefined}
        />
      </View>

      {/* ─── Section 2: Utility expenses (per-category tracker) ───────── */}
      <View style={styles.sectionCard}>
        <SectionHeading
          icon={section2Done ? 'checkmark-circle' : 'flash-outline'}
          title="Utility Expenses"
          done={section2Done}
        />
        <Text style={styles.sectionDesc}>
          Track each home expense category to calculate your home office
          deduction
        </Text>

        {/* Required utility bill upload — this is the document the compliance
            tracker scores (slot 'utilities'). The numeric tracker below is
            supplementary and feeds the deduction report. */}
        <DocumentUploadRow
          title="UTILITY BILLS"
          description="Upload a utility bill (electricity, gas, water, internet, etc.) as your supporting record. This is the document required to complete this section."
          uploaded={
            utilityBillRow && utilityBillRow.file_url
              ? {
                  fileName: utilityBillRow.document_name ?? 'Document',
                  uploadedAt: utilityBillRow.uploaded_at,
                }
              : null
          }
          onUpload={() => handleUpload(DOC_UTILITY_BILL, utilityBillRow?.id ?? null)}
          onReplace={
            utilityBillRow ? () => handleUpload(DOC_UTILITY_BILL, utilityBillRow.id) : undefined
          }
          onView={
            utilityBillRow && utilityBillRow.file_url ? () => viewDoc(utilityBillRow) : undefined
          }
        />

        {/* Category selector */}
        <Text style={styles.inputLabel}>Expense category</Text>
        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.categorySelect}
          onPress={() => setCatPickerOpen(true)}
        >
          <Text style={[styles.categorySelectText, !selectedCat && styles.categorySelectPlaceholder]}>
            {selectedCat ? categoryLabel(selectedCat) : 'Select a category'}
          </Text>
          <Ionicons name="chevron-down" size={18} color={colors.midNavy} />
        </TouchableOpacity>

        {selectedCat ? (
          <>
            <View style={[styles.tabRow, { marginTop: spacing.md }]}>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => {
                  setCatMethod('monthly');
                  saveSelectedCategory('monthly');
                }}
                style={[styles.tab, catMethod === 'monthly' && styles.tabActive]}
              >
                <Text style={[styles.tabText, catMethod === 'monthly' && styles.tabTextActive]}>
                  Monthly Breakdown
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => {
                  setCatMethod('annual');
                  saveSelectedCategory('annual');
                }}
                style={[styles.tab, catMethod === 'annual' && styles.tabActive]}
              >
                <Text style={[styles.tabText, catMethod === 'annual' && styles.tabTextActive]}>
                  Annual Total
                </Text>
              </TouchableOpacity>
            </View>

            {catMethod === 'monthly' ? (
              <View>
                {UTILITY_MONTHS.map(({ key, label }) => (
                  <View key={key} style={styles.monthRow}>
                    <Text style={styles.monthLabel}>{label}</Text>
                    <View style={styles.monthInputWrap}>
                      <Text style={styles.dollar}>$</Text>
                      <TextInput
                        value={catMonthly[key] ?? ''}
                        onChangeText={(t) =>
                          setCatMonthly((prev) => ({ ...prev, [key]: t }))
                        }
                        onBlur={() => saveSelectedCategory()}
                        placeholder="$0.00"
                        keyboardType="decimal-pad"
                        style={styles.amountInput}
                        placeholderTextColor={colors.subtleText}
                      />
                    </View>
                  </View>
                ))}
                <View style={styles.utilTotalRow}>
                  <Text style={styles.utilTotalLabel}>
                    {categoryLabel(selectedCat)} annual total
                  </Text>
                  <Text style={styles.utilTotalValue}>{formatMoney(editingCategoryTotal)}</Text>
                </View>
              </View>
            ) : (
              <View>
                <Text style={styles.inputLabel}>
                  {categoryLabel(selectedCat)} — total annual amount
                </Text>
                <View style={styles.annualInputWrap}>
                  <Text style={styles.dollar}>$</Text>
                  <TextInput
                    value={catAnnual}
                    onChangeText={setCatAnnual}
                    onBlur={() => saveSelectedCategory()}
                    placeholder="e.g. 4,800"
                    keyboardType="decimal-pad"
                    style={styles.amountInput}
                    placeholderTextColor={colors.subtleText}
                  />
                </View>
              </View>
            )}
          </>
        ) : null}

        {/* Summary of categories already entered */}
        {enteredCategories.length > 0 ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Categories entered</Text>
            {enteredCategories.map(([key, data]) => (
              <TouchableOpacity
                key={key}
                activeOpacity={0.7}
                onPress={() => selectCategory(key)}
                style={styles.summaryRow}
              >
                <Text style={styles.summaryLabel} numberOfLines={1}>
                  {categoryLabel(key)}
                </Text>
                <Text style={styles.summaryValue}>{formatMoney(categoryAnnual(data))}</Text>
                <Ionicons name="create-outline" size={16} color={colors.midNavy} />
              </TouchableOpacity>
            ))}
            <View style={styles.summaryDivider} />
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, styles.summaryGrandLabel]}>All categories total</Text>
              <Text style={[styles.summaryValue, styles.summaryGrandValue]}>
                {formatMoney(utilityGrandTotal)}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Deduction estimate */}
        <View style={styles.savingsCard}>
          <Text style={styles.savingsTitle}>Home Office Utility Deduction Estimate</Text>
          <SavingsLine label="Total home expenses" value={formatMoney(utilityGrandTotal)} />
          <SavingsLine label="Office percentage" value={formatPct(pct)} />
          <View style={styles.savingsDivider} />
          <SavingsLine label="Estimated deductible amount" value={formatMoney(utilityDeduction)} emphasize />
        </View>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() =>
            generateHomeOfficeReport({
              businessId: activeBusinessId,
              clientName: fullName ?? 'Client',
            }).catch((e) =>
              Alert.alert('Could not generate report', e instanceof Error ? e.message : String(e)),
            )
          }
          style={styles.utilReportBtn}
        >
          <Ionicons name="document-text-outline" size={18} color={colors.white} />
          <Text style={styles.utilReportBtnText}>Generate Utility Report</Text>
        </TouchableOpacity>

        <Text style={styles.disclaimerNote}>
          This is an estimate only. Consult your tax professional for exact
          deduction amounts.
        </Text>
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

      {/* Category picker (utility expenses) */}
      <Modal
        visible={catPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCatPickerOpen(false)}
      >
        <TouchableOpacity
          style={catPicker.backdrop}
          activeOpacity={1}
          onPress={() => setCatPickerOpen(false)}
        >
          <View style={catPicker.menu}>
            <Text style={catPicker.menuTitle}>Expense category</Text>
            <ScrollView style={catPicker.menuScroll} showsVerticalScrollIndicator={false}>
              {UTILITY_CATEGORIES.map(({ key, label }) => {
                const active = key === selectedCat;
                const filled = categoryAnnual(categories[key] ?? {
                  method: 'monthly',
                  monthly_entries: {},
                  annual_total: 0,
                }) > 0;
                return (
                  <TouchableOpacity
                    key={key}
                    activeOpacity={0.8}
                    style={[catPicker.menuItem, active && catPicker.menuItemActive]}
                    onPress={() => {
                      selectCategory(key);
                      setCatPickerOpen(false);
                    }}
                  >
                    <Text style={[catPicker.menuItemText, active && catPicker.menuItemTextActive]}>
                      {label}
                    </Text>
                    {filled ? (
                      <Ionicons
                        name="checkmark-circle"
                        size={16}
                        color={active ? colors.white : colors.teal}
                      />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
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

const SavingsLine: React.FC<{ label: string; value: string; emphasize?: boolean }> = ({
  label, value, emphasize,
}) => (
  <View style={styles.savingsRow}>
    <Text style={styles.savingsLabel}>{label}</Text>
    <Text style={[styles.savingsValue, emphasize && styles.savingsValueEmph]}>{value}</Text>
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
  categorySelect: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 13,
  },
  categorySelectText: {
    ...typography.body,
    color: colors.bodyText,
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    marginRight: spacing.sm,
  },
  categorySelectPlaceholder: {
    color: colors.subtleText,
    fontWeight: '400',
  },
  summaryCard: {
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: spacing.md,
    marginTop: spacing.lg,
    gap: 8,
  },
  summaryTitle: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  summaryLabel: {
    ...typography.body,
    color: colors.bodyText,
    fontSize: 13,
    flex: 1,
  },
  summaryValue: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 13,
    fontWeight: '700',
  },
  summaryDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginVertical: 2,
  },
  summaryGrandLabel: {
    fontWeight: '700',
  },
  summaryGrandValue: {
    color: colors.teal,
    fontSize: 14,
  },
  utilReportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 10,
    backgroundColor: colors.navy,
    marginTop: spacing.md,
    ...shadow.raised,
  },
  utilReportBtnText: {
    ...typography.bodyMedium,
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  radioGroup: {
    gap: 2,
    marginBottom: spacing.md,
  },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: colors.background,
    borderRadius: 10,
    padding: 3,
    marginBottom: spacing.md,
  },
  tab: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.teal,
  },
  tabText: {
    ...typography.bodyMedium,
    color: colors.mutedText,
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: colors.teal,
    fontWeight: '700',
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 5,
  },
  monthLabel: {
    ...typography.body,
    color: colors.bodyText,
    fontSize: 13,
  },
  monthInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: 8,
    minWidth: 130,
  },
  annualInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: 10,
    marginTop: 4,
  },
  utilTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  utilTotalLabel: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 13,
    fontWeight: '700',
  },
  utilTotalValue: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 14,
    fontWeight: '700',
  },
  savingsCard: {
    backgroundColor: colors.tealLight,
    borderRadius: 10,
    padding: spacing.md,
    marginTop: spacing.md,
    gap: 6,
  },
  savingsTitle: {
    ...typography.bodyMedium,
    color: colors.teal,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  savingsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  savingsLabel: {
    ...typography.body,
    color: colors.bodyText,
    fontSize: 12,
  },
  savingsValue: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 13,
    fontWeight: '600',
  },
  savingsValueEmph: {
    color: colors.teal,
    fontSize: 15,
    fontWeight: '800',
  },
  savingsHint: {
    ...typography.caption,
    color: colors.teal,
    fontSize: 11,
    fontStyle: 'italic',
  },
  savingsDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(15,110,86,0.25)',
    marginVertical: 2,
  },
  disclaimerNote: {
    color: '#888888',
    fontSize: 11,
    marginTop: spacing.sm,
    lineHeight: 15,
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

const catPicker = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  menu: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    maxHeight: '70%',
    ...shadow.raised,
  },
  menuScroll: { flexGrow: 0 },
  menuTitle: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
  },
  menuItemActive: {
    backgroundColor: colors.midNavy,
  },
  menuItemText: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    marginRight: spacing.sm,
  },
  menuItemTextActive: {
    color: colors.white,
  },
});
