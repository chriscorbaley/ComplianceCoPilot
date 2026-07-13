import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { pickImageWithSource } from '../utils/imagePicker';
import { colors, radius, spacing, typography } from '../theme';
import {
  ENTITY_TYPES,
  createBusiness,
  updateBusiness,
  updateBusinessLogo,
  uploadLogoFromUri,
  type BusinessFormInput,
} from '../services/businesses';
import { useBusiness } from '../business/BusinessContext';
import { useSignedLogoUrl } from '../hooks/useSignedLogoUrls';
import type { RootStackParamList } from '../navigation/types';
import type { EntityType } from '../services/supabase';

type Route = RouteProp<RootStackParamList, 'BusinessEdit'>;

export const BusinessEditScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { params } = useRoute<Route>();
  const editingId = params?.businessId;
  const { businesses, refresh, setActiveBusinessId } = useBusiness();
  const existing = useMemo(
    () => businesses.find((b) => b.id === editingId) ?? null,
    [businesses, editingId],
  );

  const [businessName, setBusinessName] = useState(existing?.business_name ?? '');
  const [entityType, setEntityType] = useState<EntityType | null>(existing?.entity_type ?? null);
  const [ein, setEin] = useState(existing?.ein ?? '');
  const [address, setAddress] = useState(existing?.address ?? '');
  // logoUrl is the STORAGE PATH persisted to the business record (the bucket is
  // private). localLogoUri is a freshly-picked file:// URI shown instantly while
  // the upload runs. The thumbnail prefers the local pick, else the stored path.
  const [logoUrl, setLogoUrl] = useState<string | null>(existing?.logo_url ?? null);
  const [localLogoUri, setLocalLogoUri] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [saving, setSaving] = useState(false);
  // A signed URL for the stored logo (or the local file:// pick passed straight
  // through). Re-minted on focus so an expired signature refreshes.
  const previewLogo = useSignedLogoUrl(localLogoUri ?? logoUrl);

  useEffect(() => {
    navigation.setOptions({ title: editingId ? 'Edit Business' : 'Add Business' });
  }, [editingId, navigation]);

  // Hydrate from the saved logo once the business record loads (businesses may
  // arrive after mount). Runs a single time so it never clobbers a logo the user
  // picks while editing.
  const hydratedLogo = useRef(false);
  useEffect(() => {
    if (!hydratedLogo.current && existing?.logo_url) {
      setLogoUrl(existing.logo_url);
      hydratedLogo.current = true;
    }
  }, [existing]);

  // On focus, pull the latest business record so the saved logo_url is current.
  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => undefined);
    }, [refresh]),
  );

  const handlePickLogo = async () => {
    const uri = await pickImageWithSource();
    if (!uri) return;
    // Show the local image immediately.
    setLocalLogoUri(uri);
    // The logo path is <userId>/<businessId>/logo.jpg, so the upload needs a
    // business ID. New businesses have no row yet — defer the upload to Save,
    // which creates the row first and then uploads with the new ID. When editing
    // an existing business, upload now with the known ID and persist logo_url so
    // it survives navigating away before Save.
    if (!editingId) return;
    try {
      setUploadingLogo(true);
      const path = await uploadLogoFromUri(uri, editingId);
      setLogoUrl(path);
      // Two success checks: storage upload AND the DB write.
      await updateBusinessLogo(editingId, path);
      await refresh();
    } catch (err) {
      const e = err as { message?: string };
      console.error('[Business Logo] upload failed:', e?.message ?? err);
      Alert.alert('Logo upload failed', e?.message || 'Could not upload the logo. Please try again.');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSave = async () => {
    if (!businessName.trim()) {
      Alert.alert('Missing name', 'Business name is required.');
      return;
    }
    const payload: BusinessFormInput = {
      business_name: businessName,
      entity_type: entityType,
      ein: ein || null,
      address: address || null,
      // For a new business the logo is uploaded after the row exists (below), so
      // it can use the new business ID in its path. Existing businesses already
      // have logo_url persisted from handlePickLogo.
      logo_url: editingId ? logoUrl : null,
    };
    setSaving(true);
    try {
      if (editingId) {
        await updateBusiness(editingId, payload);
      } else {
        const created = await createBusiness(payload);
        // Now that the business row exists, upload the picked logo using the new
        // ID so it lands at <userId>/<businessId>/logo.jpg, then persist the path.
        if (localLogoUri) {
          const path = await uploadLogoFromUri(localLogoUri, created.id);
          await updateBusinessLogo(created.id, path);
        }
        // Auto-activate a newly-created business so users immediately work in it.
        setActiveBusinessId(created.id);
      }
      await refresh();
      navigation.goBack();
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Business Name *</Text>
        <TextInput
          value={businessName}
          onChangeText={setBusinessName}
          style={styles.input}
          placeholder="e.g. Acme Holdings LLC"
          placeholderTextColor={colors.subtleText}
        />

        <Text style={styles.label}>Entity Type</Text>
        <View style={styles.entityRow}>
          {ENTITY_TYPES.map((t) => {
            const active = entityType === t;
            return (
              <TouchableOpacity
                key={t}
                style={[styles.entityChip, active && styles.entityChipActive]}
                onPress={() => setEntityType(t)}
                activeOpacity={0.85}
              >
                <Text style={[styles.entityChipText, active && styles.entityChipTextActive]}>
                  {t}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.label}>EIN (optional)</Text>
        <TextInput
          value={ein}
          onChangeText={setEin}
          style={styles.input}
          placeholder="00-0000000"
          placeholderTextColor={colors.subtleText}
          keyboardType="number-pad"
        />

        <Text style={styles.label}>Address</Text>
        <TextInput
          value={address}
          onChangeText={setAddress}
          style={[styles.input, styles.multiline]}
          placeholder="Street, City, State ZIP"
          placeholderTextColor={colors.subtleText}
          multiline
        />

        <Text style={styles.label}>Logo</Text>
        <View style={styles.logoBlock}>
          {previewLogo ? (
            <Image
              source={{ uri: previewLogo }}
              style={styles.logoPreview}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.logoPlaceholder}>
              <Ionicons name="image-outline" size={32} color={colors.subtleText} />
            </View>
          )}
          <TouchableOpacity
            style={[styles.logoBtn, uploadingLogo && styles.btnDisabled]}
            onPress={handlePickLogo}
            disabled={uploadingLogo}
            activeOpacity={0.85}
          >
            {uploadingLogo ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={16} color={colors.white} />
                <Text style={styles.logoBtnText}>
                  {localLogoUri || logoUrl ? 'Replace logo' : 'Upload logo'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.btnDisabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.saveBtnText}>{editingId ? 'Save Changes' : 'Add Business'}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.sm,
    paddingBottom: spacing.xxxl,
  },
  label: {
    ...typography.caption,
    color: colors.mutedText,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: spacing.md,
  },
  input: {
    backgroundColor: colors.white,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    ...typography.body,
    color: colors.bodyText,
  },
  multiline: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  entityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  entityChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
  },
  entityChipActive: {
    backgroundColor: colors.midNavy,
    borderColor: colors.midNavy,
  },
  entityChipText: {
    ...typography.caption,
    color: colors.bodyText,
    fontWeight: '600',
  },
  entityChipTextActive: {
    color: colors.white,
  },
  logoBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  logoPreview: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: colors.white,
  },
  logoPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.midNavy,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: 8,
  },
  logoBtnText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '700',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.teal,
    paddingVertical: 14,
    borderRadius: 8,
    marginTop: spacing.xl,
  },
  saveBtnText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
