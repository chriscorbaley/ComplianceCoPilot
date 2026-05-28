import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import { colors, radius, shadow, spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import {
  supabase,
  requireUserId,
  type DocumentRow,
} from '../services/supabase';
import { useBusiness } from '../business/BusinessContext';
import {
  listAllStrategyDocuments,
  getStrategyDocumentSignedUrl,
  type StrategyDocumentRow,
} from '../services/strategyDocuments';
import {
  STRATEGY_COMPLIANCE_SLOTS,
  STRATEGY_COMPLIANCE_ROUTE,
} from '../services/strategyComplianceSlots';

type DocsNavigationProp = NativeStackNavigationProp<RootStackParamList>;

type Strategy =
  | 'Real Estate'
  | 'Augusta'
  | 'S-Corp'
  | 'Travel'
  | 'Home Office'
  | 'Family Management';

type ChipFilter = 'All' | Strategy;

const FILTERS: ChipFilter[] = [
  'All',
  'Real Estate',
  'Augusta',
  'S-Corp',
  'Travel',
  'Home Office',
  'Family Management',
];

interface DocEntry {
  id: string;
  name: string;
  meta: string;
  strategy: Strategy;
  strategyKey: string | null;
  fileType: string | null;
  fileUrl: string | null;
  createdAt: string;
  // Compliance uploads come from the strategy_documents table and route to
  // the signed-URL viewer instead of the generic DocumentDetail screen.
  isCompliance: boolean;
  // Concatenated lowercase blob of every searchable field. Pre-computed once
  // per row so each keystroke is a cheap substring scan instead of rebuilding
  // these strings for every doc.
  searchBlob: string;
}

interface MissingComplianceEntry {
  strategyKey: string;
  strategy: Strategy;
  slotKey: string;
  slotLabel: string;
}

const STRATEGY_LABEL: Record<string, Strategy> = {
  real_estate: 'Real Estate',
  augusta_rule: 'Augusta',
  s_corp: 'S-Corp',
  business_travel: 'Travel',
  home_office: 'Home Office',
  family_management: 'Family Management',
};

const STRATEGY_DB_KEY: Record<Strategy, string> = {
  'Real Estate': 'real_estate',
  Augusta: 'augusta_rule',
  'S-Corp': 's_corp',
  Travel: 'business_travel',
  'Home Office': 'home_office',
  'Family Management': 'family_management',
};

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const formatDocDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTH_SHORT[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}, ${d.getFullYear()}`;
};

const formatDocMeta = (row: DocumentRow): string => {
  const date = formatDocDate(row.created_at);
  const ft = row.file_type ? ` · ${row.file_type}` : '';
  return `${date}${ft}`;
};

// Searchable tokens for a created_at timestamp: full + abbreviated month,
// numeric month, year, and ISO date so the user can type "November", "Nov",
// "2025", or "2025-11" and get a hit.
const dateSearchTokens = (iso: string): string[] => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return [];
  const mIdx = d.getMonth();
  const year = String(d.getFullYear());
  const monthNum = String(mIdx + 1).padStart(2, '0');
  return [
    MONTH_FULL[mIdx],
    MONTH_SHORT[mIdx],
    year,
    `${year}-${monthNum}`,
    `${MONTH_FULL[mIdx]} ${year}`,
    iso.slice(0, 10),
  ];
};

const rowToDoc = (row: DocumentRow): DocEntry => {
  const strategy = (row.strategy_category && STRATEGY_LABEL[row.strategy_category]) || 'Real Estate';
  const fileType = row.file_type;
  // For locally-generated minutes documents, file_url stores the full
  // document text — not a remote URL — so it's searchable as content. For
  // uploaded files file_url is a URI and matches act like path searches.
  const minutesText = fileType === 'minutes' ? row.file_url ?? '' : '';
  const searchBlob = [
    row.name ?? '',
    strategy,
    row.strategy_category ?? '',
    fileType ?? '',
    ...dateSearchTokens(row.created_at),
    minutesText,
  ]
    .join('\n')
    .toLowerCase();
  return {
    id: row.id,
    name: row.name ?? 'Untitled document',
    meta: formatDocMeta(row),
    strategy,
    strategyKey: row.strategy_category,
    fileType,
    fileUrl: row.file_url,
    createdAt: row.created_at,
    isCompliance: false,
    searchBlob,
  };
};

const complianceRowToDoc = (row: StrategyDocumentRow): DocEntry => {
  const strategy = STRATEGY_LABEL[row.strategy_key] ?? 'Real Estate';
  const created = row.uploaded_at ?? row.created_at;
  const meta = `${formatDocDate(created)}${row.file_type ? ` · ${row.file_type}` : ''}`;
  const searchBlob = [
    row.document_name ?? '',
    strategy,
    row.strategy_key,
    row.document_key,
    row.file_type ?? '',
    ...dateSearchTokens(created),
    'compliance',
  ]
    .join('\n')
    .toLowerCase();
  return {
    id: `compliance:${row.id}`,
    name: row.document_name ?? 'Compliance document',
    meta,
    strategy,
    strategyKey: row.strategy_key,
    fileType: row.file_type,
    fileUrl: row.file_url,
    createdAt: created,
    isCompliance: true,
    searchBlob,
  };
};

// Which compliance slots are "satisfied" for a strategy given the uploaded
// rows. The Home Office residence slot is satisfied by either a closing
// disclosure or a lease agreement — encoded here so the missing list is
// correct.
const satisfiedSlotKeys = (
  strategyKey: string,
  rows: StrategyDocumentRow[],
): Set<string> => {
  const uploaded = new Set(rows.filter((r) => r.file_url).map((r) => r.document_key));
  if (strategyKey === 'home_office' && uploaded.has('lease_agreement')) {
    uploaded.add('closing_disclosure');
  }
  return uploaded;
};

const BADGE_COLORS: Record<Strategy, { bg: string; fg: string }> = {
  'Real Estate': { bg: '#E1F5EE', fg: '#085041' },
  Augusta: { bg: '#E6F1FB', fg: '#0C447C' },
  'S-Corp': { bg: colors.amberLight, fg: colors.amber },
  Travel: { bg: '#E6F1FB', fg: '#0C447C' },
  'Home Office': { bg: '#E1F5EE', fg: '#085041' },
  'Family Management': { bg: colors.amberLight, fg: colors.amber },
};

const MINUTES_BADGE = { bg: colors.tealLight, fg: colors.teal };

const STRATEGY_TO_MEETING_LABEL: Record<string, string> = {
  augusta_rule: 'Augusta Rule business meeting',
  s_corp: 'S-Corp board meeting',
  family_management: 'Family management company meeting',
};

export const DocsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<DocsNavigationProp>();
  const { activeBusinessId } = useBusiness();
  const [filter, setFilter] = useState<ChipFilter>('All');
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [complianceRows, setComplianceRows] = useState<StrategyDocumentRow[]>([]);
  const [search, setSearch] = useState('');

  const loadDocs = useCallback(async () => {
    try {
      let query = supabase
        .from('documents')
        .select('*')
        .order('created_at', { ascending: false });
      if (activeBusinessId) query = query.eq('business_id', activeBusinessId);
      const [docsRes, complianceRes] = await Promise.all([
        query,
        listAllStrategyDocuments(activeBusinessId),
      ]);
      if (docsRes.error) throw docsRes.error;
      const regular = ((docsRes.data ?? []) as DocumentRow[]).map(rowToDoc);
      const compliance = complianceRes.filter((r) => r.file_url).map(complianceRowToDoc);
      // Merge and sort by created date, newest first.
      const merged = [...regular, ...compliance].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
      setDocs(merged);
      setComplianceRows(complianceRes);
    } catch (e) {
      // Supabase PostgrestError is a plain object (not an Error instance), so
      // `String(e)` would render "[object Object]". Pull the message field, and
      // log the full shape (code/details/hint) to Metro for diagnosis.
      const error = e as { message?: string; code?: string; details?: string; hint?: string };
      console.error('[Documents] fetch failed', {
        message: error?.message,
        code: error?.code,
        details: error?.details,
        hint: error?.hint,
      });
      Alert.alert(
        'Could not load documents',
        error?.message || JSON.stringify(error),
      );
    }
  }, [activeBusinessId]);

  useFocusEffect(
    useCallback(() => {
      loadDocs();
    }, [loadDocs]),
  );

  const trimmedSearch = search.trim();
  const searchActive = trimmedSearch.length > 0;

  const filtered = useMemo(() => {
    const q = trimmedSearch.toLowerCase();
    return docs.filter((d) => {
      if (filter !== 'All' && d.strategy !== filter) return false;
      if (!q) return true;
      return d.searchBlob.includes(q);
    });
  }, [filter, docs, trimmedSearch]);

  // Missing compliance slots for the active filter. Only computed when the
  // filter is one of the three compliance strategies — "All" stays clean.
  const missingSlots = useMemo<MissingComplianceEntry[]>(() => {
    if (filter === 'All') return [];
    const strategyKey = STRATEGY_DB_KEY[filter];
    const slots = STRATEGY_COMPLIANCE_SLOTS[strategyKey];
    if (!slots) return [];
    const rowsForStrategy = complianceRows.filter((r) => r.strategy_key === strategyKey);
    const satisfied = satisfiedSlotKeys(strategyKey, rowsForStrategy);
    return slots
      .filter((s) => !satisfied.has(s.key))
      .map((s) => ({
        strategyKey,
        strategy: filter,
        slotKey: s.key,
        slotLabel: s.label,
      }));
  }, [filter, complianceRows]);

  const openCompliance = async (doc: DocEntry) => {
    if (!doc.fileUrl) return;
    try {
      const url = await getStrategyDocumentSignedUrl(doc.fileUrl);
      const supported = await Linking.canOpenURL(url);
      if (supported) Linking.openURL(url);
      else Alert.alert('Cannot open document', 'No app is available to view this file.');
    } catch (e) {
      Alert.alert('Could not open document', e instanceof Error ? e.message : String(e));
    }
  };

  const openMissingSlot = (entry: MissingComplianceEntry) => {
    const route = STRATEGY_COMPLIANCE_ROUTE[entry.strategyKey];
    if (!route) return;
    navigation.navigate(route as never);
  };

  const openDoc = (doc: DocEntry) => {
    if (doc.isCompliance) {
      openCompliance(doc);
      return;
    }
    if (doc.fileType === 'minutes' && doc.fileUrl) {
      const meetingLabel =
        (doc.strategy && STRATEGY_TO_MEETING_LABEL[STRATEGY_DB_KEY[doc.strategy]]) ||
        'Meeting';
      navigation.navigate('MinutesDocument', {
        document: doc.fileUrl,
        meetingType: meetingLabel,
        meetingDate: formatDocDate(doc.createdAt),
        location: '—',
      });
      return;
    }
    navigation.navigate('DocumentDetail', {
      title: doc.name,
      meta: doc.meta,
      strategy: doc.strategy,
    });
  };

  const onUpload = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const file = result.assets?.[0];
      if (!file) return;
      const userId = await requireUserId();
      // The file blob itself isn't uploaded to Supabase Storage here — that's
      // a separate piece of work. We record the document metadata so the row
      // shows up in the list and ties to a strategy.
      const { error } = await supabase.from('documents').insert({
        user_id: userId,
        business_id: activeBusinessId,
        name: file.name,
        strategy_category: filter === 'All' ? null : STRATEGY_DB_KEY[filter],
        file_url: file.uri,
        file_type: file.mimeType ?? null,
      });
      if (error) throw new Error(error.message);
      await loadDocs();
      Alert.alert('Document added', file.name);
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.navy} />

      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>My documents</Text>
        <Text style={styles.subtitle}>Your private compliance document vault</Text>
      </View>

      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Ionicons
            name="search-outline"
            size={16}
            color={colors.mutedText}
            style={styles.searchIcon}
          />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search documents, dates, keywords"
            placeholderTextColor={colors.subtleText}
            style={styles.searchInput}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {searchActive ? (
            <TouchableOpacity
              onPress={() => setSearch('')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.searchClear}
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={18} color={colors.mutedText} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipsScroll}
        contentContainerStyle={styles.chipsContent}
      >
        {FILTERS.map((f) => {
          const active = f === filter;
          return (
            <TouchableOpacity
              key={f}
              activeOpacity={0.8}
              onPress={() => setFilter(f)}
              style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
            >
              <Text style={active ? styles.chipTextActive : styles.chipTextInactive}>
                {f}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 32 + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {searchActive ? (
          <Text style={styles.resultCount}>
            {filtered.length === 1
              ? '1 document found'
              : `${filtered.length} documents found`}
          </Text>
        ) : null}

        {searchActive && filtered.length === 0 ? (
          <View style={styles.emptySearchCard}>
            <Ionicons name="search-outline" size={28} color={colors.midNavy} />
            <Text style={styles.emptySearchTitle}>
              No documents match your search
            </Text>
            <Text style={styles.emptySearchHint}>
              Try a different keyword, month, or year.
            </Text>
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.clearSearchBtn}
              onPress={() => setSearch('')}
            >
              <Ionicons name="close" size={14} color={colors.white} />
              <Text style={styles.clearSearchBtnText}>Clear search</Text>
            </TouchableOpacity>
          </View>
        ) : (
        <View style={styles.listCard}>
          {filtered.map((doc, i) => {
            const isMinutes = doc.fileType === 'minutes';
            const badge = isMinutes ? MINUTES_BADGE : BADGE_COLORS[doc.strategy];
            const badgeLabel = isMinutes ? 'Minutes' : doc.strategy;
            const isLast = i === filtered.length - 1 && missingSlots.length === 0;
            return (
              <TouchableOpacity
                key={doc.id}
                activeOpacity={0.8}
                onPress={() => openDoc(doc)}
                style={[styles.row, !isLast && styles.rowDivider]}
              >
                <View style={styles.pdfIcon}>
                  <Ionicons
                    name="document-text"
                    size={15}
                    color={colors.midNavy}
                  />
                </View>
                <View style={styles.rowText}>
                  <View style={styles.docNameRow}>
                    <Text style={styles.docName} numberOfLines={1}>
                      {doc.name}
                    </Text>
                    {doc.isCompliance ? (
                      <Ionicons
                        name="shield-checkmark"
                        size={13}
                        color={colors.teal}
                        style={styles.complianceIcon}
                      />
                    ) : null}
                  </View>
                  <Text style={styles.docMeta} numberOfLines={1}>
                    {doc.meta}
                  </Text>
                </View>
                <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                  <Text style={[styles.badgeText, { color: badge.fg }]}>
                    {badgeLabel}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}

          {missingSlots.map((slot, i) => {
            const isLast = i === missingSlots.length - 1;
            return (
              <TouchableOpacity
                key={`missing:${slot.slotKey}`}
                activeOpacity={0.8}
                onPress={() => openMissingSlot(slot)}
                style={[styles.row, !isLast && styles.rowDivider]}
              >
                <View style={styles.missingIcon}>
                  <Ionicons name="alert-circle-outline" size={16} color={colors.amber} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.docName} numberOfLines={1}>
                    {slot.slotLabel}
                  </Text>
                  <Text style={styles.missingMeta} numberOfLines={1}>
                    Required — not yet uploaded
                  </Text>
                </View>
                <View style={styles.missingBadge}>
                  <Text style={styles.missingBadgeText}>{slot.strategy}</Text>
                </View>
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={onUpload}
            style={styles.uploadRow}
          >
            <Text style={styles.uploadText}>Tap to upload a document</Text>
          </TouchableOpacity>
        </View>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.navy,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  title: {
    ...typography.h1,
    color: colors.white,
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    ...typography.caption,
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 12,
    marginTop: 4,
  },
  searchWrap: {
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.navy,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  searchIcon: {
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    ...typography.body,
    color: colors.bodyText,
    fontSize: 14,
    padding: 0,
  },
  searchClear: {
    marginLeft: spacing.sm,
  },
  resultCount: {
    ...typography.caption,
    color: colors.mutedText,
    paddingVertical: spacing.sm,
  },
  emptySearchCard: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    ...shadow.card,
  },
  emptySearchTitle: {
    ...typography.h3,
    color: colors.bodyText,
    fontSize: 14,
    textAlign: 'center',
  },
  emptySearchHint: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    textAlign: 'center',
  },
  clearSearchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.midNavy,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: spacing.xs,
  },
  clearSearchBtnText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '700',
  },
  chipsScroll: {
    flexGrow: 0,
    backgroundColor: colors.background,
    paddingVertical: spacing.md,
  },
  chipsContent: {
    paddingLeft: 14,
    paddingRight: 14,
    gap: 6,
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 20,
  },
  chipActive: {
    backgroundColor: colors.midNavy,
  },
  chipInactive: {
    backgroundColor: 'transparent',
    borderWidth: 0.5,
    borderColor: '#CCCCCC',
  },
  chipTextActive: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '600',
  },
  chipTextInactive: {
    color: '#888888',
    fontSize: 11,
    fontWeight: '500',
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },
  listCard: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    paddingHorizontal: spacing.lg,
    ...shadow.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  pdfIcon: {
    width: 26,
    height: 26,
    borderRadius: 4,
    backgroundColor: colors.lightBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
  },
  docName: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 12,
    fontWeight: '700',
  },
  docMeta: {
    ...typography.body,
    color: '#888888',
    fontSize: 10,
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  uploadRow: {
    marginVertical: spacing.md,
    paddingVertical: spacing.lg,
    borderRadius: radius.card,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#CCCCCC',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadText: {
    fontSize: 12,
    color: '#AAAAAA',
    fontWeight: '500',
  },
  docNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  complianceIcon: {
    marginLeft: 6,
  },
  missingIcon: {
    width: 26,
    height: 26,
    borderRadius: 4,
    backgroundColor: colors.amberLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  missingMeta: {
    ...typography.body,
    color: colors.amber,
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  missingBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.amber,
    backgroundColor: 'transparent',
    alignSelf: 'flex-start',
  },
  missingBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
    color: colors.amber,
  },
});
