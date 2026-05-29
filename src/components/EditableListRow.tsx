import React from 'react';
import { StyleProp, StyleSheet, TouchableOpacity, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing } from '../theme';

interface EditableListRowProps {
  children: React.ReactNode;
  onPress: () => void;
  // Hide the trailing chevron for rows that are tappable but shouldn't read as
  // "drill-in" (rare). Defaults to showing the chevron.
  showChevron?: boolean;
  style?: StyleProp<ViewStyle>;
  // Style applied to the inner content wrapper (e.g. to set the gap between an
  // icon, text block, and trailing value).
  contentStyle?: StyleProp<ViewStyle>;
}

// Chevron color is fixed at the spec's light gray so every editable row reads
// the same regardless of the surrounding card.
const CHEVRON_GRAY = '#CCCCCC';

/**
 * A tappable list row that signals "tap to edit" with a trailing chevron.
 * Wraps arbitrary row content (icon + text + trailing value) and adds the
 * chevron on the far right. Reused across the Hours, Trips, and Minutes lists.
 */
export const EditableListRow: React.FC<EditableListRowProps> = ({
  children,
  onPress,
  showChevron = true,
  style,
  contentStyle,
}) => (
  <TouchableOpacity
    activeOpacity={0.7}
    onPress={onPress}
    style={[styles.row, style]}
  >
    <View style={[styles.content, contentStyle]}>{children}</View>
    {showChevron ? (
      <Ionicons
        name="chevron-forward"
        size={18}
        color={CHEVRON_GRAY}
        style={styles.chevron}
      />
    ) : null}
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chevron: {
    marginLeft: spacing.sm,
  },
});
