// "Generate Accountable Plan" flow for the S-Corp compliance screen. Shows a
// summary of the plan, pre-fills the signer's name from the users table, lets
// them adopt the plan with a finger signature, then generates + saves + shares
// the branded PDF.

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, spacing, typography } from '../theme';
import { SignaturePad } from './SignaturePad';
import {
  generateAccountablePlan,
  formatLongDate,
} from '../services/scorpDocuments';

interface Props {
  visible: boolean;
  businessId: string | null;
  businessName: string;
  defaultSignerName: string;
  onClose: () => void;
  onGenerated: () => void;
}

export const AccountablePlanModal: React.FC<Props> = ({
  visible,
  businessId,
  businessName,
  defaultSignerName,
  onClose,
  onGenerated,
}) => {
  const [signerName, setSignerName] = useState(defaultSignerName);
  const [signerTitle, setSignerTitle] = useState('Owner / Shareholder');
  const [generating, setGenerating] = useState(false);
  const today = new Date();

  useEffect(() => {
    if (visible) {
      setSignerName(defaultSignerName);
      setSignerTitle('Owner / Shareholder');
      setGenerating(false);
    }
  }, [visible, defaultSignerName]);

  const onConfirm = async (signatureDataUrl: string) => {
    if (!signerName.trim()) {
      Alert.alert('Name required', 'Enter the signer name before adopting the plan.');
      return;
    }
    setGenerating(true);
    try {
      await generateAccountablePlan({
        businessId,
        businessName,
        signatureDataUrl,
        signerName: signerName.trim(),
        signerTitle: signerTitle.trim() || 'Owner / Shareholder',
        signedDate: new Date(),
      });
      onGenerated();
      onClose();
      Alert.alert(
        'Accountable Plan signed and saved',
        'Your Accountable Plan was saved to your S-Corp documents.',
      );
    } catch (e) {
      Alert.alert('Could not generate plan', e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Generate Accountable Plan</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.mutedText} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.docCard}>
              <Text style={styles.docTitle}>ACCOUNTABLE PLAN</Text>
              <Text style={styles.docSub}>{businessName} — S-Corporation</Text>
              <Text style={styles.docSub}>Adopted: {formatLongDate(today)}</Text>
              <Text style={styles.docBlurb}>
                Adopts an Accountable Plan under Treas. Reg. §1.62-2 allowing
                tax-free reimbursement of ordinary and necessary business
                expenses to employees and shareholders. The full plan — purpose,
                eligible expenses, reimbursement requirements, administration and
                adoption — is included in the generated PDF.
              </Text>
            </View>

            <Text style={styles.label}>Full name</Text>
            <TextInput
              style={styles.input}
              value={signerName}
              onChangeText={setSignerName}
              placeholder="Signer full name"
              placeholderTextColor={colors.subtleText}
            />

            <Text style={styles.label}>Title</Text>
            <TextInput
              style={styles.input}
              value={signerTitle}
              onChangeText={setSignerTitle}
              placeholder="Owner / Shareholder"
              placeholderTextColor={colors.subtleText}
            />

            <Text style={styles.label}>Date</Text>
            <View style={[styles.input, styles.readonly]}>
              <Text style={styles.readonlyText}>{formatLongDate(today)}</Text>
            </View>

            <Text style={styles.sigHeading}>Authorized Signature</Text>
            <Text style={styles.sigSub}>Sign below to adopt this Accountable Plan</Text>
            <SignaturePad
              onConfirm={onConfirm}
              confirming={generating}
              confirmLabel="Adopt & generate"
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: '94%',
    paddingTop: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerTitle: {
    ...typography.h2,
    color: colors.bodyText,
    fontSize: 17,
    fontWeight: '700',
  },
  scroll: { flexGrow: 0 },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  docCard: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    ...shadow.card,
  },
  docTitle: {
    ...typography.h2,
    color: colors.navy,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  docSub: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 2,
  },
  docBlurb: {
    ...typography.body,
    color: colors.bodyText,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.md,
  },
  label: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
    marginTop: spacing.lg,
  },
  input: {
    backgroundColor: colors.white,
    borderWidth: 0.5,
    borderColor: colors.cardBorder,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    ...typography.body,
    color: colors.bodyText,
    fontSize: 14,
  },
  readonly: {
    backgroundColor: '#F2F4F6',
    justifyContent: 'center',
  },
  readonlyText: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 14,
    fontWeight: '600',
  },
  sigHeading: {
    ...typography.h3,
    color: colors.bodyText,
    fontSize: 15,
    fontWeight: '700',
    marginTop: spacing.xl,
  },
  sigSub: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    marginBottom: spacing.md,
    marginTop: 2,
  },
});
