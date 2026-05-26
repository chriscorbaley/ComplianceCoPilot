import React from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';

interface LockedStrategySheetProps {
  visible: boolean;
  title: string;
  description: string;
  requiredTier: 'Core' | 'Pro';
  onClose: () => void;
}

export const LockedStrategySheet: React.FC<LockedStrategySheetProps> = ({
  visible,
  title,
  description,
  requiredTier,
  onClose,
}) => {
  const onUpgrade = () => {
    onClose();
    // In-app subscription upgrade isn't built yet — route the user to
    // support. Replace with a real upgrade flow when one exists.
    Alert.alert(
      `Upgrade to ${requiredTier}`,
      `Email support@compliancecopilot.com to upgrade your plan to ${requiredTier}.`,
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.lock}>
              <Ionicons name="lock-closed" size={20} color={colors.amber} />
            </View>
            <Text style={styles.title}>{title}</Text>
          </View>
          <Text style={styles.desc}>{description}</Text>
          <Text style={styles.requires}>This strategy requires {requiredTier}.</Text>
          <TouchableOpacity activeOpacity={0.85} style={styles.upgrade} onPress={onUpgrade}>
            <Text style={styles.upgradeText}>Upgrade Now</Text>
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
  lock: {
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
  requires: {
    color: colors.amber,
    fontSize: 13,
    fontWeight: '700',
  },
  upgrade: {
    marginTop: 8,
    backgroundColor: '#BA7517',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  upgradeText: {
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
