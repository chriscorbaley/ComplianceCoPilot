import React, { useCallback } from 'react';
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, radius, spacing, typography } from '../theme';
import { useBusiness } from '../business/BusinessContext';
import { deleteBusiness, setDefaultBusiness } from '../services/businesses';
import type { RootStackParamList } from '../navigation/types';
import type { BusinessRow } from '../services/supabase';

export const BusinessesScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { businesses, activeBusinessId, setActiveBusinessId, refresh } = useBusiness();

  // Refresh on focus so an edit/add in the form screen is reflected here.
  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => undefined);
    }, [refresh]),
  );

  const handleDelete = (b: BusinessRow) => {
    Alert.alert(
      'Delete business?',
      `${b.business_name} will be removed. Records previously tagged to it will keep their existing data but become unfiled.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteBusiness(b.id);
              if (activeBusinessId === b.id) setActiveBusinessId(null);
              await refresh();
            } catch (err) {
              Alert.alert('Could not delete', err instanceof Error ? err.message : String(err));
            }
          },
        },
      ],
    );
  };

  const handleSetDefault = async (b: BusinessRow) => {
    try {
      await setDefaultBusiness(b.id);
      await refresh();
    } catch (err) {
      Alert.alert('Could not set default', err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        {businesses.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="business-outline" size={28} color={colors.midNavy} />
            <Text style={styles.emptyTitle}>No businesses yet</Text>
            <Text style={styles.emptyBody}>
              Add your first business so we can tag every hour log, trip, meeting, and document to
              the right entity.
            </Text>
          </View>
        ) : (
          businesses.map((b) => (
            <View key={b.id} style={styles.card}>
              <View style={styles.cardRow}>
                {b.logo_url ? (
                  <Image source={{ uri: b.logo_url }} style={styles.logo} />
                ) : (
                  <View style={styles.logoPlaceholder}>
                    <Ionicons name="business-outline" size={22} color={colors.midNavy} />
                  </View>
                )}
                <View style={styles.cardText}>
                  <Text style={styles.cardName} numberOfLines={1}>
                    {b.business_name}
                  </Text>
                  <Text style={styles.cardMeta} numberOfLines={1}>
                    {[b.entity_type, b.ein ? `EIN ${b.ein}` : null].filter(Boolean).join(' · ')}
                  </Text>
                  {b.address ? (
                    <Text style={styles.cardAddress} numberOfLines={2}>
                      {b.address}
                    </Text>
                  ) : null}
                </View>
                {b.is_default ? (
                  <View style={styles.defaultPill}>
                    <Text style={styles.defaultPillText}>DEFAULT</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => navigation.navigate('BusinessEdit', { businessId: b.id })}
                >
                  <Ionicons name="create-outline" size={16} color={colors.midNavy} />
                  <Text style={styles.actionText}>Edit</Text>
                </TouchableOpacity>
                {!b.is_default ? (
                  <TouchableOpacity style={styles.actionBtn} onPress={() => handleSetDefault(b)}>
                    <Ionicons name="star-outline" size={16} color={colors.midNavy} />
                    <Text style={styles.actionText}>Set default</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity style={styles.actionBtn} onPress={() => handleDelete(b)}>
                  <Ionicons name="trash-outline" size={16} color="#C0392B" />
                  <Text style={[styles.actionText, { color: '#C0392B' }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}

        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => navigation.navigate('BusinessEdit')}
          activeOpacity={0.85}
        >
          <Ionicons name="add-circle-outline" size={18} color={colors.white} />
          <Text style={styles.addBtnText}>Add Business</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  emptyCard: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
  },
  emptyTitle: {
    ...typography.h2,
    color: colors.bodyText,
  },
  emptyBody: {
    ...typography.body,
    color: colors.mutedText,
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: colors.background,
  },
  logoPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: colors.lightBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: {
    flex: 1,
  },
  cardName: {
    ...typography.h3,
    color: colors.bodyText,
  },
  cardMeta: {
    ...typography.caption,
    color: colors.mutedText,
    marginTop: 2,
  },
  cardAddress: {
    ...typography.caption,
    color: colors.mutedText,
    marginTop: 4,
  },
  defaultPill: {
    backgroundColor: colors.tealLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  defaultPillText: {
    ...typography.micro,
    color: colors.teal,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    flexWrap: 'wrap',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionText: {
    ...typography.caption,
    color: colors.midNavy,
    fontWeight: '600',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.midNavy,
    paddingVertical: 14,
    borderRadius: 8,
    marginTop: spacing.sm,
  },
  addBtnText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
});
