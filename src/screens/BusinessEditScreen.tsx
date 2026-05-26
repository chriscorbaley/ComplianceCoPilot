import React, { useEffect, useMemo, useState } from 'react';
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
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import { colors, radius, spacing, typography } from '../theme';
import {
  ENTITY_TYPES,
  createBusiness,
  updateBusiness,
  uploadLogoFromUri,
  type BusinessFormInput,
} from '../services/businesses';
import { useBusiness } from '../business/BusinessContext';
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
  const [logoUrl, setLogoUrl] = useState<string | null>(existing?.logo_url ?? null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: editingId ? 'Edit Business' : 'Add Business' });
  }, [editingId, navigation]);

  const handlePickLogo = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'image/*',
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      setUploadingLogo(true);
      const url = await uploadLogoFromUri(result.assets[0].uri);
      setLogoUrl(url);
    } catch (err) {
      Alert.alert('Logo upload failed', err instanceof Error ? err.message : String(err));
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
      logo_url: logoUrl,
    };
    setSaving(true);
    try {
      if (editingId) {
        await updateBusiness(editingId, payload);
      } else {
        const created = await createBusiness(payload);
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
          {logoUrl ? (
            <Image source={{ uri: logoUrl }} style={styles.logoPreview} resizeMode="cover" />
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
                <Text style={styles.logoBtnText}>{logoUrl ? 'Replace logo' : 'Upload logo'}</Text>
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
