import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import { colors, spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { useBusiness } from '../business/BusinessContext';
import type { BusinessRow } from '../services/supabase';

type Route = RouteProp<RootStackParamList, 'MinutesDocument'>;

const sanitizeFilename = (s: string): string =>
  s.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'minutes';

// Renders a plain-text markdown-ish document with clear heading styles.
const renderBlocks = (doc: string): React.ReactNode => {
  const lines = doc.split(/\r?\n/);
  return lines.map((rawLine, i) => {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) return <View key={i} style={styles.spacer} />;

    // ATX headings: # / ## / ###
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].replace(/\*\*/g, '');
      const style =
        level === 1 ? styles.h1 : level === 2 ? styles.h2 : styles.h3;
      return (
        <Text key={i} style={style}>
          {text}
        </Text>
      );
    }

    // Markdown bullet
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      return (
        <View key={i} style={styles.bulletRow}>
          <Text style={styles.bulletDot}>•</Text>
          <Text style={styles.bulletText}>{stripBold(bullet[1])}</Text>
        </View>
      );
    }

    // Numbered list
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (numbered) {
      return (
        <View key={i} style={styles.bulletRow}>
          <Text style={styles.bulletDot}>{rawLine.trim().split('.')[0]}.</Text>
          <Text style={styles.bulletText}>{stripBold(numbered[1])}</Text>
        </View>
      );
    }

    // A bold standalone line treated as section sub-heading
    const boldOnly = /^\*\*(.+)\*\*:?\s*$/.exec(line.trim());
    if (boldOnly) {
      return (
        <Text key={i} style={styles.h3}>
          {boldOnly[1]}
        </Text>
      );
    }

    return (
      <Text key={i} style={styles.paragraph}>
        {stripBold(line)}
      </Text>
    );
  });
};

