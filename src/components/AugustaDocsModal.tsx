// Generates the Augusta Rule supporting documents (lease agreement + invoice)
// for a rental that was just logged. Collects the owner / tenant party details
// and two finger signatures, then creates both branded PDFs and saves them to
// the Documents vault + augusta_rentals.

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
import { generateAugustaDocuments } from '../services/augustaDocuments';
import { shareHtmlAsPdf } from '../services/pdfDocuments';

export interface AugustaDocsContext {
  businessId: string | null;
  businessEntityName: string;
  location: string;
  rentalDate: string; // 'YYYY-MM-DD'
  durationHours: number | null;
  rentalRate: number | null;
  meetingPurpose: string;
}

interface Props {
  visible: boolean;
  context: AugustaDocsContext | null;
  defaultOwnerName: string;
  onClose: () => void;
  onGenerated: () => void;
}

export const AugustaDocsModal: React.FC<Props> = ({
  visible,
  context,
  defaultOwnerName,
  onClose,
  onGenerated,
}) => {
  const [ownerName, setOwnerName] = useState(defaultOwnerName);
  const [entity, setEntity] = useState('');
  const [tenantRepName, setTenantRepName] = useState(defaultOwnerName);
  const [tenantRepTitle, setTenantRepTitle] = useState('Authorized Representative');
  const [ownerSig, setOwnerSig] = useState<string | null>(null);
  const [tenantSig, setTenantSig] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  // Live step label shown on the button while the two PDFs are built in
  // sequence ("Generating lease agreement…" → "Generating invoice…").
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    if (visible && context) {
      setOwnerName(defaultOwnerName);
      setEntity(context.businessEntityName);
      setTenantRepName(defaultOwnerName);
      setTenantRepTitle('Authorized Representative');
      setOwnerSig(null);
      setTenantSig(null);
      setGenerating(false);
      setProgress(null);
    }
  }, [visible, context, defaultOwnerName]);

  const onGenerate = async () => {
    if (!context || generating) return;
    if (!ownerName.trim()) {
      Alert.alert('Owner name required', 'Enter the property owner name before generating.');
      return;
    }
    if (!ownerSig) {
      Alert.alert('Owner signature required', 'Capture the property owner signature first.');
      return;
    }
    setGenerating(true);
    setProgress('Generating lease agreement…');
    try {
      // Both PDFs are generated + saved in sequence; onProgress drives the
      // "Generating lease agreement…" → "Generating invoice…" button label.
      const result = await generateAugustaDocuments(
        {
          businessId: context.businessId,
          ownerName: ownerName.trim(),
          businessEntityName: entity.trim(),
          location: context.location,
          rentalDate: context.rentalDate,
          durationHours: context.durationHours,
          rentalRate: context.rentalRate,
          meetingPurpose: context.meetingPurpose,
        },
        {
          ownerSignature: ownerSig,
          tenantSignature: tenantSig,
          tenantRepName: tenantRepName.trim(),
          tenantRepTitle: tenantRepTitle.trim() || 'Authorized Representative',
        },
        setProgress,
      );
      onGenerated();
      onClose();
      // Both documents are already saved; offer to share them with the
      // accountant. expo-sharing presents one file per sheet, so the lease sheet
      // opens first and the invoice sheet follows once it's dismissed.
      Alert.alert(
        'Documents saved',
        'Lease agreement and invoice saved to your Augusta documents.',
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Share both',
            onPress: async () => {
              try {
                await shareHtmlAsPdf(result.leaseHtml, 'Augusta Lease Agreement');
                await shareHtmlAsPdf(result.invoiceHtml, 'Augusta Invoice');
              } catch (e) {
                Alert.alert(
                  'Could not share documents',
                  e instanceof Error ? e.message : String(e),
                );
              }
            },
          },
        ],
      );
    } catch (e) {
      // The service throws step-specific messages (rental record, lease,
      // invoice, linking) so the user sees exactly what failed.
      Alert.alert('Could not generate documents', e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>Lease & Invoice</Text>
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
            <Text style={styles.blurb}>
              Generates a Short-Term Rental Agreement and an Invoice for this
              rental under IRC §280A(g), saved to your Augusta documents.
            </Text>

            <Text style={styles.label}>Property owner (full name)</Text>
            <TextInput
              style={styles.input}
              value={ownerName}
              onChangeText={setOwnerName}
              placeholder="Owner full name"
              placeholderTextColor={colors.subtleText}
            />

            <Text style={styles.label}>Business entity (tenant)</Text>
            <TextInput
              style={styles.input}
              value={entity}
              onChangeText={setEntity}
              placeholder="Business entity name"
              placeholderTextColor={colors.subtleText}
            />

            <Text style={styles.sectionLabel}>Property Owner Signature</Text>
            {ownerSig ? (
              <View style={styles.capturedRow}>
                <Ionicons name="checkmark-circle" size={20} color={colors.teal} />
                <Text style={styles.capturedText}>Owner signature captured</Text>
                <TouchableOpacity onPress={() => setOwnerSig(null)} hitSlop={8}>
                  <Text style={styles.redoLink}>Redo</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <SignaturePad onConfirm={setOwnerSig} confirmLabel="Save owner signature" />
            )}

            <Text style={styles.label}>Tenant representative name</Text>
            <TextInput
              style={styles.input}
              value={tenantRepName}
              onChangeText={setTenantRepName}
              placeholder="Representative name"
              placeholderTextColor={colors.subtleText}
            />
            <Text style={styles.label}>Tenant representative title</Text>
            <TextInput
              style={styles.input}
              value={tenantRepTitle}
              onChangeText={setTenantRepTitle}
              placeholder="Authorized Representative"
              placeholderTextColor={colors.subtleText}
            />

            <Text style={styles.sectionLabel}>Tenant Representative Signature</Text>
            {tenantSig ? (
              <View style={styles.capturedRow}>
                <Ionicons name="checkmark-circle" size={20} color={colors.teal} />
                <Text style={styles.capturedText}>Tenant signature captured</Text>
                <TouchableOpacity onPress={() => setTenantSig(null)} hitSlop={8}>
                  <Text style={styles.redoLink}>Redo</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <SignaturePad onConfirm={setTenantSig} confirmLabel="Save tenant signature" />
            )}

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={onGenerate}
              disabled={generating}
              style={[styles.generateBtn, generating && styles.generateBtnDim]}
            >
              <Ionicons name="documents-outline" size={18} color={colors.white} />
              <Text style={styles.generateBtnText}>
                {generating ? progress ?? 'Generating…' : 'Generate lease & invoice'}
              </Text>
            </TouchableOpacity>
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
  blurb: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: spacing.sm,
  },
  label: {
    ...typography.caption,
    color: colors.mutedText,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
    marginTop: spacing.md,
  },
  sectionLabel: {
    ...typography.h3,
    color: colors.navy,
    fontSize: 14,
    fontWeight: '700',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
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
  capturedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.tealLight,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  capturedText: {
    ...typography.bodyMedium,
    color: colors.teal,
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  redoLink: {
    color: colors.navy,
    fontSize: 13,
    fontWeight: '700',
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.navy,
    borderRadius: 10,
    paddingVertical: 15,
    marginTop: spacing.xl,
    ...shadow.raised,
  },
  generateBtnDim: { opacity: 0.7 },
  generateBtnText: {
    ...typography.bodyMedium,
    color: colors.white,
    fontWeight: '700',
    fontSize: 15,
  },
});
