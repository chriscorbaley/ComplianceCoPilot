import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CommonActions, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import SignatureCanvas, { type SignatureViewRef } from 'react-native-signature-canvas';
import { colors, radius, spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import {
  completeCancellation,
  deletionDateFromNow,
  formatDeletionDate,
} from '../services/cancellation';
import { useAuth } from '../auth/AuthContext';

const DANGER_RED = '#C0392B';
const DANGER_RED_BG = '#FDECEA';

export const CancelWarning2Screen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'CancelWarning2'>>();
  const { signature1, documentCount } = route.params;
  const { signOut } = useAuth();

  const sigRef = useRef<SignatureViewRef>(null);
  const [hasSignature, setHasSignature] = useState(false);
  const [signature2, setSignature2] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Captured once on mount so the displayed date stays stable across re-renders.
  const deletionDate = useMemo(() => deletionDateFromNow(), []);
  const formattedDate = useMemo(() => formatDeletionDate(deletionDate), [deletionDate]);

  const webStyle = useMemo(
    () => `
      .m-signature-pad { box-shadow: none; border: none; margin: 0; }
      .m-signature-pad--body { border: none; }
      .m-signature-pad--footer { display: none; }
      body, html { background-color: ${colors.white}; }
    `,
    [],
  );

  const handleSignatureOK = (sig: string) => {
    setSignature2(sig);
    setHasSignature(true);
  };

  const handleSignatureEmpty = () => {
    setHasSignature(false);
    setSignature2(null);
  };

  const handleSignatureBegin = () => {
    setHasSignature(true);
  };

  const handleSignatureEnd = () => {
    sigRef.current?.readSignature();
  };

  const handleClearSignature = () => {
    sigRef.current?.clearSignature();
    setHasSignature(false);
    setSignature2(null);
  };

  const handleCancelSubscription = useCallback(async () => {
    if (!signature2) {
      sigRef.current?.readSignature();
      return;
    }
    setSubmitting(true);
    try {
      const result = await completeCancellation({
        signature1DataUrl: signature1,
        signature2DataUrl: signature2,
        documentCount,
      });

      const messageLines = [
        `Your subscription has been cancelled.`,
        `All documents will be permanently deleted on ${formatDeletionDate(new Date(result.deletionScheduledFor))}.`,
      ];
      if (!result.stripeCancelled) {
        messageLines.push('Note: Stripe cancellation could not be confirmed — our team will follow up.');
      }
      if (!result.emailSent) {
        messageLines.push('Note: confirmation email could not be sent — please contact support if you don\'t receive it.');
      }

      Alert.alert('Subscription Cancelled', messageLines.join('\n\n'), [
        {
          text: 'OK',
          onPress: async () => {
            try {
              await signOut();
            } catch {
              // ignore; user will land on auth screen anyway via state change
            }
            navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Tabs' }] }));
          },
        },
      ]);
    } catch (err) {
      Alert.alert('Cancellation failed', err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [documentCount, navigation, signature1, signature2, signOut]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.headerBlock}>
        <Ionicons name="alert-circle" size={28} color={DANGER_RED} />
        <Text style={styles.header}>Final Confirmation</Text>
      </View>

      <View style={styles.dateCard}>
        <Text style={styles.dateLabel}>Your documents will be permanently deleted on</Text>
        <Text style={styles.dateValue}>{formattedDate}</Text>
      </View>

      <View style={styles.warningCard}>
        <Text style={styles.warningBody}>
          This action cannot be undone. There are no exceptions to this policy.
        </Text>
      </View>

      <Text style={styles.sigLabel}>
        Sign here to confirm you accept permanent deletion of all your compliance documents
      </Text>

      <View style={styles.sigCard}>
        <View style={styles.sigCanvasWrap}>
          <SignatureCanvas
            ref={sigRef}
            onOK={handleSignatureOK}
            onEmpty={handleSignatureEmpty}
            onBegin={handleSignatureBegin}
            onEnd={handleSignatureEnd}
            descriptionText=""
            webStyle={webStyle}
            backgroundColor={colors.white}
            penColor={colors.bodyText}
            autoClear={false}
            imageType="image/png"
          />
        </View>
        <TouchableOpacity onPress={handleClearSignature} style={styles.clearBtn}>
          <Ionicons name="refresh" size={14} color={colors.mutedText} />
          <Text style={styles.clearText}>Clear</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.cancelBtn, (!hasSignature || submitting) && styles.btnDisabled]}
        onPress={handleCancelSubscription}
        disabled={!hasSignature || submitting}
        activeOpacity={0.85}
      >
        {submitting ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <>
            <Ionicons name="close-circle" size={18} color={colors.white} />
            <Text style={styles.cancelText}>Cancel Subscription</Text>
          </>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.keepBtn}
        onPress={() => navigation.goBack()}
        activeOpacity={0.85}
        disabled={submitting}
      >
        <Text style={styles.keepText}>Go Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  headerBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  header: {
    ...typography.h1,
    color: DANGER_RED,
    flex: 1,
  },
  dateCard: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: DANGER_RED,
    alignItems: 'center',
    gap: spacing.xs,
  },
  dateLabel: {
    ...typography.caption,
    color: colors.mutedText,
    textAlign: 'center',
  },
  dateValue: {
    ...typography.h1,
    color: DANGER_RED,
    textAlign: 'center',
  },
  warningCard: {
    backgroundColor: DANGER_RED_BG,
    borderRadius: radius.card,
    padding: spacing.lg,
    borderLeftWidth: 4,
    borderLeftColor: DANGER_RED,
  },
  warningBody: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    lineHeight: 20,
  },
  sigLabel: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    marginTop: spacing.sm,
  },
  sigCard: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
    overflow: 'hidden',
  },
  sigCanvasWrap: {
    height: 200,
    backgroundColor: colors.white,
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  clearText: {
    ...typography.caption,
    color: colors.mutedText,
  },
  cancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: DANGER_RED,
    borderRadius: 8,
    paddingVertical: 14,
  },
  cancelText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  keepBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  keepText: {
    ...typography.bodyMedium,
    color: colors.midNavy,
    fontWeight: '600',
  },
  btnDisabled: {
    opacity: 0.4,
  },
});