const stripBold = (s: string): string => s.replace(/\*\*(.*?)\*\*/g, '$1');

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Header block rendered above the meeting details on every printed minutes
// PDF. Pulls the active business name, entity, address, and logo so that an
// auditor sees who the document belongs to. Returns empty string when no
// business is active so the document still renders cleanly.
const buildBusinessHeaderHtml = (business: BusinessRow | null): string => {
  if (!business) return '';
  const lines = [
    business.entity_type ? escapeHtml(business.entity_type) : '',
    business.address ? escapeHtml(business.address) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const logoImg = business.logo_url
    ? `<img src="${escapeHtml(business.logo_url)}" class="bizLogo" />`
    : '';
  return `
  <div class="bizHdr">
    ${logoImg}
    <div class="bizText">
      <div class="bizName">${escapeHtml(business.business_name)}</div>
      ${lines ? `<div class="bizMeta">${lines}</div>` : ''}
    </div>
  </div>`;
};

const buildHtmlForPdf = (
  document: string,
  meetingType: string,
  meetingDate: string,
  location: string,
  business: BusinessRow | null,
): string => {
  const lines = document.split(/\r?\n/);
  const body = lines
    .map((raw) => {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) return '<div class="sp"></div>';
      const heading = /^(#{1,3})\s+(.*)$/.exec(line);
      if (heading) {
        const level = heading[1].length;
        const text = escapeHtml(heading[2].replace(/\*\*/g, ''));
        return `<h${level}>${text}</h${level}>`;
      }
      const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
      if (bullet) {
        return `<li>${escapeHtml(stripBold(bullet[1]))}</li>`;
      }
      const boldOnly = /^\*\*(.+)\*\*:?\s*$/.exec(line.trim());
      if (boldOnly) {
        return `<h3>${escapeHtml(boldOnly[1])}</h3>`;
      }
      return `<p>${escapeHtml(stripBold(line))}</p>`;
    })
    .join('\n');

  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  @page { margin: 48px; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1A1A2E; font-size: 12pt; line-height: 1.5; }
  .bizHdr { display: flex; align-items: center; gap: 12px; padding-bottom: 10px; margin-bottom: 12px; border-bottom: 1px solid #E5E7EB; }
  .bizHdr .bizLogo { width: 48px; height: 48px; object-fit: contain; }
  .bizHdr .bizName { font-weight: 700; font-size: 13pt; color: #042C53; }
  .bizHdr .bizMeta { color: #6B7280; font-size: 10pt; margin-top: 2px; }
  .hdr { border-bottom: 2px solid #042C53; padding-bottom: 12px; margin-bottom: 20px; }
  .hdr h1 { color: #042C53; margin: 0 0 6px 0; font-size: 20pt; }
  .hdr .meta { color: #6B7280; font-size: 10.5pt; }
  h1 { color: #042C53; font-size: 16pt; margin-top: 18px; }
  h2 { color: #042C53; font-size: 14pt; margin-top: 16px; }
  h3 { color: #1A1A2E; font-size: 12pt; margin-top: 12px; }
  p { margin: 4px 0 8px 0; }
  li { margin: 2px 0; }
  .sp { height: 8px; }
  .foot { margin-top: 32px; color: #6B7280; font-size: 9pt; border-top: 1px solid #E5E7EB; padding-top: 8px; }
</style></head>
<body>
  ${buildBusinessHeaderHtml(business)}
  <div class="hdr">
    <h1>Meeting Minutes</h1>
    <div class="meta">${escapeHtml(meetingType)} · ${escapeHtml(meetingDate)} · ${escapeHtml(location)}</div>
  </div>
  ${body}
  <div class="foot">Generated by Compliance Co-Pilot for IRS audit documentation.</div>
</body></html>`;
};

export const MinutesDocumentScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { params } = useRoute<Route>();
  const { document, meetingType, meetingDate, location } = params;
  const { activeBusiness } = useBusiness();

  const [shareOpen, setShareOpen] = useState(false);
  const [sharing, setSharing] = useState(false);

  const blocks = useMemo(() => renderBlocks(document), [document]);

  const filenameBase = sanitizeFilename(`${meetingType}_${meetingDate}`);

  const shareAsText = async () => {
    setSharing(true);
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert('Sharing not available', 'This device cannot share files.');
        return;
      }
      const dir = FileSystem.cacheDirectory;
      if (!dir) throw new Error('No cache directory available');
      const uri = `${dir}${filenameBase}.txt`;
      const bizLines = activeBusiness
        ? [
            activeBusiness.business_name,
            [activeBusiness.entity_type, activeBusiness.address].filter(Boolean).join(' · '),
            '',
          ]
            .filter((l) => l !== undefined)
            .join('\n')
        : '';
      const header = `${bizLines}MEETING MINUTES\n${meetingType}\n${meetingDate} · ${location}\n\n`;
      await FileSystem.writeAsStringAsync(uri, header + document, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      await Sharing.shareAsync(uri, {
        mimeType: 'text/plain',
        UTI: 'public.plain-text',
        dialogTitle: 'Share Meeting Minutes',
      });
    } catch (e) {
      Alert.alert('Could not share', e instanceof Error ? e.message : String(e));
    } finally {
      setSharing(false);
      setShareOpen(false);
    }
  };

  const shareAsPdf = async () => {
    setSharing(true);
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert('Sharing not available', 'This device cannot share files.');
        return;
      }
      const html = buildHtmlForPdf(document, meetingType, meetingDate, location, activeBusiness);
      const { uri } = await Print.printToFileAsync({ html });
      // Rename the PDF so the share sheet shows a friendly name.
      const dir = FileSystem.cacheDirectory;
      let finalUri = uri;
      if (dir) {
        const target = `${dir}${filenameBase}.pdf`;
        try {
          await FileSystem.moveAsync({ from: uri, to: target });
          finalUri = target;
        } catch {
          // fall back to original uri
        }
      }
      await Sharing.shareAsync(finalUri, {
        mimeType: 'application/pdf',
        UTI: 'com.adobe.pdf',
        dialogTitle: 'Share Meeting Minutes',
      });
    } catch (e) {
      Alert.alert('Could not share', e instanceof Error ? e.message : String(e));
    } finally {
      setSharing(false);
      setShareOpen(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={styles.topBtn}
        >
          <Ionicons name="close" size={26} color={colors.bodyText} />
          <Text style={styles.topBtnText}>Close</Text>
        </TouchableOpacity>
        <Text style={styles.topTitle} numberOfLines={1}>
          Meeting Minutes
        </Text>
        <TouchableOpacity
          onPress={() => setShareOpen(true)}
          disabled={sharing}
          hitSlop={12}
          style={styles.topBtn}
        >
          {sharing ? (
            <ActivityIndicator size="small" color={colors.navy} />
          ) : (
            <>
              <Ionicons
                name={Platform.OS === 'ios' ? 'share-outline' : 'share-social-outline'}
                size={24}
                color={colors.navy}
              />
              <Text style={[styles.topBtnText, { color: colors.navy, fontWeight: '700' }]}>
                Share
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 40 + insets.bottom },
        ]}
        showsVerticalScrollIndicator
      >
        {activeBusiness ? (
          <View style={styles.bizHeaderBlock}>
            {activeBusiness.logo_url ? (
              <Image
                source={{ uri: activeBusiness.logo_url }}
                style={styles.bizHeaderLogo}
                resizeMode="contain"
              />
            ) : null}
            <View style={styles.bizHeaderText}>
              <Text style={styles.bizHeaderName}>{activeBusiness.business_name}</Text>
              {activeBusiness.entity_type || activeBusiness.address ? (
                <Text style={styles.bizHeaderMeta}>
                  {[activeBusiness.entity_type, activeBusiness.address]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}
        <View style={styles.headerBlock}>
          <Text style={styles.docTitle}>Meeting Minutes</Text>
          <Text style={styles.docMeta}>
            {meetingType} · {meetingDate} · {location}
          </Text>
        </View>
        {blocks}
      </ScrollView>

      <Modal
        visible={shareOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setShareOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setShareOpen(false)}>
          <Pressable style={styles.modalSheet} onPress={() => undefined}>
            <Text style={styles.modalTitle}>Share Document</Text>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={shareAsPdf}
              disabled={sharing}
              style={styles.sheetRow}
            >
              <Ionicons name="document-outline" size={22} color={colors.navy} />
              <View style={styles.sheetRowText}>
                <Text style={styles.sheetRowTitle}>Share as PDF</Text>
                <Text style={styles.sheetRowSub}>Best for IRS audit records</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={shareAsText}
              disabled={sharing}
              style={styles.sheetRow}
            >
              <Ionicons name="document-text-outline" size={22} color={colors.navy} />
              <View style={styles.sheetRowText}>
                <Text style={styles.sheetRowTitle}>Share as Text</Text>
                <Text style={styles.sheetRowSub}>Plain .txt file</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setShareOpen(false)}
              style={[styles.sheetRow, styles.sheetCancel]}
            >
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.white,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    backgroundColor: colors.white,
  },
  topBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 72,
  },
  topBtnText: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 15,
  },
  topTitle: {
    ...typography.h3,
    color: colors.bodyText,
    flex: 1,
    textAlign: 'center',
  },
  scroll: {
    flex: 1,
    backgroundColor: colors.white,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  bizHeaderBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.sm,
    marginBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  bizHeaderLogo: {
    width: 44,
    height: 44,
    borderRadius: 4,
  },
  bizHeaderText: {
    flex: 1,
  },
  bizHeaderName: {
    ...typography.h3,
    color: colors.navy,
  },
  bizHeaderMeta: {
    ...typography.caption,
    color: colors.mutedText,
    marginTop: 2,
  },
  headerBlock: {
    borderBottomWidth: 2,
    borderBottomColor: colors.navy,
    paddingBottom: spacing.md,
    marginBottom: spacing.lg,
  },
  docTitle: {
    ...typography.display,
    color: colors.navy,
    fontSize: 26,
    marginBottom: 4,
  },
  docMeta: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 13,
  },
  h1: {
    ...typography.h1,
    color: colors.navy,
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },
  h2: {
    ...typography.h2,
    color: colors.navy,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    fontSize: 17,
  },
  h3: {
    ...typography.h3,
    color: colors.bodyText,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  paragraph: {
    ...typography.body,
    color: colors.bodyText,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 4,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: 4,
    paddingLeft: spacing.sm,
  },
  bulletDot: {
    ...typography.body,
    color: colors.navy,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
    minWidth: 14,
  },
  bulletText: {
    ...typography.body,
    color: colors.bodyText,
    fontSize: 15,
    lineHeight: 22,
    flex: 1,
  },
  spacer: {
    height: spacing.xs,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.xs,
  },
  modalTitle: {
    ...typography.h2,
    color: colors.bodyText,
    marginBottom: spacing.sm,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
  },
  sheetRowText: {
    flex: 1,
  },
  sheetRowTitle: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 15,
    fontWeight: '600',
  },
  sheetRowSub: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 2,
  },
  sheetCancel: {
    justifyContent: 'center',
    marginTop: spacing.xs,
    backgroundColor: colors.background,
  },
  sheetCancelText: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 15,
    fontWeight: '600',
  },
});
