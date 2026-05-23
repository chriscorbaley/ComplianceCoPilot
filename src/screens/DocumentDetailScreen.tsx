import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, shadow, spacing, typography } from '../theme';
import { StatusPill } from '../components/StatusPill';
import type { RootStackParamList } from '../navigation/types';

type RouteProps = RouteProp<RootStackParamList, 'DocumentDetail'>;

const STRATEGY_BADGE_COLORS: Record<string, { bg: string; fg: string }> = {
  'Real Estate': { bg: '#E1F5EE', fg: '#085041' },
  Augusta: { bg: '#E6F1FB', fg: '#0C447C' },
  'S-Corp': { bg: '#FAEEDA', fg: '#BA7517' },
  Travel: { bg: '#E6F1FB', fg: '#0C447C' },
  'Home Office': { bg: '#E1F5EE', fg: '#085041' },
};

export const DocumentDetailScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { params } = useRoute<RouteProps>();
  const { title, meta, strategy, status, statusVariant } = params;
  const badge = strategy ? STRATEGY_BADGE_COLORS[strategy] : undefined;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.card}>
        <View style={styles.header}>
          <View style={styles.pdfIcon}>
            <Ionicons name="document-text" size={26} color={colors.midNavy} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.meta}>{meta}</Text>
          </View>
        </View>

        {(badge || (status && statusVariant)) && (
          <View style={styles.pills}>
            {badge && (
              <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                <Text style={[styles.badgeText, { color: badge.fg }]}>{strategy}</Text>
              </View>
            )}
            {status && statusVariant && (
              <StatusPill label={status} variant={statusVariant} />
            )}
          </View>
        )}

        <View style={styles.divider} />

        <Text style={styles.sectionLabel}>About</Text>
        <Text style={styles.body}>
          This document is stored privately in your compliance vault. It serves
          as substantiation for the linked tax strategy. Share with your CPA to
          attach it to your filing record, or open the file to review the full
          contents.
        </Text>

        <Text style={styles.sectionLabel}>Substantiates</Text>
        <View style={styles.linkedRow}>
          <Ionicons name="link-outline" size={16} color={colors.midNavy} />
          <Text style={styles.linkedText}>
            {strategy ? `${strategy} strategy` : 'Compliance vault'}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => Alert.alert('Open document', `Opening ${title}…`)}
          style={[styles.btn, styles.btnPrimary]}
        >
          <Ionicons name="open-outline" size={18} color={colors.white} />
          <Text style={styles.btnPrimaryText}>Open document</Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => Alert.alert('Share', `Sharing ${title} with your CPA…`)}
          style={[styles.btn, styles.btnOutline]}
        >
          <Ionicons name="share-outline" size={18} color={colors.navy} />
          <Text style={styles.btnOutlineText}>Share with CPA</Text>
        </TouchableOpacity>
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
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadow.card,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  pdfIcon: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: colors.lightBlue,
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
  meta: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 2,
  },
  pills: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
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
  body: {
    ...typography.body,
    color: colors.bodyText,
    fontSize: 14,
    lineHeight: 20,
  },
  linkedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
  },
  linkedText: {
    ...typography.bodyMedium,
    color: colors.midNavy,
    fontSize: 14,
    fontWeight: '600',
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
});
