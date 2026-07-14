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
import { colors, radius, spacing } from '../theme';
import { useAuth } from '../auth/AuthContext';
import type { RootStackParamList } from '../navigation/types';
import {
  downloadAllDocuments,
  fetchUserDocuments,
  type DocumentSnapshot,
} from '../services/cancellation';

// Spec colors for the cancellation flow.
const RED = '#A32D2D';
const RED_BG = '#FCEBEB';

export const CancelWarning1Screen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { session } = useAuth();
  const userId = session?.user.id;

  const sigRef = useRef<SignatureViewRef>(null);
  const [docs, setDocs] = useState<DocumentSnapshot[] | null>(null);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloadLabel, setDownloadLabel] = useState<string | null>(null);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [hasDrawn, setHasDrawn] = useState(false);
  // Locked while the user draws so vertical strokes draw instead of scroll.
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [strokeEnded, setStrokeEnded] = useState(false);

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

  const documentCount = docs?.length ?? 0;

  const handleDownloadAll = useCallback(async () => {
    if (!docs || docs.length === 0) {
      Alert.alert('Nothing to download', 'You have no documents stored.');
      return;
    }
    setDownloading(true);
    try {
      const result = await downloadAllDocuments(docs, (current, total) => {
        setDownloadLabel(`Downloading document ${current} of ${total}…`);
      });
      Alert.alert(
        'Download complete',
        `${result.downloaded} document${result.downloaded === 1 ? '' : 's'} downloaded.` +
          (result.skipped > 0 ? ` ${result.skipped} skipped.` : ''),
      );
    } catch (err) {
      Alert.alert('Download failed', err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
      setDownloadLabel(null);
    }
  }, [docs]);

  // SignatureCanvas fires onOK when we call readSignature(); we stash the base64
  // PNG to hand to Screen 2 and to enable the Continue button.
  const handleSignatureOK = (sig: string) => setSignatureData(sig);
  const handleSignatureEmpty = () => {
    setSignatureData(null);
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
    setSignatureData(null);
    setHasDrawn(false);
    setStrokeEnded(false);
    setScrollEnabled(true);
  };

  const handleConfirmSignature = () => {
    if (hasDrawn) sigRef.current?.readSignature();
  };

  const handleContinue = () => {
    if (!signatureData) return;
    navigation.navigate('CancelWarning2', {
      signature1: signatureData,
      documentCount,
    });
  };

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
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      scrollEnabled={scrollEnabled}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Important — Read Before Cancelling</Text>

      <View style={styles.warningCard}>
        <Text style={styles.warningBody}>
          When you cancel your subscription, all of your compliance documents will be permanently
          deleted 30 days after cancellation. After that date there is no way to recover them.
          Download all documents before cancelling.
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

      <View>
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
              <Text style={styles.downloadText}>Download All My Documents</Text>
            </>
          )}
        </TouchableOpacity>
        {downloading && downloadLabel ? (
          <Text style={styles.progressText}>{downloadLabel}</Text>
        ) : null}
      </View>

      <Text style={styles.sigLabel}>
        Sign below to confirm you have read and understand the above warning
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
          <TouchableOpacity onPress={handleClearSignature} style={styles.clearBtn} activeOpacity={0.8}>
            <Ionicons name="refresh" size={14} color={colors.navy} />
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleConfirmSignature}
            style={[styles.sigConfirmBtn, !hasDrawn && styles.btnDisabled]}
            disabled={!hasDrawn}
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

      <TouchableOpacity
        style={[styles.continueBtn, !signatureData && styles.btnDisabled]}
        onPress={handleContinue}
        disabled={!signatureData}
        activeOpacity={0.85}
      >
        <Text style={styles.continueText}>Continue to Final Confirmation</Text>
        <Ionicons name="arrow-forward" size={18} color={colors.white} />
      </TouchableOpacity>
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
  warningCard: {
    backgroundColor: RED_BG,
    borderRadius: radius.card,
    padding: 16,
    borderWidth: 1,
    borderColor: RED,
  },
  warningBody: {
    fontSize: 15,
    color: colors.bodyText,
    lineHeight: 21,
  },
  countCard: {
    backgroundColor: colors.lightBlue,
    borderRadius: radius.card,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  countText: {
    fontSize: 15,
    color: colors.bodyText,
    flex: 1,
  },
  countNumber: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.navy,
  },
  downloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.navy,
    borderRadius: 8,
    paddingVertical: 14,
  },
  downloadText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  progressText: {
    marginTop: spacing.sm,
    fontSize: 13,
    color: colors.mutedText,
    textAlign: 'center',
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
  continueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: RED,
    borderRadius: 8,
    paddingVertical: 14,
  },
  continueText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.4,
  },
});
