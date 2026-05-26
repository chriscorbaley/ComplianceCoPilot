import React from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';

interface LockedScreenProps {
  title: string;
  description: string;
  requiredTier: 'Core' | 'Pro';
}

export const LockedScreen: React.FC<LockedScreenProps> = ({ title, description, requiredTier }) => {
  const insets = useSafeAreaInsets();

  const onUpgrade = () => {
    Alert.alert(
      `Upgrade to ${requiredTier}`,
      `Email support@compliancecopilot.com to upgrade your plan to ${requiredTier}.`,
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.lockWrap}>
        <Ionicons name="lock-closed" size={36} color={colors.amber} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.desc}>{description}</Text>
      <Text style={styles.requires}>Available on {requiredTier}.</Text>
      <TouchableOpacity activeOpacity={0.85} style={styles.upgrade} onPress={onUpgrade}>
        <Text style={styles.upgradeText}>Upgrade Now</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  lockWrap: {
    marginTop: 32,
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(186,117,23,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    marginTop: 20,
    color: '#042C53',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  desc: {
    marginTop: 8,
    color: colors.mutedText,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  requires: {
    marginTop: 16,
    color: colors.amber,
    fontSize: 14,
    fontWeight: '700',
  },
  upgrade: {
    marginTop: 24,
    backgroundColor: '#BA7517',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  upgradeText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
});
