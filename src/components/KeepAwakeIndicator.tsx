import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../theme';

interface KeepAwakeIndicatorProps {
  visible: boolean;
  style?: ViewStyle;
}

// Subtle "screen will stay on" badge shown next to the mic while a recording
// is in progress. Renders nothing when not visible so it can be dropped
// anywhere in a row without taking layout space at rest.
export const KeepAwakeIndicator: React.FC<KeepAwakeIndicatorProps> = ({
  visible,
  style,
}) => {
  if (!visible) return null;
  return (
    <View style={[styles.row, style]}>
      <Ionicons name="eye-outline" size={11} color={colors.midNavy} />
      <Text style={styles.text}>Screen active</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.lightBlue,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  text: {
    ...typography.micro,
    color: colors.midNavy,
    fontSize: 10,
    letterSpacing: 0.2,
  },
});
