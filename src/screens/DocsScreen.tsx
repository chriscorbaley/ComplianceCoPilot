import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
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
  fileType: string | null;
  fileUrl: string | null;
  createdAt: string;
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

const rowToDoc = (row: DocumentRow): DocEntry => {
  const strategy = (row.strategy_category && STRATEGY_LABEL[row.strategy_category]) || 'Real Estate';
  return {
    id: row.id,
    name: row.name ?? 'Untitled document',
    meta: formatDocMeta(row),
    strategy,
    fileType: row.file_type,
    fileUrl: row.file_url,
    createdAt: row.created_at,
  };
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
  const [filter, setFilter] = useState<ChipFilter>('All');
  const [docs, setDocs] = useState<DocEntry[]>([]);

  const loadDocs = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setDocs(((data ?? []) as DocumentRow[]).map(rowToDoc));
    } catch (e) {
      Alert.alert('Could not load documents', e instanceof Error ? e.message : String(e));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadDocs();
    }, [loadDocs]),
  );

  const filtered = useMemo(() => {
    if (filter === 'All') return docs;
    return docs.filter((d) => d.strategy === filter);
  }, [filter, docs]);

  const openDoc = (doc: DocEntry) => {
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
        <View style={styles.listCard}>
          {filtered.map((doc, i) => {
            const isMinutes = doc.fileType === 'minutes';
            const badge = isMinutes ? MINUTES_BADGE : BADGE_COLORS[doc.strategy];
            const badgeLabel = isMinutes ? 'Minutes' : doc.strategy;
            const isLast = i === filtered.length - 1;
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
                  <Text style={styles.docName} numberOfLines={1}>
                    {doc.name}
                  </Text>
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

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={onUpload}
            style={styles.uploadRow}
          >
            <Text style={styles.uploadText}>Tap to upload a document</Text>
          </TouchableOpacity>
        </View>
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
});
