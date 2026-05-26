import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import SignatureCanvas, { type SignatureViewRef } from 'react-native-signature-canvas';
import { colors, radius, spacing, typography } from '../theme';
import { useAuth } from '../auth/AuthContext';
import type { RootStackParamList } from '../navigation/types';
import {
  downloadAllDocuments,
  fetchUserDocuments,
  type DocumentSnapshot,
} from '../services/cancellation';

const DANGER_RED = '#C0392B';
const DANGER_RED_BG = '#FDECEA';

export const CancelWarning1Screen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { session } = useAuth();
  const userId = session?.user.id;

  const sigRef = useRef<SignatureViewRef>(null);
  const [docs, setDocs] = useState<DocumentSnapshot[] | null>(null);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    fetchUserDocuments(userId)
      .then((d) => {
        if (active) setDocs(d);
      })
      .catch((err) => {
        if (active) {
          setDocs([]);
          Alert.alert('Could not load documents', err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (active) setLoadingDocs(false);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const handleDownloadAll = useCallback(async () => {
    if (!docs || docs.length === 0) {
      Alert.alert('Nothing to download', 'You have no documents stored.');
      return;
    }
    setDownloading(true);
    try {
      const result = await downloadAllDocuments(docs);
      Alert.alert(
        'Download complete',
        `${result.downloaded} document${result.downloaded === 1 ? '' : 's'} downloaded.` +
          (result.skipped > 0 ? ` ${result.skipped} skipped.` : ''),
      );
    } catch (err) {
      Alert.alert('Download failed', err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  }, [docs]);

  const handleClearSignature = () => {
    sigRef.current?.clearSignature();
    setHasSignature(false);
    setSignatureData(null);
  };

  // SignatureCanvas fires onOK when the user lifts their finger; we use it to
  // mark "drawn" and stash the base64 PNG for the next screen.
  const handleSignatureOK = (sig: string) => {
    setSignatureData(sig);
    setHasSignature(true);
  };

  const handleSignatureEmpty = () => {
    setHasSignature(false);
    setSignatureData(null);
  };

  const handleSignatureBegin = () => {
    // Trigger a read once the user finishes a stroke.
    setHasSignature(true);
  };

  const handleSignatureEnd = () => {
    sigRef.current?.readSignature();
  };

  const handleContinue = () => {
    if (!signatureData) {
      sigRef.current?.readSignature();
      return;
    }
    navigation.navigate('CancelWarning2', {
      signature1: signatureData,
      documentCount: docs?.length ?? 0,
    });
  };

  const documentCount = docs?.length ?? 0;

  const webStyle = useMemo(
    () => `
      .m-signature-pad { box-shadow: none; border: none; margin: 0; }
      .m-signature-pad--body { border: none; }
      .m-signature-pad--footer { display: none; }
      body, html { background-color: ${colors.white}; }
    `,
    [],
  );

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.headerBlock}>
        <Ionicons name="warning" size={28} color={DANGER_RED} />
        <Text style={styles.header}>Important — Read Before Cancelling</Text>
      </View>

      <View style={styles.warningCard}>
        <Text style={styles.warningBody}>
          When you cancel your subscription your compliance documents will be permanently deleted{' '}
          <Text style={styles.warningBold}>30 days after cancellation</Text>. After that date there
          is no way to recover them. Download all documents before cancelling.
        </Text>
      </View>

      <View style={styles.countCard}>
        {loadingDocs ? (
          <ActivityIndicator color={colors.midNavy} />
        ) : (
          <>
            <Ionicons name="document-text-outline" size={22} color={colors.midNavy} />
            <Text style={styles.countText}>
              You currently have{' '}
              <Text style={styles.countNumber}>{documentCount}</Text>{' '}
              document{documentCount === 1 ? '' : 's'} stored
            </Text>
          </>
        )}
      </View>

      <TouchableOpacity
        style={[styles.downloadBtn, (downloading || loadingDocs || documentCount === 0) && styles.btnDisabled]}
        onPress={handleDownloadAll}
        disabled={downloading || loadingDocs || documentCount === 0}
        activeOpacity={0.85}
      >
        {downloading ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <>
            <Ionicons name="download-outline" size={18} color={colors.white} />
            <Text style={styles.downloadText}>Download All Documents</Text>
          </>
        )}
      </TouchableOpacity>

      <Text style={styles.sigLabel}>
        Sign here to confirm you have read and understand the above warning
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
        style={[styles.continueBtn, !hasSignature && styles.btnDisabled]}
        onPress={handleContinue}
        disabled={!hasSignature}
        activeOpacity={0.85}
      >
        <Text style={styles.continueText}>Continue to Confirmation</Text>
        <Ionicons name="arrow-forward" size={18} color={colors.white} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.keepBtn}
        onPress={() => navigation.goBack()}
        activeOpacity={0.85}
      >
        <Text style={styles.keepText}>Keep My Subscription</Text>
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
  warningCard: {
    backgroundColor: DANGER_RED_BG,
    borderRadius: radius.card,
    padding: spacing.lg,
    borderLeftWidth: 4,
    borderLeftColor: DANGER_RED,
  },
  warningBody: {
    ...typography.body,
    color: colors.bodyText,
    lineHeight: 20,
  },
  warningBold: {
    fontWeight: '700',
    color: DANGER_RED,
  },
  countCard: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  countText: {
    ...typography.body,
    color: colors.bodyText,
    flex: 1,
  },
  countNumber: {
    ...typography.h2,
    color: colors.navy,
  },
  downloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.midNavy,
    borderRadius: 8,
    paddingVertical: 14,
  },
  downloadText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
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
  continueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: DANGER_RED,
    borderRadius: 8,
    paddingVertical: 14,
  },
  continueText: {
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
