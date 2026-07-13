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
import { pickImageWithSource } from '../../utils/imagePicker';
import { colors, radius, shadow, spacing, typography } from '../../theme';
import { useBusiness } from '../../business/BusinessContext';
import {
  listAugustaProperties,
  listAllComparables,
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
  // Local file URI of a just-picked image. Shown immediately (before/without a
  // round-trip to storage) so the thumbnail appears instantly on selection.
  localUri?: string | null;
  slot: 1 | 2 | 3;
  onUpload: () => void;
}> = ({ storagePath, localUri, slot, onUpload }) => {
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

  // A freshly-picked local image displays right away and takes precedence over
  // the remote signed URL until the next refresh replaces it.
  if (localUri) {
    return (
      <View style={styles.slotFilled}>
        <TouchableOpacity activeOpacity={0.85} onPress={onUpload} style={styles.slotThumbWrap}>
          <Image source={{ uri: localUri }} style={styles.slotThumb} resizeMode="cover" />
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
  }

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

// Compact, read-only thumbnail used on the saved-property cards. Resolves a
// signed URL for image comparables; falls back to a document icon for PDFs and a
// dashed placeholder for empty slots.
const CardThumb: React.FC<{ storagePath: string | null; onOpen: () => void }> = ({
  storagePath,
  onOpen,
}) => {
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

  if (!storagePath) {
    return (
      <View style={styles.cardThumbEmpty}>
        <Ionicons name="image-outline" size={16} color={colors.subtleText} />
      </View>
    );
  }
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onOpen} style={styles.cardThumbWrap}>
      {thumbUrl ? (
        <Image source={{ uri: thumbUrl }} style={styles.slotThumb} resizeMode="cover" />
      ) : (
        <View style={styles.slotPdf}>
          <Ionicons name="document-text" size={18} color={colors.midNavy} />
        </View>
      )}
    </TouchableOpacity>
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
  // Every comparables row the user has saved, across all tax years. Loaded
  // automatically on focus so previously-uploaded comparables are retrieved
  // without the user re-typing a property name to find them.
  const [allComparables, setAllComparables] = useState<AugustaComparableRow[]>([]);

  // Property selection for the editor. `propertyName` is the single source of
  // truth for which property the upload slots act on; `addingNew` switches
  // between picking an existing property (dropdown) and typing a brand-new one.
  const [propertyName, setPropertyName] = useState('');
  const [addingNew, setAddingNew] = useState(false);

  const [propPickerOpen, setPropPickerOpen] = useState(false);
  const [yearPickerOpen, setYearPickerOpen] = useState(false);

  // Local file URIs of just-picked comparables, keyed by slot. Cleared when the
  // property or year changes so previews never leak across contexts.
  const [localUris, setLocalUris] = useState<Record<number, string>>({});

  const refresh = useCallback(async () => {
    try {
      const [props, comps] = await Promise.all([
        listAugustaProperties(activeBusinessId, taxYear),
        listAllComparables(activeBusinessId),
      ]);
      setProperties(props);
      setAllComparables(comps);
    } catch (e) {
      Alert.alert('Could not load comparables', e instanceof Error ? e.message : String(e));
    }
  }, [activeBusinessId, taxYear]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  // Comparables for the tax year currently selected in the editor (the slots
  // upload into this year); the cards below show every year.
  const yearComparables = useMemo(
    () => allComparables.filter((c) => c.tax_year === taxYear),
    [allComparables, taxYear],
  );

  // Every property that already has an Augusta rental OR saved comparables for
  // the selected year — the dropdown options, so nothing needs re-typing.
  const propertyOptions = useMemo(() => {
    const set = new Set<string>();
    properties.forEach((p) => set.add(p.propertyName));
    yearComparables.forEach((c) => {
      const n = (c.property_name ?? '').trim();
      if (n) set.add(n);
    });
    return Array.from(set);
  }, [properties, yearComparables]);

  // Property cards: one per saved comparables row (any year) that has at least
  // one uploaded file, newest first.
  const savedCards = useMemo(
    () =>
      allComparables.filter(
        (c) => c.comparable_1_url || c.comparable_2_url || c.comparable_3_url,
      ),
    [allComparables],
  );

  const hasProperties = propertyOptions.length > 0;
  const usingDropdown = hasProperties && !addingNew;

  // Keep the dropdown selection valid: when picking from existing options and the
  // current value isn't one of them, snap to the first available property.
  useEffect(() => {
    if (addingNew || propertyOptions.length === 0) return;
    if (!propertyOptions.includes(propertyName)) {
      setPropertyName(propertyOptions[0]);
    }
  }, [propertyOptions, addingNew, propertyName]);

  const trimmedProperty = propertyName.trim();

  // The comparables row (if any) for the active property + year. Rate is pulled
  // from the matching logged property when one exists.
  const row = useMemo(
    () => yearComparables.find((c) => (c.property_name ?? '').trim() === trimmedProperty),
    [yearComparables, trimmedProperty],
  );
  const rateForProperty = useMemo(
    () => properties.find((p) => p.propertyName === trimmedProperty)?.rate ?? null,
    [properties, trimmedProperty],
  );

  const count = SLOTS.filter((s) => slotUrl(row, s)).length;
  const complete = count === 3;

  // Switching property or year invalidates any local previews from the prior
  // selection — the freshly-loaded rows carry the correct stored comparables.
  useEffect(() => {
    setLocalUris({});
  }, [trimmedProperty, taxYear]);

  // Tapping a saved card loads that property + year into the editor so the user
  // can view or add more comparables without re-typing anything.
  const selectCard = (card: AugustaComparableRow) => {
    setAddingNew(false);
    setTaxYear(card.tax_year ?? currentYear);
    setPropertyName((card.property_name ?? '').trim());
  };

  const openStoragePath = async (storagePath: string | null) => {
    if (!storagePath) return;
    try {
      const url = await getComparableSignedUrl(storagePath);
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert('Could not open', e instanceof Error ? e.message : String(e));
    }
  };

  const pickAndUpload = async (slot: 1 | 2 | 3) => {
    if (!trimmedProperty) {
      Alert.alert(
        'Property required',
        usingDropdown
          ? 'Select a property before uploading comparables.'
          : 'Enter a property name or address before uploading comparables.',
      );
      return;
    }
    // Full image (no square crop) with the shared permission handling used by
    // the business-logo upload.
    const uri = await pickImageWithSource({ allowsEditing: false });
    if (!uri) return;
    // Show the picked image instantly, before the upload completes.
    setLocalUris((prev) => ({ ...prev, [slot]: uri }));
    try {
      await uploadComparable({
        businessId: activeBusinessId,
        propertyName: trimmedProperty,
        taxYear,
        slot,
        localUri: uri,
        // The URI carries the extension the uploader needs to derive the type.
        fileName: uri,
        mimeType: null,
        rate: rateForProperty,
      });
      await refresh();
    } catch (e) {
      // Drop the failed preview so the slot returns to its empty state.
      setLocalUris((prev) => {
        const next = { ...prev };
        delete next[slot];
        return next;
      });
      const err = e as { message?: string; error_description?: string };
      console.error('[Augusta Comparables] upload failed:', err?.message ?? err);
      Alert.alert(
        'Upload failed',
        err?.message || err?.error_description || 'Could not upload the comparable. Please try again.',
      );
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
        {/* Property selector — dropdown of existing properties, or a text input
            for adding a brand-new one. */}
        <Text style={styles.fieldLabel}>Property</Text>
        {usingDropdown ? (
          <>
            <TouchableOpacity
              activeOpacity={0.8}
              style={styles.selectField}
              onPress={() => setPropPickerOpen(true)}
            >
              <Text style={styles.selectValue} numberOfLines={1}>
                {propertyName || 'Select a property'}
              </Text>
              <Ionicons name="chevron-down" size={18} color={colors.midNavy} />
            </TouchableOpacity>
            <TouchableOpacity
              hitSlop={6}
              onPress={() => {
                setAddingNew(true);
                setPropertyName('');
              }}
            >
              <Text style={styles.inlineLink}>+ Add a new property</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TextInput
              style={styles.input}
              value={propertyName}
              onChangeText={setPropertyName}
              placeholder="Property name or address"
              placeholderTextColor={colors.subtleText}
            />
            {hasProperties ? (
              <TouchableOpacity
                hitSlop={6}
                onPress={() => {
                  setAddingNew(false);
                  setPropertyName(propertyOptions[0] ?? '');
                }}
              >
                <Text style={styles.inlineLink}>Choose an existing property</Text>
              </TouchableOpacity>
            ) : null}
          </>
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
              localUri={localUris[slot] ?? null}
              onUpload={() => pickAndUpload(slot)}
            />
          ))}
        </View>

        <Text style={[styles.progress, complete && styles.progressDone]}>
          {count} of 3 comparables uploaded
        </Text>
      </View>

      {/* Saved comparables — auto-loaded property cards. No re-typing required to
          find previously-uploaded comparables. */}
      <Text style={styles.sectionTitle}>Your comparables</Text>
      {savedCards.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            No comparables uploaded yet. Add a property above to get started.
          </Text>
        </View>
      ) : (
        savedCards.map((card) => {
          const cardCount = SLOTS.filter((s) => slotUrl(card, s)).length;
          return (
            <View key={card.id} style={styles.propCard}>
              <View style={styles.propCardHead}>
                <Text style={styles.propCardTitle} numberOfLines={1}>
                  {(card.property_name ?? 'Property').trim() || 'Property'}
                </Text>
                <Text style={styles.propCardYear}>{card.tax_year ?? ''}</Text>
              </View>
              <View style={styles.cardThumbRow}>
                {SLOTS.map((slot) => (
                  <CardThumb
                    key={slot}
                    storagePath={slotUrl(card, slot)}
                    onOpen={() => openStoragePath(slotUrl(card, slot))}
                  />
                ))}
              </View>
              <View style={styles.propCardFoot}>
                <Text style={styles.propCardCount}>{cardCount} of 3 uploaded</Text>
                <TouchableOpacity hitSlop={6} onPress={() => selectCard(card)}>
                  <Text style={styles.inlineLink}>View / update</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })
      )}

      <OptionPickerModal
        visible={propPickerOpen}
        title="Select property"
        options={propertyOptions}
        selected={propertyName}
        onSelect={(v) => {
          setPropertyName(v);
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
  inlineLink: {
    color: colors.midNavy,
    fontSize: 12,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  sectionTitle: {
    ...typography.h2,
    color: colors.navy,
    fontSize: 16,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  emptyCard: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    ...shadow.card,
  },
  emptyText: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 13,
    lineHeight: 18,
  },
  propCard: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadow.card,
  },
  propCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  propCardTitle: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  propCardYear: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 12,
    fontWeight: '700',
  },
  cardThumbRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  cardThumbWrap: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.tealLight,
    backgroundColor: colors.lightBlue,
  },
  cardThumbEmpty: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#CCCCCC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  propCardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  propCardCount: {
    ...typography.bodyMedium,
    color: colors.mutedText,
    fontSize: 12,
    fontWeight: '700',
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
