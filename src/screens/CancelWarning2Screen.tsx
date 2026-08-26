import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import SignatureCanvas, { type SignatureViewRef } from 'react-native-signature-canvas';
import { colors, radius, spacing } from '../theme';
import {
  completeCancellation,
  deletionDateFromNow,
  formatDeletionDate,
} from '../services/cancellation';
import type { RootStackParamList } from '../navigation/types';

// Spec colors for the cancellation flow.
const RED = '#A32D2D';
const RED_BG = '#FCEBEB';

export const CancelWarning2Screen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'CancelWarning2'>>();
  const { signature1, documentCount } = route.params;

  const sigRef = useRef<SignatureViewRef>(null);
  const [signature2, setSignature2] = useState<string | null>(null);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Locked while the user draws so vertical strokes draw instead of scroll.
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [strokeEnded, setStrokeEnded] = useState(false);

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

  const handleSignatureOK = (sig: string) => setSignature2(sig);
  const handleSignatureEmpty = () => {
    setSignature2(null);
    setHasDrawn(false);
  };
  // onBegin fires on touch — lock scrolling immediately. onEnd fires on lift —
  // re-enable scrolling and read the captured signature.
  const handleSignatureBegin = () => {
    setHasDrawn(true);
    setScrollEnabled(false);
  };
  const handleSignatureEnd = () => {
    setScrollEnabled(true);
    setStrokeEnded(true);
    sigRef.current?.readSignature();
  };

  const handleClearSignature = () => {
    sigRef.current?.clearSignature();
    setSignature2(null);
    setHasDrawn(false);
    setStrokeEnded(false);
    setScrollEnabled(true);
  };

  const handleConfirmSignature = () => {
    if (hasDrawn) sigRef.current?.readSignature();
  };

  const handleGoBack = () => {
    if (submitting) return;
    // Back to Settings without cancelling anything.
    navigation.navigate('Settings');
  };

  const handleCancelSubscription = useCallback(async () => {
    if (!signature2 || submitting) return;
    setSubmitting(true);
    try {
      const result = await completeCancellation({
        signature1DataUrl: signature1,
        signature2DataUrl: signature2,
        documentCount,
      });
      // No refreshProfile() here on purpose: cancelling no longer changes the
      // tier. Apple and Google keep a subscription usable until the paid period
      // ends, and the RevenueCat webhook writes the tier when it actually ends.
      navigation.replace('CancelSuccess', {
        deletionDate: formatDeletionDate(new Date(result.deletionScheduledFor)),
        emailSent: result.emailSent,
        manageOpened: result.manageOpened,
        stillRenewing: result.stillRenewing,
      });
    } catch (err) {
      Alert.alert('Cancellation failed', err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }, [documentCount, navigation, signature1, signature2, submitting]);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      scrollEnabled={scrollEnabled}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Final Confirmation Required</Text>

      <View style={styles.dateCard}>
        <Text style={styles.dateLabel}>Your documents will be permanently deleted on</Text>
        <Text style={styles.dateValue}>{formattedDate}</Text>
      </View>

      <Text style={styles.warningBody}>
        This action cannot be undone. There are no exceptions to this policy regardless of
        circumstances.
      </Text>

      <Text style={styles.sigLabel}>
        Sign below to confirm you accept permanent and irrecoverable deletion of all your compliance
        documents
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
            penColor={colors.navy}
            autoClear={false}
            imageType="image/png"
          />
        </View>
        <View style={styles.sigActions}>
          <TouchableOpacity
            onPress={handleClearSignature}
            style={styles.clearBtn}
            activeOpacity={0.8}
            disabled={submitting}
          >
            <Ionicons name="refresh" size={14} color={colors.navy} />
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleConfirmSignature}
            style={[styles.sigConfirmBtn, (!hasDrawn || submitting) && styles.btnDisabled]}
            disabled={!hasDrawn || submitting}
            activeOpacity={0.85}
          >
            <Text style={styles.sigConfirmText}>Confirm Signature</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View>
        <Text style={styles.sigHintMain}>Draw your signature above</Text>
        <Text style={styles.sigHintSub}>
          {strokeEnded ? 'Scroll to continue' : 'Scrolling is paused while you sign'}
        </Text>
      </View>

      {submitting ? (
        <View style={styles.processingRow}>
          <ActivityIndicator color={colors.navy} />
          <Text style={styles.processingText}>Processing…</Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={[styles.goBackBtn, submitting && styles.btnDisabled]}
        onPress={handleGoBack}
        activeOpacity={0.85}
        disabled={submitting}
      >
        <Text style={styles.goBackText}>Go Back — Keep My Subscription</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.cancelBtn, (!signature2 || submitting) && styles.btnDisabled]}
        onPress={handleCancelSubscription}
        disabled={!signature2 || submitting}
        activeOpacity={0.85}
      >
        {submitting ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <>
            <Ionicons name="open-outline" size={18} color={colors.white} />
            <Text style={styles.cancelText}>Continue to Cancel</Text>
          </>
        )}
      </TouchableOpacity>

      <Text style={styles.handoffNote}>
        We'll record your request, then take you to the{' '}
        {Platform.OS === 'ios' ? 'App Store' : 'Play Store'} to finish cancelling — only the store
        can stop your billing. Your plan stays active until the period you've paid for ends.
      </Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.white,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: RED,
    textAlign: 'center',
  },
  dateCard: {
    backgroundColor: RED_BG,
    borderRadius: radius.card,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: RED,
    alignItems: 'center',
    gap: spacing.sm,
  },
  dateLabel: {
    fontSize: 14,
    color: colors.bodyText,
    textAlign: 'center',
  },
  dateValue: {
    fontSize: 22,
    fontWeight: '700',
    color: RED,
    textAlign: 'center',
  },
  warningBody: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.bodyText,
    lineHeight: 21,
  },
  sigLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.bodyText,
  },
  sigCard: {
    backgroundColor: colors.white,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.navy,
    overflow: 'hidden',
  },
  sigCanvasWrap: {
    height: 200,
    backgroundColor: colors.white,
  },
  sigActions: {
    flexDirection: 'row',
    borderTopWidth: 1.5,
    borderTopColor: colors.navy,
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    flex: 1,
    borderRightWidth: 1.5,
    borderRightColor: colors.navy,
  },
  clearText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.navy,
  },
  sigConfirmBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    flex: 1.6,
    backgroundColor: colors.navy,
  },
  sigConfirmText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.white,
  },
  sigHintMain: {
    fontSize: 11,
    fontStyle: 'italic',
    color: '#888888',
    textAlign: 'center',
  },
  sigHintSub: {
    fontSize: 11,
    fontStyle: 'italic',
    color: '#888888',
    textAlign: 'center',
    marginTop: 2,
  },
  processingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  processingText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.navy,
  },
  goBackBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.navy,
    backgroundColor: colors.white,
  },
  goBackText: {
    color: colors.navy,
    fontSize: 15,
    fontWeight: '700',
  },
  cancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: RED,
    borderRadius: 8,
    paddingVertical: 14,
  },
  cancelText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  handoffNote: {
    color: colors.mutedText,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  btnDisabled: {
    opacity: 0.4,
  },
});
