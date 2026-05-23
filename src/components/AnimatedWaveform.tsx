import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, ViewStyle } from 'react-native';
import { colors } from '../theme';

interface AnimatedWaveformProps {
  active: boolean;
  barCount?: number;
  barColor?: string;
  idleColor?: string;
  height?: number;
  style?: ViewStyle;
}

const seededHeights = (count: number) =>
  Array.from({ length: count }, (_, i) => {
    const n = Math.sin((i + 1) * 12.9898) * 43758.5453;
    const frac = n - Math.floor(n);
    return 0.35 + frac * 0.6;
  });

export const AnimatedWaveform: React.FC<AnimatedWaveformProps> = ({
  active,
  barCount = 28,
  barColor = colors.midNavy,
  idleColor = colors.divider,
  height = 56,
  style,
}) => {
  const animatedValues = useRef(
    Array.from({ length: barCount }, () => new Animated.Value(0)),
  ).current;
  const peakHeights = useRef(seededHeights(barCount)).current;

  useEffect(() => {
    if (!active) {
      animatedValues.forEach((v) => {
        v.stopAnimation();
        v.setValue(0);
      });
      return;
    }

    const loops = animatedValues.map((value, i) => {
      const upDuration = 280 + ((i * 53) % 220);
      const downDuration = 240 + ((i * 37) % 200);
      const delay = (i * 47) % 320;
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, {
            toValue: 1,
            duration: upDuration,
            easing: Easing.out(Easing.quad),
            useNativeDriver: false,
          }),
          Animated.timing(value, {
            toValue: 0.2,
            duration: downDuration,
            easing: Easing.in(Easing.quad),
            useNativeDriver: false,
          }),
        ]),
      );
    });

    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [active, animatedValues]);

  const minBarHeight = 4;

  return (
    <View style={[styles.row, { height }, style]}>
      {animatedValues.map((value, i) => {
        const peak = peakHeights[i] * height;
        const barHeight = active
          ? value.interpolate({
              inputRange: [0, 1],
              outputRange: [minBarHeight, peak],
            })
          : minBarHeight;
        return (
          <Animated.View
            key={i}
            style={[
              styles.bar,
              {
                height: barHeight,
                backgroundColor: active ? barColor : idleColor,
              },
            ]}
          />
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  bar: {
    width: 4,
    borderRadius: 2,
  },
});
