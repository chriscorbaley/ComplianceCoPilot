import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { colors, radius, shadow, spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { DocumentViewer } from '../components/DocumentViewer';
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
  // Minutes and activity-log docs store their full text in file_url (not a
  // remote URL), so that text is searchable as document content.
  const inlineText =
    fileType === 'minutes' ||
    fileType === 'activity_log' ||
    fileType === 'augusta_meeting'
      ? row.file_url ?? ''
      : '';
  const searchBlob = [
    row.name ?? '',
    strategy,
    row.strategy_category ?? '',
    fileType ?? '',
    ...dateSearchTokens(row.created_at),
    inlineText,
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

// Auto-generated real estate activity records get a teal Real Estate badge and
// a clock icon so they read as a distinct, time-stamped audit entry.
const ACTIVITY_BADGE = { bg: colors.tealLight, fg: colors.teal };

// file_type values whose file_url holds the document text itself (not a remote
// URI). These render in the in-app viewer and share as a generated PDF.
const TEXT_DOC_TYPES = new Set(['minutes', 'activity_log', 'augusta_meeting']);
// Of the text docs, these are user-editable in place.
const EDITABLE_DOC_TYPES = new Set(['minutes', 'activity_log']);

const escapeHtmlDoc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Renders a text document to a PDF (preserving headings/bullets/line breaks)
// and presents the share sheet.
const shareDocTextAsPdf = async (name: string, text: string): Promise<void> => {
  const available = await Sharing.isAvailableAsync();
  if (!available) throw new Error('Sharing is not available on this device.');
  const body = text
    .split(/\r?\n/)
    .map((raw) => {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) return '<div style="height:8px"></div>';
      const heading = /^(#{1,3})\s+(.*)$/.exec(line);
      if (heading) {
        return `<h${heading[1].length}>${escapeHtmlDoc(
          heading[2].replace(/\*\*/g, ''),
        )}</h${heading[1].length}>`;
      }
      const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
      if (bullet) return `<li>${escapeHtmlDoc(bullet[1].replace(/\*\*/g, ''))}</li>`;
      return `<p>${escapeHtmlDoc(line.replace(/\*\*/g, ''))}</p>`;
    })
    .join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8" />
<style>
  @page { margin: 48px; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1A1A2E; font-size: 12pt; line-height: 1.5; }
  h1 { color: #042C53; font-size: 18pt; border-bottom: 2px solid #042C53; padding-bottom: 8px; }
  h2 { color: #042C53; font-size: 14pt; } h3 { color: #1A1A2E; font-size: 12pt; }
  p { margin: 4px 0 8px 0; } li { margin: 2px 0; }
</style></head><body>
  <h1>${escapeHtmlDoc(name)}</h1>
  ${body}
</body></html>`;
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: 'Share Document',
  });
};

export const DocsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<DocsNavigationProp>();
  const { activeBusinessId } = useBusiness();
  const [filter, setFilter] = useState<ChipFilter>('All');
  const [docs, setDocs] = useState<DocEntry[]>([]);
  const [complianceRows, setComplianceRows] = useState<StrategyDocumentRow[]>([]);
  // `search` is the raw, instantly-reflected input value; `debouncedSearch`
  // lags it by 300ms and is what actually drives filtering, so a fast typist
  // doesn't re-run the filter on every keystroke. `searchFocused` toggles the
  // navy focus border.
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  // The document currently open in the in-app viewer (null when closed).
  const [viewerDoc, setViewerDoc] = useState<DocEntry | null>(null);

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
      // Start each visit with a clean search — search state is never persisted
      // across navigation. Resetting both values keeps the input and the
      // filter in sync the moment the screen regains focus.
      setSearch('');
      setDebouncedSearch('');
      loadDocs();
    }, [loadDocs]),
  );

  // Debounce the raw input by 300ms before it reaches the filter. Each
  // keystroke restarts the timer; only a 300ms pause commits the value.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(handle);
  }, [search]);

  // Instant clear — bypasses the debounce by resetting both values together so
  // the input empties and results restore in the same render.
  const clearSearch = useCallback(() => {
    setSearch('');
    setDebouncedSearch('');
  }, []);

  // Raw input presence drives the clear (X) button so it appears as you type;
  // the debounced value drives filtering and the results feedback below.
  const hasInput = search.trim().length > 0;
  const trimmedSearch = debouncedSearch.trim();
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
      // Compliance uploads live in Storage — open via their signed URL.
      openCompliance(doc);
      return;
    }
    // Everything else opens in the in-app viewer: minutes/activity_log are
    // editable; uploaded files and other generated docs are read-only.
    setViewerDoc(doc);
  };

  // Persist edits made in the viewer. Updates the documents row and, for
  // minutes, the mirrored meeting_minutes record so both stay in sync.
  const handleViewerSave = async (newContent: string) => {
    if (!viewerDoc) return;
    const userId = await requireUserId();
    const { error } = await supabase
      .from('documents')
      .update({ file_url: newContent })
      .eq('id', viewerDoc.id)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
    if (viewerDoc.fileType === 'minutes' && viewerDoc.fileUrl) {
      const { error: mErr } = await supabase
        .from('meeting_minutes')
        .update({ minutes_document: newContent })
        .eq('user_id', userId)
        .eq('minutes_document', viewerDoc.fileUrl);
      if (mErr) console.warn('[Documents] meeting_minutes sync failed', mErr);
    }
    // Reflect the new text locally so a follow-up save matches correctly and
    // the list shows the edit on next focus.
    setViewerDoc({ ...viewerDoc, fileUrl: newContent });
    await loadDocs();
  };

  const handleViewerShare = async () => {
    if (!viewerDoc) return;
    try {
      if (TEXT_DOC_TYPES.has(viewerDoc.fileType ?? '')) {
        await shareDocTextAsPdf(viewerDoc.name, viewerDoc.fileUrl ?? '');
      } else if (viewerDoc.fileUrl) {
        const available = await Sharing.isAvailableAsync();
        if (!available) {
          Alert.alert('Sharing not available', 'This device cannot share files.');
          return;
        }
        await Sharing.shareAsync(viewerDoc.fileUrl);
      } else {
        Alert.alert('Nothing to share', 'This document has no shareable file.');
      }
    } catch (e) {
      Alert.alert('Could not share', e instanceof Error ? e.message : String(e));
    }
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
        <View style={[styles.searchBar, searchFocused && styles.searchBarFocused]}>
          <Ionicons
            name="search-outline"
            size={16}
            color="#888888"
            style={styles.searchIcon}
          />
          <TextInput
            value={search}
            onChangeText={setSearch}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Search documents, dates, keywords..."
            placeholderTextColor={colors.subtleText}
            style={styles.searchInput}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {hasInput ? (
            <TouchableOpacity
              onPress={clearSearch}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.searchClear}
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={18} color="#888888" />
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
            <Ionicons name="search-outline" size={40} color="#CCCCCC" />
            <Text style={styles.emptySearchTitle}>
              No documents match your search
            </Text>
            <TouchableOpacity activeOpacity={0.7} onPress={clearSearch}>
              <Text style={styles.clearSearchLink}>Clear search</Text>
            </TouchableOpacity>
          </View>
        ) : (
        <View style={styles.listCard}>
          {filtered.map((doc, i) => {
            const isMinutes = doc.fileType === 'minutes';
            const isActivity = doc.fileType === 'activity_log';
            const badge = isActivity
              ? ACTIVITY_BADGE
              : isMinutes
                ? MINUTES_BADGE
                : BADGE_COLORS[doc.strategy];
            const badgeLabel = isActivity
              ? 'Real Estate'
              : isMinutes
                ? 'Minutes'
                : doc.strategy;
            const isLast = i === filtered.length - 1 && missingSlots.length === 0;
            return (
              <TouchableOpacity
                key={doc.id}
                activeOpacity={0.8}
                onPress={() => openDoc(doc)}
                style={[styles.row, !isLast && styles.rowDivider]}
              >
                <View style={[styles.pdfIcon, isActivity && styles.activityIcon]}>
                  <Ionicons
                    name={isActivity ? 'time-outline' : 'document-text'}
                    size={15}
                    color={isActivity ? colors.teal : colors.midNavy}
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

      {viewerDoc ? (
        <DocumentViewer
          document={{
            name: viewerDoc.name,
            meta: viewerDoc.meta,
            content: TEXT_DOC_TYPES.has(viewerDoc.fileType ?? '')
              ? viewerDoc.fileUrl ?? ''
              : 'This is an uploaded file and can’t be edited in-app. Use Share to open or send it.',
          }}
          editable={EDITABLE_DOC_TYPES.has(viewerDoc.fileType ?? '')}
          onSave={handleViewerSave}
          onShare={handleViewerShare}
          onClose={() => setViewerDoc(null)}
        />
      ) : null}
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
    paddingHorizontal: 14,
    paddingTop: spacing.md,
    // 10px gap between the search bar and the filter chips below.
    paddingBottom: 10,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: '#CCCCCC',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  searchBarFocused: {
    borderColor: colors.midNavy,
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
    color: '#888888',
    fontSize: 12,
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
  clearSearchLink: {
    color: colors.midNavy,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  chipsScroll: {
    flexGrow: 0,
    backgroundColor: colors.background,
    // Top gap comes from searchWrap's 10px paddingBottom; only pad below.
    paddingBottom: spacing.md,
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
  activityIcon: {
    backgroundColor: colors.tealLight,
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
