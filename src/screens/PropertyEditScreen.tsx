import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, radius, spacing, typography } from '../theme';
import { useBusiness } from '../business/BusinessContext';
import {
  PROPERTY_TYPES,
  PROPERTY_TYPE_LABEL,
  MP_TEST_LABEL,
  MP_TEST_ORDER,
  MP_TEST_INT,
  MP_TEST_FROM_INT,
  createProperty,
  listProperties,
  updateProperty,
  type PropertyFormInput,
} from '../services/properties';
import type { PropertyRow, PropertyType, MpTestKey } from '../services/supabase';
import type { RootStackParamList } from '../navigation/types';

type Route = RouteProp<RootStackParamList, 'PropertyEdit'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

export const PropertyEditScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const editingId = params?.propertyId;
  const { activeBusinessId } = useBusiness();

  const [existing, setExisting] = useState<PropertyRow | null>(null);
  const [loading, setLoading] = useState(!!editingId);
  const [propertyName, setPropertyName] = useState('');
  const [propertyType, setPropertyType] = useState<PropertyType | null>(null);
  const [hasGrouping, setHasGrouping] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [mpTest, setMpTest] = useState<MpTestKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [existingGroupNames, setExistingGroupNames] = useState<string[]>([]);

  useEffect(() => {
    navigation.setOptions({ title: editingId ? 'Edit Property' : 'Add Property' });
  }, [editingId, navigation]);

  // Load existing property + the list of group names already in use so the
  // user can either pick one or type a new one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const props = await listProperties(activeBusinessId);
        if (cancelled) return;
        const names = Array.from(
          new Set(
            props
              .filter((p) => p.grouping_election && p.grouping_group_name)
              .map((p) => p.grouping_group_name as string),
          ),
        );
        setExistingGroupNames(names);
        if (editingId) {
          const e = props.find((p) => p.id === editingId) ?? null;
          setExisting(e);
          if (e) {
            setPropertyName(e.property_name);
            setPropertyType(e.property_type);
            setHasGrouping(!!e.grouping_election);
            setGroupName(e.grouping_group_name ?? '');
            // mp_test_selected comes back as an integer code from Postgres; map
            // it back to the string key the selector renders against.
            setMpTest(e.mp_test_selected != null ? MP_TEST_FROM_INT[e.mp_test_selected] ?? null : null);
          }
        }
      } catch (err) {
        Alert.alert('Could not load', err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editingId, activeBusinessId]);

  const handleSave = async () => {
    if (!propertyName.trim()) {
      Alert.alert('Missing name', 'Property name is required.');
      return;
    }
    if (hasGrouping && !groupName.trim()) {
      Alert.alert(
        'Group name needed',
        'Enter a group name (e.g. "Rental Portfolio Group 1") or pick an existing one.',
      );
      return;
    }
    const payload: PropertyFormInput = {
      business_id: activeBusinessId,
      property_name: propertyName,
      // The DB check constraint requires exactly 'long_term' or 'short_term';
      // default to long_term when the user hasn't picked a type.
      property_type: propertyType ?? 'long_term',
      mp_test_selected: mpTest ? MP_TEST_INT[mpTest] : null,
      grouping_election: hasGrouping,
      grouping_group_name: hasGrouping ? groupName : null,
    };
    setSaving(true);
    try {
      if (editingId) {
        await updateProperty(editingId, payload);
      } else {
        await createProperty(payload);
      }
      navigation.goBack();
    } catch (err) {
      Alert.alert('Save failed', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const groupChips = useMemo(() => existingGroupNames, [existingGroupNames]);

  if (loading) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.midNavy} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Property Name *</Text>
        <TextInput
          value={propertyName}
          onChangeText={setPropertyName}
          style={styles.input}
          placeholder="e.g. 123 Main St Scottsdale"
          placeholderTextColor={colors.subtleText}
        />

        <Text style={styles.label}>Property Type</Text>
        <View style={styles.chipRow}>
          {PROPERTY_TYPES.map((t) => {
            const active = propertyType === t;
            return (
              <TouchableOpacity
                key={t}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setPropertyType(t)}
                activeOpacity={0.85}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {PROPERTY_TYPE_LABEL[t]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.label}>Material Participation Test</Text>
        <View style={styles.mpTestList}>
          {MP_TEST_ORDER.map((t) => {
            const active = mpTest === t;
            return (
              <TouchableOpacity
                key={t}
                style={[styles.mpTestRow, active && styles.mpTestRowActive]}
                onPress={() => setMpTest(active ? null : t)}
                activeOpacity={0.85}
              >
                <View
                  style={[styles.mpTestDot, active && styles.mpTestDotActive]}
                />
                <Text
                  style={[styles.mpTestText, active && styles.mpTestTextActive]}
                >
                  {MP_TEST_LABEL[t]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.toggleBlock}>
          <View style={styles.toggleRow}>
            <View style={styles.toggleText}>
              <Text style={styles.toggleTitle}>Grouping election</Text>
              <Text style={styles.toggleHint}>
                Combine this property&apos;s hours with others in the group when
                evaluating material participation.
              </Text>
            </View>
            <Switch
              value={hasGrouping}
              onValueChange={setHasGrouping}
              trackColor={{ false: colors.divider, true: colors.midNavy }}
              thumbColor={colors.white}
            />
          </View>
          {hasGrouping ? (
            <>
              <Text style={styles.label}>Group Name</Text>
              <TextInput
                value={groupName}
                onChangeText={setGroupName}
                style={styles.input}
                placeholder="e.g. Rental Portfolio Group 1"
                placeholderTextColor={colors.subtleText}
              />
              {groupChips.length > 0 ? (
                <View style={styles.chipRow}>
                  {groupChips.map((name) => {
                    const active = name === groupName;
                    return (
                      <TouchableOpacity
                        key={name}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() => setGroupName(name)}
                        activeOpacity={0.85}
                      >
                        <Text
                          style={[styles.chipText, active && styles.chipTextActive]}
                          numberOfLines={1}
                        >
                          {name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}
            </>
          ) : null}
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
            <Text style={styles.saveBtnText}>
              {editingId ? 'Save Changes' : 'Add Property'}
            </Text>
          )}
        </TouchableOpacity>

        {existing ? (
          <Text style={styles.metaNote}>
            Created {new Date(existing.created_at).toLocaleDateString()}
          </Text>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
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
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
  },
  chipActive: {
    backgroundColor: colors.midNavy,
    borderColor: colors.midNavy,
  },
  chipText: {
    ...typography.caption,
    color: colors.bodyText,
    fontWeight: '600',
  },
  chipTextActive: {
    color: colors.white,
  },
  toggleBlock: {
    marginTop: spacing.lg,
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  toggleText: {
    flex: 1,
  },
  toggleTitle: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontWeight: '700',
    fontSize: 14,
  },
  toggleHint: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 2,
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
  metaNote: {
    ...typography.caption,
    color: colors.mutedText,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  mpTestList: {
    gap: spacing.sm,
  },
  mpTestRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
    padding: spacing.md,
  },
  mpTestRowActive: {
    borderColor: colors.teal,
    borderWidth: 2,
    backgroundColor: colors.tealLight,
  },
  mpTestDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.divider,
    marginTop: 2,
  },
  mpTestDotActive: {
    borderColor: colors.teal,
    backgroundColor: colors.teal,
  },
  mpTestText: {
    flex: 1,
    color: colors.bodyText,
    fontSize: 13,
    lineHeight: 18,
  },
  mpTestTextActive: {
    fontWeight: '700',
  },
});
