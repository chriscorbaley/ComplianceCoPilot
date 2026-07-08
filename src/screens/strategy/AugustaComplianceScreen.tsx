// Augusta Rule "Rental Rate Comparables" screen.
//
// Comparable uploads justify the rental RATE itself — they are independent of
// any logged Augusta meeting. The user picks (or types) a property, picks a tax
// year, and uploads up to three screenshots/PDFs of comparable venue rates.
// Rows are saved to augusta_comparables keyed by property_name + tax_year, so
// they associate automatically with any Augusta activity later logged for that
// same property and year.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
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
import { useBusiness } from '../../business/BusinessContext';
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

// Simple centered option picker reused for both the property and tax-year
// selectors.
const OptionPickerModal: React.FC<{
  visible: boolean;
  title: string;
  options: string[];
  selected: string;
  onSelect: (v: string) => void;
  onClose: () => void;
}> = ({ visible, title, options, selected, onSelect, onClose }) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <TouchableOpacity style={picker.backdrop} activeOpacity={1} onPress={onClose}>
      <View style={picker.menu}>
        <Text style={picker.menuTitle}>{title}</Text>
        <ScrollView style={picker.menuScroll} showsVerticalScrollIndicator={false}>
          {options.map((opt) => {
            const active = opt === selected;
            return (
              <TouchableOpacity
                key={opt}
                activeOpacity={0.8}
                style={[picker.menuItem, active && picker.menuItemActive]}
                onPress={() => onSelect(opt)}
              >
                <Text style={[picker.menuItemText, active && picker.menuItemTextActive]}>
                  {opt}
                </Text>
                {active ? <Ionicons name="checkmark" size={18} color={colors.white} /> : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </TouchableOpacity>
  </Modal>
);

export const AugustaComplianceScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { activeBusinessId } = useBusiness();

  const currentYear = new Date().getFullYear();
  const yearChoices = useMemo(
    () => Array.from({ length: 6 }, (_, i) => currentYear - i),
    [currentYear],
  );

  const [taxYear, setTaxYear] = useState<number>(currentYear);
  const [properties, setProperties] = useState<AugustaPropertyForYear[]>([]);
  const [comparables, setComparables] = useState<AugustaComparableRow[]>([]);

  // Property selection: a dropdown when Augusta properties already exist for the
  // year, otherwise a free-text label the user types.
  const [selectedProperty, setSelectedProperty] = useState('');
  const [manualProperty, setManualProperty] = useState('');

  const [propPickerOpen, setPropPickerOpen] = useState(false);
  const [yearPickerOpen, setYearPickerOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [props, comps] = await Promise.all([
        listAugustaProperties(activeBusinessId, taxYear),
        listComparables(activeBusinessId, taxYear),
      ]);
      setProperties(props);
      setComparables(comps);
      // Default the dropdown to the first known property if nothing valid is
      // selected yet for this year.
      setSelectedProperty((cur) => {
        if (cur && props.some((p) => p.propertyName === cur)) return cur;
        return props[0]?.propertyName ?? '';
      });
    } catch (e) {
      Alert.alert('Could not load comparables', e instanceof Error ? e.message : String(e));
    }
  }, [activeBusinessId, taxYear]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const hasProperties = properties.length > 0;
  const propertyName = (hasProperties ? selectedProperty : manualProperty).trim();

  // The comparables row (if any) for the active property + year. Rate is pulled
  // from the matching logged property when one exists.
  const row = useMemo(
    () => comparables.find((c) => (c.property_name ?? '').trim() === propertyName),
    [comparables, propertyName],
  );
  const rateForProperty = useMemo(
    () => properties.find((p) => p.propertyName === propertyName)?.rate ?? null,
    [properties, propertyName],
  );

  const count = SLOTS.filter((s) => slotUrl(row, s)).length;
  const complete = count === 3;

  const pickAndUpload = async (slot: 1 | 2 | 3) => {
    if (!propertyName) {
      Alert.alert(
        'Property required',
        hasProperties
          ? 'Select a property before uploading comparables.'
          : 'Enter a property name or address before uploading comparables.',
      );
      return;
    }
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
        propertyName,
        taxYear,
        slot,
        localUri: file.uri,
        fileName: file.name,
        mimeType: file.mimeType ?? null,
        rate: rateForProperty,
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
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerBlock}>
        <Text style={styles.title}>Rental Rate Comparables</Text>
        <Text style={styles.subtitle}>
          Upload screenshots or documents showing comparable venue rental rates
          to justify your rental rate
        </Text>
      </View>

      <View style={styles.card}>
        {/* Property selector */}
        <Text style={styles.fieldLabel}>Property</Text>
        {hasProperties ? (
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.selectField}
            onPress={() => setPropPickerOpen(true)}
          >
            <Text style={styles.selectValue} numberOfLines={1}>
              {selectedProperty || 'Select a property'}
            </Text>
            <Ionicons name="chevron-down" size={18} color={colors.midNavy} />
          </TouchableOpacity>
        ) : (
          <TextInput
            style={styles.input}
            value={manualProperty}
            onChangeText={setManualProperty}
            placeholder="Property name or address"
            placeholderTextColor={colors.subtleText}
          />
        )}

        {/* Tax year selector */}
        <Text style={[styles.fieldLabel, { marginTop: spacing.md }]}>Tax year</Text>
        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.selectField}
          onPress={() => setYearPickerOpen(true)}
        >
          <Text style={styles.selectValue}>{taxYear}</Text>
          <Ionicons name="chevron-down" size={18} color={colors.midNavy} />
        </TouchableOpacity>

        {/* Upload slots */}
        <View style={styles.slotRow}>
          {SLOTS.map((slot) => (
            <ComparableSlot
              key={slot}
              slot={slot}
              storagePath={slotUrl(row, slot)}
              onUpload={() => pickAndUpload(slot)}
            />
          ))}
        </View>

        <Text style={[styles.progress, complete && styles.progressDone]}>
          {count} of 3 comparables uploaded
        </Text>
      </View>

      <OptionPickerModal
        visible={propPickerOpen}
        title="Select property"
        options={properties.map((p) => p.propertyName)}
        selected={selectedProperty}
        onSelect={(v) => {
          setSelectedProperty(v);
          setPropPickerOpen(false);
        }}
        onClose={() => setPropPickerOpen(false)}
      />

      <OptionPickerModal
        visible={yearPickerOpen}
        title="Tax year"
        options={yearChoices.map(String)}
        selected={String(taxYear)}
        onSelect={(v) => {
          setTaxYear(Number(v));
          setYearPickerOpen(false);
        }}
        onClose={() => setYearPickerOpen(false)}
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
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    ...shadow.card,
  },
  fieldLabel: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  input: {
    ...typography.body,
    fontSize: 14,
    color: colors.bodyText,
    backgroundColor: colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  selectField: {
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
  selectValue: {
    ...typography.body,
    color: colors.bodyText,
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    marginRight: spacing.sm,
  },
  slotRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
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

const picker = StyleSheet.create({
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
