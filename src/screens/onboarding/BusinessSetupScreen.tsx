// Business setup screen (Fix 6). Shown right after onboarding when the user has
// no business record yet and hasn't skipped business setup. Collects the core
// business profile (name, entity type, optional EIN / address / logo) so that
// features which require a business (trips, documents, compliance) work.
//
// It's a RootStack screen presented full-screen (no header, no swipe-back) so it
// reads as a final onboarding step before the Dashboard. Both "Save & Continue"
// and "Skip for now" mark business_onboarding_completed = true and return to the
// Dashboard; Save additionally creates the default business record.

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { pickImageWithSource } from '../../utils/imagePicker';
import { colors, radius, spacing, typography } from '../../theme';
import { supabase, requireUserId, type EntityType } from '../../services/supabase';
import { createBusiness, updateBusinessLogo, uploadLogoFromUri } from '../../services/businesses';
import { useAuth } from '../../auth/AuthContext';
import { useBusiness } from '../../business/BusinessContext';
import type { RootStackParamList } from '../../navigation/types';
import { contentContainerStyle } from '../../constants/layout';

type Nav = NativeStackNavigationProp<RootStackParamList, 'BusinessSetup'>;

// The entity types offered during setup. Stored as free text on
// businesses.entity_type (the column already holds descriptive labels).
const ENTITY_OPTIONS = [
  'Sole Proprietorship',
  'Single-Member LLC',
  'Multi-Member LLC',
  'S-Corporation',
  'C-Corporation',
  'Partnership',
  'Other',
];

