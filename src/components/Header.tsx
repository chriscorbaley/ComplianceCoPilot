import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  StatusBar,
  Pressable,
  TouchableOpacity,
  Modal,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../theme';
import { useAuth } from '../auth/AuthContext';
import { useBusiness } from '../business/BusinessContext';
import { useSignedLogoUrls } from '../hooks/useSignedLogoUrls';
import type { RootStackParamList } from '../navigation/types';
import type { BusinessRow } from '../services/supabase';

interface HeaderProps {
  subtitle?: string;
  year?: number;
}

export const Header: React.FC<HeaderProps> = ({ subtitle, year = 2026 }) => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { isAdmin, fullName } = useAuth();
  const { businesses, activeBusiness, setActiveBusinessId, refresh } = useBusiness();
  const displaySubtitle = subtitle ?? fullName ?? ' ';

  const [switcherOpen, setSwitcherOpen] = useState(false);
  // The 'business-logos' bucket is private, so we render short-lived signed URLs
  // keyed by business id instead of the stored storage path. Re-minted on focus.
  const logoUrls = useSignedLogoUrls(businesses);

  // Re-pull businesses so logo_url reflects a just-saved change whenever this
  // header comes back into focus.
  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => undefined);
    }, [refresh]),
  );

  const onLogoLongPress = () => {
    if (!isAdmin) return;
    navigation.navigate('AdminPanel');
  };

  const onSettingsPress = () => {
    navigation.navigate('Settings');
  };

  const onPickBusiness = (b: BusinessRow) => {
    setActiveBusinessId(b.id);
    setSwitcherOpen(false);
  };

  const onManageBusinesses = () => {
    setSwitcherOpen(false);
    navigation.navigate('Businesses');
  };

  const switcherLabel = activeBusiness?.business_name ?? 'Choose business';
  const switcherLogo = activeBusiness ? logoUrls[activeBusiness.id] ?? null : null;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.navy} />
      <View style={styles.row}>
        <Pressable
          style={styles.leftBlock}
          onLongPress={onLogoLongPress}
          delayLongPress={1200}
          android_disableSound
        >
          <Image
            source={switcherLogo ? { uri: switcherLogo } : require('../../assets/logo.png')}
            style={switcherLogo ? styles.bizBrandLogo : styles.logo}
            resizeMode={switcherLogo ? 'cover' : 'contain'}
          />
          <Text style={styles.subtitle} numberOfLines={1}>
            {displaySubtitle}
          </Text>
        </Pressable>
        <View style={styles.rightBlock}>
          <TouchableOpacity
            style={styles.bizSwitcher}
            onPress={() => setSwitcherOpen(true)}
            activeOpacity={0.7}
            hitSlop={6}
          >
            {switcherLogo ? (
              <Image source={{ uri: switcherLogo }} style={styles.bizLogo} resizeMode="cover" />
            ) : (
              <View style={styles.bizLogoPlaceholder}>
                <Ionicons name="business-outline" size={12} color={colors.white} />
              </View>
            )}
            <Text style={styles.bizName} numberOfLines={1}>
              {switcherLabel}
            </Text>
            <Ionicons name="chevron-down" size={14} color={colors.white} />
          </TouchableOpacity>
          <View style={styles.yearPill}>
            <Text style={styles.yearText}>{year}</Text>
          </View>
          <TouchableOpacity
            onPress={onSettingsPress}
            style={styles.settingsBtn}
            hitSlop={8}
            activeOpacity={0.7}
          >
            <Ionicons name="settings-outline" size={20} color={colors.white} />
          </TouchableOpacity>
        </View>
      </View>

      <Modal
        visible={switcherOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSwitcherOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setSwitcherOpen(false)}>
          <Pressable style={styles.modalSheet} onPress={() => undefined}>
            <Text style={styles.modalTitle}>Switch Business</Text>
            {businesses.length === 0 ? (
              <Text style={styles.emptyText}>
                You haven't added a business yet. Use "Manage businesses" to add your first one.
              </Text>
            ) : (
              <ScrollView style={styles.bizList} contentContainerStyle={styles.bizListContent}>
                {businesses.map((b) => {
                  const isActive = b.id === activeBusiness?.id;
                  const rowLogo = logoUrls[b.id] ?? null;
                  return (
                    <TouchableOpacity
                      key={b.id}
                      style={[styles.bizRow, isActive && styles.bizRowActive]}
                      onPress={() => onPickBusiness(b)}
                      activeOpacity={0.7}
                    >
                      {rowLogo ? (
                        <Image source={{ uri: rowLogo }} style={styles.bizRowLogo} />
                      ) : (
                        <View style={styles.bizRowLogoPlaceholder}>
                          <Ionicons name="business-outline" size={18} color={colors.midNavy} />
                        </View>
                      )}
                      <View style={styles.bizRowText}>
                        <Text style={styles.bizRowName} numberOfLines={1}>
                          {b.business_name}
                          {b.is_default ? '  ·  default' : ''}
                        </Text>
                        {b.entity_type ? (
                          <Text style={styles.bizRowEntity}>{b.entity_type}</Text>
                        ) : null}
                      </View>
                      {isActive ? (
                        <Ionicons name="checkmark-circle" size={20} color={colors.teal} />
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            <TouchableOpacity
              style={styles.manageBtn}
              onPress={onManageBusinesses}
              activeOpacity={0.85}
            >
              <Ionicons name="settings-outline" size={16} color={colors.midNavy} />
              <Text style={styles.manageText}>Manage businesses</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.navy,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  leftBlock: {
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'flex-start',
    marginRight: spacing.sm,
  },
  logo: {
    height: 28,
    width: undefined,
    aspectRatio: 1,
    alignSelf: 'flex-start',
  },
  // Business logo shown in the main/left brand slot (replaces the CCP logo once
  // the active business has an uploaded logo). Rounded + white-backed so any
  // aspect ratio reads cleanly against the navy header.
  bizBrandLogo: {
    height: 28,
    width: 28,
    borderRadius: 6,
    backgroundColor: colors.white,
    alignSelf: 'flex-start',
  },
  subtitle: {
    ...typography.caption,
    color: 'rgba(255, 255, 255, 0.75)',
    marginTop: 2,
    fontSize: 12,
  },
  rightBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  bizSwitcher: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    maxWidth: 160,
  },
  bizLogo: {
    width: 18,
    height: 18,
    borderRadius: 4,
    backgroundColor: colors.white,
  },
  bizLogoPlaceholder: {
    width: 18,
    height: 18,
    borderRadius: 4,
    backgroundColor: colors.midNavy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bizName: {
    ...typography.caption,
    color: colors.white,
    fontWeight: '600',
    fontSize: 12,
    flexShrink: 1,
  },
  yearPill: {
    backgroundColor: colors.midNavy,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  yearText: {
    ...typography.caption,
    color: colors.white,
    fontWeight: '700',
    fontSize: 13,
  },
  settingsBtn: {
    padding: 4,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
    maxHeight: '70%',
  },
  modalTitle: {
    ...typography.h2,
    color: colors.bodyText,
    marginBottom: spacing.md,
  },
  bizList: {
    maxHeight: 320,
  },
  bizListContent: {
    paddingBottom: spacing.sm,
  },
  bizRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius.card,
    marginBottom: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
  },
  bizRowActive: {
    borderColor: colors.teal,
    backgroundColor: colors.tealLight,
  },
  bizRowLogo: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: colors.white,
  },
  bizRowLogoPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: colors.lightBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bizRowText: {
    flex: 1,
  },
  bizRowName: {
    ...typography.bodyMedium,
    color: colors.bodyText,
  },
  bizRowEntity: {
    ...typography.caption,
    color: colors.mutedText,
    marginTop: 2,
  },
  emptyText: {
    ...typography.body,
    color: colors.mutedText,
    marginVertical: spacing.md,
  },
  manageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    marginTop: spacing.sm,
  },
  manageText: {
    ...typography.bodyMedium,
    color: colors.midNavy,
    fontWeight: '600',
  },
});
