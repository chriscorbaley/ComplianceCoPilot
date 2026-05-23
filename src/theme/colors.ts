export const colors = {
  navy: '#042C53',
  midNavy: '#185FA5',
  lightBlue: '#E6F1FB',

  teal: '#0F6E56',
  tealLight: '#E1F5EE',

  amber: '#BA7517',
  amberLight: '#FAEEDA',

  white: '#FFFFFF',
  bodyText: '#1A1A2E',
  mutedText: '#6B7280',
  subtleText: '#9CA3AF',

  background: '#F5F7FA',
  cardBorder: 'rgba(0, 0, 0, 0.08)',
  divider: '#E5E7EB',

  orangeAlert: '#E76F2C',
  orangeAlertBg: '#FEF1E7',
} as const;

export type ColorKey = keyof typeof colors;