export const BusinessSetupScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const { refreshProfile } = useAuth();
  const { refresh: refreshBusinesses } = useBusiness();

  const [businessName, setBusinessName] = useState('');
  const [entityType, setEntityType] = useState<string | null>(null);
  const [ein, setEin] = useState('');
  const [address, setAddress] = useState('');
  // localLogoUri is the picked file:// URI shown as an instant preview. The logo
  // is uploaded on Save (after the business row exists) so its storage path can
  // include the new business ID: <userId>/<businessId>/logo.jpg.
  const [localLogoUri, setLocalLogoUri] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [entityPickerOpen, setEntityPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const canSave = businessName.trim().length > 0 && !!entityType && !busy;

  const markComplete = async () => {
    const userId = await requireUserId();
    const { error } = await supabase
      .from('users')
      .update({ business_onboarding_completed: true })
      .eq('id', userId);
    if (error) throw new Error(error.message);
  };

  const handlePickLogo = async () => {
    // Just capture the picked image here. The actual upload happens in handleSave
    // once the business row (and its ID) exists, so the file lands at a
    // per-business path instead of a shared one.
    const uri = await pickImageWithSource();
    if (!uri) return;
    setLocalLogoUri(uri);
  };

  const handleSkip = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await markComplete();
      await refreshProfile();
      nav.goBack();
    } catch (err) {
      Alert.alert('Could not continue', err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const created = await createBusiness({
        business_name: businessName.trim(),
        entity_type: (entityType as EntityType) ?? null,
        ein: ein.trim() || null,
        address: address.trim() || null,
        // Upload the logo after the row exists so its path can use the new ID.
        logo_url: null,
      });
      if (localLogoUri) {
        setUploadingLogo(true);
        const path = await uploadLogoFromUri(localLogoUri, created.id);
        await updateBusinessLogo(created.id, path);
      }
      await markComplete();
      await Promise.all([refreshBusinesses(), refreshProfile()]);
      nav.goBack();
    } catch (err) {
      Alert.alert('Could not save business', err instanceof Error ? err.message : String(err));
      setBusy(false);
      setUploadingLogo(false);
    }
  };

  const entityLabel = useMemo(
    () => entityType ?? 'Select entity type',
    [entityType],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + 16 }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 140 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={contentContainerStyle}>
        <Text style={styles.title}>Tell us about your business</Text>
        <Text style={styles.subtitle}>
          This information helps personalize your compliance tracking
        </Text>

        <Text style={styles.label}>Business name</Text>
        <TextInput
          style={styles.input}
          value={businessName}
          onChangeText={setBusinessName}
          placeholder="e.g. Smith Consulting LLC"
          placeholderTextColor={colors.subtleText}
        />

        <Text style={styles.label}>Entity type</Text>
        <TouchableOpacity
          style={styles.selector}
          activeOpacity={0.7}
          onPress={() => setEntityPickerOpen(true)}
        >
          <Text style={[styles.selectorText, !entityType && styles.selectorPlaceholder]}>
            {entityLabel}
          </Text>
          <Ionicons name="chevron-down" size={18} color={colors.mutedText} />
        </TouchableOpacity>

        <Text style={styles.label}>Employer Identification Number (optional — can be added later)</Text>
        <TextInput
          style={styles.input}
          value={ein}
          onChangeText={setEin}
          placeholder="XX-XXXXXXX"
          placeholderTextColor={colors.subtleText}
          autoCapitalize="characters"
        />

        <Text style={styles.label}>Business address (optional)</Text>
        <TextInput
          style={styles.input}
          value={address}
          onChangeText={setAddress}
          placeholder="City, State (full address optional)"
          placeholderTextColor={colors.subtleText}
        />

        <Text style={styles.label}>Upload your business logo (optional)</Text>
        <Text style={styles.subLabel}>Your logo appears on generated compliance documents</Text>
        <View style={styles.logoBlock}>
          {localLogoUri ? (
            <Image source={{ uri: localLogoUri }} style={styles.logoPreview} resizeMode="cover" />
          ) : (
            <View style={styles.logoPlaceholder}>
              <Ionicons name="image-outline" size={24} color={colors.subtleText} />
            </View>
          )}
          <TouchableOpacity
            style={[styles.logoBtn, uploadingLogo && styles.btnDisabled]}
            onPress={handlePickLogo}
            disabled={uploadingLogo}
            activeOpacity={0.85}
          >
            {uploadingLogo ? (
              <ActivityIndicator color={colors.midNavy} />
            ) : (
              <Text style={styles.logoBtnText}>{localLogoUri ? 'Replace logo' : 'Tap to upload'}</Text>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.skipLink} onPress={handleSkip} activeOpacity={0.7}>
          <Text style={styles.skipText}>I'll set this up later</Text>
          <Text style={styles.skipSub}>
            You can add your business info in Settings at any time
          </Text>
        </TouchableOpacity>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          activeOpacity={0.85}
          disabled={!canSave}
          onPress={handleSave}
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
        >
          {busy ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.saveText}>Save and Continue</Text>
          )}
        </TouchableOpacity>
      </View>

      <Modal
        visible={entityPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setEntityPickerOpen(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setEntityPickerOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Entity type</Text>
            {ENTITY_OPTIONS.map((opt) => {
              const active = opt === entityType;
              return (
                <TouchableOpacity
                  key={opt}
                  style={[styles.optionRow, active && styles.optionRowActive]}
                  activeOpacity={0.7}
                  onPress={() => {
                    setEntityType(opt);
                    setEntityPickerOpen(false);
                  }}
                >
                  <Text style={[styles.optionText, active && styles.optionTextActive]}>
                    {opt}
                  </Text>
                  {active ? (
                    <Ionicons name="checkmark-circle" size={20} color={colors.teal} />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  title: {
    color: colors.navy,
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.mutedText,
    fontSize: 14,
    marginTop: 4,
    marginBottom: spacing.lg,
  },
  label: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.lg,
    marginBottom: 6,
  },
  subLabel: {
    ...typography.caption,
    color: colors.subtleText,
    fontSize: 12,
    marginTop: -2,
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.white,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    ...typography.body,
    color: colors.bodyText,
    fontSize: 14,
  },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.white,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
  },
  selectorText: {
    ...typography.body,
    color: colors.bodyText,
    fontSize: 14,
  },
  selectorPlaceholder: {
    color: colors.subtleText,
  },
  logoBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  logoPreview: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: colors.white,
  },
  logoPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: colors.white,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.midNavy,
    backgroundColor: colors.lightBlue,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  logoBtnText: {
    ...typography.bodyMedium,
    color: colors.midNavy,
    fontWeight: '700',
    fontSize: 13,
  },
  skipLink: {
    marginTop: spacing.xl,
    alignItems: 'center',
    gap: 2,
  },
  skipText: {
    color: colors.midNavy,
    fontSize: 14,
    fontWeight: '700',
  },
  skipSub: {
    color: colors.mutedText,
    fontSize: 12,
    textAlign: 'center',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  saveBtn: {
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  saveBtnDisabled: {
    backgroundColor: '#C7CDD3',
  },
  saveText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 20,
    paddingBottom: 32,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.divider,
    marginBottom: spacing.md,
  },
  sheetTitle: {
    ...typography.h2,
    color: colors.bodyText,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderRadius: 10,
  },
  optionRowActive: {
    backgroundColor: colors.tealLight,
  },
  optionText: {
    ...typography.body,
    color: colors.bodyText,
    fontSize: 15,
  },
  optionTextActive: {
    color: colors.teal,
    fontWeight: '700',
  },
});
