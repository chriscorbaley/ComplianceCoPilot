import React from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors } from '../theme';
import { scaled } from '../constants/layout';
import type { RootStackParamList } from '../navigation/types';

interface VoiceUpgradeSheetProps {
  visible: boolean;
  onClose: () => void;
}

// Bottom sheet shown when a Basic subscriber taps the (amber) microphone button.
// AI voice logging is a Core/Pro feature; this explains the value and routes to
// the in-app Upgrade screen.
export const VoiceUpgradeSheet: React.FC<VoiceUpgradeSheetProps> = ({
  visible,
  onClose,
}) => {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const goUpgrade = (tier: 'core' | 'pro') => {
    onClose();
    navigation.navigate('ChoosePlan', { highlight: tier });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.iconWrap}>
              <Ionicons name="mic" size={20} color={colors.amber} />
            </View>
            <Text style={styles.title}>Upgrade to unlock AI Voice</Text>
          </View>
          <Text style={styles.desc}>
            AI voice-to-doc fill automatically transcribes your speech and fills
            the correct compliance fields — no typing required. Available on Core
            and Pro.
          </Text>
          <View style={styles.statRow}>
            <Ionicons name="time-outline" size={16} color={colors.teal} />
            <Text style={styles.statText}>
              Core members save an average of 2+ hours per week on compliance
              logging
            </Text>
          </View>
          <TouchableOpacity
            activeOpacity={0.85}
            style={[styles.cta, styles.ctaCore]}
            onPress={() => goUpgrade('core')}
          >
            <Text style={styles.ctaText}>Upgrade to Core — $99/mo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.85}
            style={[styles.cta, styles.ctaPro]}
            onPress={() => goUpgrade('pro')}
          >
            <Text style={styles.ctaText}>Upgrade to Pro — $199/mo</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.7} onPress={onClose} style={styles.dismiss}>
            <Text style={styles.dismissText}>Not now</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 20,
    paddingBottom: 28,
    gap: 12,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.divider,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(186,117,23,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    color: '#042C53',
    fontSize: 17,
    fontWeight: '700',
  },
  desc: {
    color: colors.bodyText,
    fontSize: 14,
    lineHeight: 20,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.tealLight,
    borderRadius: 10,
    padding: 12,
  },
  statText: {
    flex: 1,
    color: colors.teal,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
  cta: {
    borderRadius: 10,
    paddingVertical: scaled(14),
    minHeight: scaled(44),
    alignItems: 'center',
  },
  ctaCore: {
    marginTop: 4,
    backgroundColor: colors.navy,
  },
  ctaPro: {
    backgroundColor: colors.amber,
  },
  ctaText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  dismiss: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  dismissText: {
    color: colors.mutedText,
    fontSize: 13,
    fontWeight: '600',
  },
});
