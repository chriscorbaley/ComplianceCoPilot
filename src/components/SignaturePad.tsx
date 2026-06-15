// Reusable finger-signature capture block built on react-native-signature-canvas.
// White canvas, navy #042C53 border, a Clear button to redo, and a navy Confirm
// button. On Confirm it returns the signature as a base64 PNG data URL
// ("data:image/png;base64,...").
//
// The built-in footer is hidden via webStyle so we can present our own buttons
// that match the app's button styling.

import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import SignatureScreen, {
  type SignatureViewRef,
} from 'react-native-signature-canvas';
import { colors, spacing } from '../theme';

interface SignaturePadProps {
  // Fired with the base64 PNG data URL when the user taps Confirm.
  onConfirm: (signatureDataUrl: string) => void;
  // Shows a spinner + disables the buttons while the parent saves.
  confirming?: boolean;
  // Confirm button label (default "Confirm signature").
  confirmLabel?: string;
}

// Hide the library's own footer/border; we draw our own controls below.
const WEB_STYLE = `
  .m-signature-pad { box-shadow: none; border: none; margin: 0; }
  .m-signature-pad--body { border: none; }
  .m-signature-pad--footer { display: none; margin: 0; }
  body, html { width: 100%; height: 100%; margin: 0; padding: 0; background: #FFFFFF; }
`;

export const SignaturePad: React.FC<SignaturePadProps> = ({
  onConfirm,
  confirming,
  confirmLabel,
}) => {
  const ref = useRef<SignatureViewRef>(null);
  const [hasDrawn, setHasDrawn] = useState(false);

  const handleOK = (signature: string) => {
    // signature is already a data URL: "data:image/png;base64,...."
    onConfirm(signature);
  };

  const handleClear = () => {
    ref.current?.clearSignature();
    setHasDrawn(false);
  };

  const handleConfirm = () => {
    if (!hasDrawn || confirming) return;
    // Triggers onOK with the captured PNG.
    ref.current?.readSignature();
  };

  return (
    <View>
      <View style={styles.canvasWrap}>
        <SignatureScreen
          ref={ref}
          onOK={handleOK}
          onBegin={() => setHasDrawn(true)}
          onEmpty={() => setHasDrawn(false)}
          webStyle={WEB_STYLE}
          backgroundColor="#FFFFFF"
          penColor="#042C53"
          imageType="image/png"
          autoClear={false}
        />
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handleClear}
          disabled={confirming}
          style={styles.clearBtn}
        >
          <Text style={styles.clearText}>Clear</Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleConfirm}
          disabled={!hasDrawn || confirming}
          style={[
            styles.confirmBtn,
            (!hasDrawn || confirming) && styles.confirmBtnDim,
          ]}
        >
          {confirming ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={styles.confirmText}>
              {confirmLabel ?? 'Confirm signature'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  canvasWrap: {
    height: 200,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.navy,
    borderRadius: 10,
    overflow: 'hidden',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  clearBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.navy,
  },
  clearText: {
    color: colors.navy,
    fontWeight: '700',
    fontSize: 14,
  },
  confirmBtn: {
    flex: 1.6,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: 10,
    backgroundColor: colors.navy,
  },
  confirmBtnDim: { opacity: 0.5 },
  confirmText: {
    color: colors.white,
    fontWeight: '700',
    fontSize: 14,
  },
});
