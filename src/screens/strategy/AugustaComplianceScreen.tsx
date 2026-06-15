// Augusta Rule compliance screen: per-property "Rental Rate Comparables".
// For each property that has had an Augusta rental this tax year, the user
// uploads three screenshots (or PDFs) of comparable venue rates to justify the
// rate they charged. One comparable set covers all of that property's Augusta
// events for the year.

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Image,
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
import { useBusiness } from '../../business/BusinessContext';
import { useAuth } from '../../auth/AuthContext';
import { ManualMinutesModal } from '../../components/ManualMinutesModal';
import { ComplianceReportButton } from '../../components/ComplianceReportButton';
import { generateAugustaReport } from '../../services/complianceReports';
import {
  listAugustaProperties,
  listComparables,
  uploadComparable,
  getComparableSignedUrl,
  type AugustaComparableRow,
  type AugustaPropertyForYear,
} from '../../services/augustaDocuments';

const SLOTS: Array<1 | 2 | 3> = [1, 2, 3];

const isImagePath = (p: string): boolean => /\.(png|jpe?g|webp|gif|heic)$/i.test(p);

const slotUrl = (row: AugustaComparableRow | undefined, slot: 1 | 2 | 3): string | null => {
  if (!row) return null;
  if (slot === 1) return row.comparable_1_url;
  if (slot === 2) return row.comparable_2_url;
  return row.comparable_3_url;
};

const ComparableSlot: React.FC<{
  storagePath: string | null;
  slot: 1 | 2 | 3;
  onUpload: () => void;
}> = ({ storagePath, slot, onUpload }) => {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (storagePath && isImagePath(storagePath)) {
      getComparableSignedUrl(storagePath)
        .then((u) => active && setThumbUrl(u))
        .catch(() => undefined);
    } else {
      setThumbUrl(null);
    }
    return () => {
      active = false;
    };
  }, [storagePath]);

  const openFile = async () => {
    if (!storagePath) return;
    try {
      const url = await getComparableSignedUrl(storagePath);
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert('Could not open', e instanceof Error ? e.message : String(e));
    }
  };

  if (!storagePath) {
    return (
      <TouchableOpacity activeOpacity={0.7} onPress={onUpload} style={styles.slotEmpty}>
        <Ionicons name="cloud-upload-outline" size={20} color={colors.subtleText} />
        <Text style={styles.slotEmptyLabel}>Comparable {slot}</Text>
        <Text style={styles.slotEmptyHint}>Tap to upload</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.slotFilled}>
      <TouchableOpacity activeOpacity={0.85} onPress={openFile} style={styles.slotThumbWrap}>
        {thumbUrl ? (
          <Image source={{ uri: thumbUrl }} style={styles.slotThumb} resizeMode="cover" />
        ) : (
          <View style={styles.slotPdf}>
            <Ionicons name="document-text" size={22} color={colors.midNavy} />
          </View>
        )}
        <View style={styles.slotCheck}>
          <Ionicons name="checkmark-circle" size={18} color={colors.teal} />
        </View>
      </TouchableOpacity>
      <Text style={styles.slotLabel}>Comparable {slot}</Text>
      <TouchableOpacity onPress={onUpload} hitSlop={6}>
        <Text style={styles.replaceLink}>Replace</Text>
      </TouchableOpacity>
    </View>
  );
};

