import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, radius } from '../theme';

interface ProgressBarProps {
  value: number;
  total?: number;
  color?: string;
  trackColor?: string;
  height?: number;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  total = 100,
  color = colors.midNavy,
  trackColor = colors.lightBlue,
  height = 8,
}) => {
  const pct = Math.max(0, Math.min(1, value / total));
  return (
    <View style={[styles.track, { backgroundColor: trackColor, height, borderRadius: height / 2 }]}>
      <View
        style={{
          width: `${pct * 100}%`,
          height: '100%',
          backgroundColor: color,
          borderRadius: height / 2,
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  track: {
    width: '100%',
    overflow: 'hidden',
  },
});
