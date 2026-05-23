import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '../theme';

const DARK_AMBER_TEXT = '#633806';

interface AnnouncementBannerProps {
  message: string;
  onDismiss: () => void;
}

export const AnnouncementBanner: React.FC<AnnouncementBannerProps> = ({
  message,
  onDismiss,
}) => {
  return (
    <View style={styles.container}>
      <Ionicons
        name="megaphone-outline"
        size={18}
        color={DARK_AMBER_TEXT}
        style={styles.icon}
      />
      <Text style={styles.message} numberOfLines={3}>
        {message}
      </Text>
      <TouchableOpacity
        onPress={onDismiss}
        hitSlop={10}
        accessibilityLabel="Dismiss announcement"
        style={styles.closeBtn}
      >
        <Ionicons name="close" size={18} color={DARK_AMBER_TEXT} />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.amberLight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  icon: {
    marginTop: 1,
  },
  message: {
    ...typography.body,
    flex: 1,
    color: DARK_AMBER_TEXT,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  closeBtn: {
    marginTop: -2,
  },
});
