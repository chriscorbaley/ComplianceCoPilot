import { Platform, TextStyle } from 'react-native';

const fontFamily = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'System',
});

export const typography = {
  display: {
    fontFamily,
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.3,
  } as TextStyle,
  h1: {
    fontFamily,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.2,
  } as TextStyle,
  h2: {
    fontFamily,
    fontSize: 18,
    fontWeight: '600',
  } as TextStyle,
  h3: {
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
  } as TextStyle,
  body: {
    fontFamily,
    fontSize: 14,
    fontWeight: '400',
  } as TextStyle,
  bodyMedium: {
    fontFamily,
    fontSize: 14,
    fontWeight: '500',
  } as TextStyle,
  caption: {
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
  } as TextStyle,
  micro: {
    fontFamily,
    fontSize: 11,
    fontWeight: '600',
  } as TextStyle,
  metric: {
    fontFamily,
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.5,
  } as TextStyle,
} as const;
