import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../theme';

// Shown in place of a microphone button when the `voice_features` flag is
// turned off firm-wide. Keeps the surface graceful — never a blank gap where a
// mic used to be.
export const VoiceUnavailableNotice: React.FC<{ style?: StyleProp<ViewStyle> }> = ({
  style,
}) => (
  <View style={[styles.wrap, style]}>
    <Ionicons name="mic-off-outline" size={16} color={colors.mutedText} />
    <Text style={styles.text}>Voice temporarily unavailable</Text>
  </View>
);

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radius.card,
    backgroundColor: colors.lightBlue,
  },
  text: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 12,
    fontWeight: '600',
  },
});
