import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
  type TextInputProps,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, spacing, typography } from '../../theme';

export const AdminLoading: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <View style={sharedStyles.center}>
    <ActivityIndicator color={colors.midNavy} />
    <Text style={sharedStyles.mutedText}>{label}</Text>
  </View>
);

export const AdminEmpty: React.FC<{ icon?: keyof typeof Ionicons.glyphMap; title: string; hint?: string }> = ({
  icon = 'folder-open-outline',
  title,
  hint,
}) => (
  <View style={sharedStyles.center}>
    <Ionicons name={icon} size={32} color={colors.subtleText} />
    <Text style={sharedStyles.emptyTitle}>{title}</Text>
    {hint ? <Text style={sharedStyles.mutedText}>{hint}</Text> : null}
  </View>
);

interface AdminCardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export const AdminCard: React.FC<AdminCardProps> = ({ children, style }) => (
  <View style={[sharedStyles.card, style]}>{children}</View>
);

interface AdminButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const AdminButton: React.FC<AdminButtonProps> = ({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  loading,
  style,
}) => {
  const isDisabled = disabled || loading;
  const styleByVariant = {
    primary: { bg: colors.midNavy, fg: colors.white, border: 'transparent' },
    secondary: { bg: colors.lightBlue, fg: colors.midNavy, border: colors.lightBlue },
    danger: { bg: colors.orangeAlertBg, fg: colors.orangeAlert, border: 'transparent' },
    ghost: { bg: 'transparent', fg: colors.midNavy, border: colors.divider },
  }[variant];
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.85}
      style={[
        sharedStyles.btn,
        {
          backgroundColor: styleByVariant.bg,
          borderColor: styleByVariant.border,
          opacity: isDisabled ? 0.6 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={styleByVariant.fg} size="small" />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={14} color={styleByVariant.fg} /> : null}
          <Text style={[sharedStyles.btnText, { color: styleByVariant.fg }]}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
};

export const AdminInput: React.FC<TextInputProps & { label?: string }> = ({
  label,
  style,
  ...rest
}) => (
  <View style={sharedStyles.inputWrap}>
    {label ? <Text style={sharedStyles.inputLabel}>{label}</Text> : null}
    <TextInput
      {...rest}
      style={[sharedStyles.input, style]}
      placeholderTextColor={colors.subtleText}
    />
  </View>
);

export const AdminSectionTitle: React.FC<{ title: string; subtitle?: string }> = ({
  title,
  subtitle,
}) => (
  <View style={sharedStyles.sectionTitle}>
    <Text style={sharedStyles.sectionTitleText}>{title}</Text>
    {subtitle ? <Text style={sharedStyles.sectionSubtitleText}>{subtitle}</Text> : null}
  </View>
);

export const SourceTag: React.FC<{ source: string | null }> = ({ source }) => {
  if (!source) return null;
  const colorBg =
    source === 'IRS' ? colors.lightBlue
    : source === 'TaxCourt' ? colors.amberLight
    : colors.tealLight;
  const colorFg =
    source === 'IRS' ? colors.midNavy
    : source === 'TaxCourt' ? colors.amber
    : colors.teal;
  return (
    <View style={[sharedStyles.tag, { backgroundColor: colorBg }]}>
      <Text style={[sharedStyles.tagText, { color: colorFg }]}>{source}</Text>
    </View>
  );
};

export const sharedStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    ...shadow.card,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    marginTop: spacing.xs,
  },
  mutedText: {
    ...typography.caption,
    color: colors.mutedText,
    textAlign: 'center',
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  btnText: {
    ...typography.bodyMedium,
    fontSize: 13,
    fontWeight: '700',
  },
  inputWrap: {
    gap: 4,
  },
  inputLabel: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    ...typography.body,
    color: colors.bodyText,
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
  },
  sectionTitle: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  sectionTitleText: {
    ...typography.h2,
    color: colors.bodyText,
    fontSize: 17,
  },
  sectionSubtitleText: {
    ...typography.caption,
    color: colors.mutedText,
    marginTop: 2,
  },
  tag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  tagText: {
    ...typography.micro,
    fontSize: 10,
    letterSpacing: 0.5,
  },
});

export const listStyles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rowTitle: {
    ...typography.h3,
    color: colors.bodyText,
    fontSize: 14,
  },
  rowSubtitle: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 2,
  },
  rowMeta: {
    ...typography.micro,
    color: colors.subtleText,
    fontSize: 10,
    marginTop: 4,
    letterSpacing: 0.5,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
