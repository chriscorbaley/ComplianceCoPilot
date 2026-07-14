import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, shadow } from '../theme';
import { scaled } from '../constants/layout';

interface ComplianceReportButtonProps {
  // Generates and shares the report PDF. Receives no args — close over data
  // in the parent.
  onGenerate: () => Promise<void>;
  label?: string;
}

// Navy "Generate Report" button matching the Real Estate report button on the
// Strategy Detail screen, with the shared loading state.
export const ComplianceReportButton: React.FC<ComplianceReportButtonProps> = ({
  onGenerate,
  label = 'Generate Report',
}) => {
  const [generating, setGenerating] = useState(false);

  const onPress = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      await onGenerate();
    } catch (e) {
      Alert.alert('Report failed', e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={generating}
      style={[styles.btn, generating && styles.btnDisabled]}
    >
      {generating ? (
        <ActivityIndicator size="small" color={colors.white} />
      ) : (
        <Ionicons name="download-outline" size={18} color={colors.white} />
      )}
      <Text style={styles.btnText}>
        {generating ? 'Preparing your compliance report…' : label}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingVertical: scaled(13),
    minHeight: scaled(44),
    ...shadow.card,
  },
  btnDisabled: {
    opacity: 0.7,
  },
  btnText: {
    ...typography.bodyMedium,
    color: colors.white,
    fontWeight: '700',
    fontSize: 14,
  },
});
