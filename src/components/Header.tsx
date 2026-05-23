import React from 'react';
import { View, Text, Image, StyleSheet, StatusBar, Pressable, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../theme';
import { useAuth } from '../auth/AuthContext';
import type { RootStackParamList } from '../navigation/types';

interface HeaderProps {
  subtitle?: string;
  year?: number;
}

export const Header: React.FC<HeaderProps> = ({ subtitle, year = 2026 }) => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { isAdmin, fullName } = useAuth();
  const displaySubtitle = subtitle ?? fullName ?? ' ';

  const onLogoLongPress = () => {
    if (!isAdmin) return;
    navigation.navigate('AdminPanel');
  };

  const onSettingsPress = () => {
    navigation.navigate('Settings');
  };

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
            source={require('../../assets/logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.subtitle} numberOfLines={1}>
            {displaySubtitle}
          </Text>
        </Pressable>
        <View style={styles.rightBlock}>
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
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  logo: {
    height: 28,
    width: undefined,
    aspectRatio: 1,
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
});