export const AugustaComplianceScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { activeBusinessId, activeBusiness } = useBusiness();
  const { fullName } = useAuth();
  const taxYear = new Date().getFullYear();
  const [properties, setProperties] = useState<AugustaPropertyForYear[]>([]);
  const [comparables, setComparables] = useState<AugustaComparableRow[]>([]);
  const [manualOpen, setManualOpen] = useState(false);
  const businessName = activeBusiness?.business_name ?? null;

  const refresh = useCallback(async () => {
    try {
      const [props, comps] = await Promise.all([
        listAugustaProperties(activeBusinessId, taxYear),
        listComparables(activeBusinessId, taxYear),
      ]);
      setProperties(props);
      setComparables(comps);
    } catch (e) {
      Alert.alert('Could not load comparables', e instanceof Error ? e.message : String(e));
    }
  }, [activeBusinessId, taxYear]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const rowFor = (propertyName: string): AugustaComparableRow | undefined =>
    comparables.find((c) => (c.property_name ?? '') === propertyName);

  const pickAndUpload = async (prop: AugustaPropertyForYear, slot: 1 | 2 | 3) => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'application/pdf'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const file = result.assets?.[0];
      if (!file) return;
      await uploadComparable({
        businessId: activeBusinessId,
        propertyName: prop.propertyName,
        taxYear,
        slot,
        localUri: file.uri,
        fileName: file.name,
        mimeType: file.mimeType ?? null,
        rate: prop.rate,
      });
      await refresh();
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headerBlock}>
        <Text style={styles.title}>Comparable Rentals</Text>
        <Text style={styles.subtitle}>
          Upload comparable venue rates to justify your Augusta rental rates for {taxYear}
        </Text>
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
              generateAugustaReport({
                businessId: activeBusinessId,
                clientName: businessName ?? fullName ?? 'Client',
                taxYear,
              })
            }
          />
        </View>
      </View>

      {properties.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="business-outline" size={36} color="#CCCCCC" />
          <Text style={styles.emptyTitle}>No Augusta rentals yet this year</Text>
          <Text style={styles.emptyText}>
            Log an Augusta Rule meeting and generate its lease & invoice. Each
            rented property will then appear here for rate documentation.
          </Text>
        </View>
      ) : (
        properties.map((prop) => {
          const row = rowFor(prop.propertyName);
          const count = SLOTS.filter((s) => slotUrl(row, s)).length;
          const complete = count === 3;
          const rateLabel =
            prop.rate != null ? `$${prop.rate}/day` : 'your rental rate';
          return (
            <View key={prop.propertyName} style={styles.card}>
              <Text style={styles.cardTitle}>Rental Rate Comparables</Text>
              <Text style={styles.cardProperty}>{prop.propertyName}</Text>
              <Text style={styles.cardSub}>
                Upload 3 screenshots showing comparable venue rental rates to
                justify your rental rate of {rateLabel}
              </Text>

              <View style={styles.slotRow}>
                {SLOTS.map((slot) => (
                  <ComparableSlot
                    key={slot}
                    slot={slot}
                    storagePath={slotUrl(row, slot)}
                    onUpload={() => pickAndUpload(prop, slot)}
                  />
                ))}
              </View>

              <Text style={[styles.progress, complete && styles.progressDone]}>
                {count} of 3 comparables uploaded
              </Text>
            </View>
          );
        })
      )}

      <ManualMinutesModal
        visible={manualOpen}
        strategy="augusta_rule"
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
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg },
  headerBlock: { gap: spacing.xs },
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
  emptyCard: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadow.card,
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.bodyText,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyText: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  card: {
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
  cardTitle: {
    ...typography.h3,
    color: colors.navy,
    fontSize: 15,
    fontWeight: '700',
  },
  cardProperty: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  cardSub: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  slotRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  slotEmpty: {
    flex: 1,
    aspectRatio: 0.82,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#CCCCCC',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  slotEmptyLabel: {
    ...typography.caption,
    color: colors.bodyText,
    fontSize: 11,
    fontWeight: '700',
  },
  slotEmptyHint: {
    fontSize: 10,
    color: colors.subtleText,
  },
  slotFilled: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  slotThumbWrap: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.tealLight,
    backgroundColor: colors.lightBlue,
  },
  slotThumb: { width: '100%', height: '100%' },
  slotPdf: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.lightBlue,
  },
  slotCheck: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: colors.white,
    borderRadius: 9,
  },
  slotLabel: {
    ...typography.caption,
    color: colors.bodyText,
    fontSize: 11,
    fontWeight: '700',
  },
  replaceLink: {
    color: colors.midNavy,
    fontSize: 11,
    fontWeight: '700',
  },
  progress: {
    ...typography.bodyMedium,
    color: colors.mutedText,
    fontSize: 12,
    fontWeight: '700',
    marginTop: spacing.md,
  },
  progressDone: {
    color: colors.teal,
  },
});
