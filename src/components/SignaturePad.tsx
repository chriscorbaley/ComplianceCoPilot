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
import { scaled } from '../constants/layout';

interface SignaturePadProps {
  // Fired with the base64 PNG data URL when the user taps Confirm.
  onConfirm: (signatureDataUrl: string) => void;
  // Shows a spinner + disables the buttons while the parent saves.
  confirming?: boolean;
  // Confirm button label (default "Confirm signature").
  confirmLabel?: string;
  // Fired the moment a stroke starts / ends so the parent can lock/unlock the
  // enclosing ScrollView (vertical strokes would otherwise scroll the page).
  onDrawStart?: () => void;
  onDrawEnd?: () => void;
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
  onDrawStart,
  onDrawEnd,
}) => {
  const ref = useRef<SignatureViewRef>(null);
  const [hasDrawn, setHasDrawn] = useState(false);
  // Flips to true once the user lifts their finger; drives the scroll hint.
  const [strokeEnded, setStrokeEnded] = useState(false);

  const handleOK = (signature: string) => {
    // signature is already a data URL: "data:image/png;base64,...."
    onConfirm(signature);
  };

  // onBegin fires the instant a finger touches the pad — lock scrolling now so
  // vertical strokes draw instead of scroll the form.
  const handleBegin = () => {
    setHasDrawn(true);
    onDrawStart?.();
  };

  // onEnd fires when the finger lifts — re-enable scrolling.
  const handleEnd = () => {
    setStrokeEnded(true);
    onDrawEnd?.();
  };

  const handleClear = () => {
    ref.current?.clearSignature();
    setHasDrawn(false);
    setStrokeEnded(false);
    onDrawEnd?.();
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
          onBegin={handleBegin}
          onEnd={handleEnd}
          onEmpty={() => setHasDrawn(false)}
          webStyle={WEB_STYLE}
          backgroundColor="#FFFFFF"
          penColor="#042C53"
          imageType="image/png"
          autoClear={false}
        />
      </View>

      <Text style={styles.hintMain}>Draw your signature above</Text>
      <Text style={styles.hintSub}>
        {strokeEnded ? 'Scroll to continue' : 'Scrolling is paused while you sign'}
      </Text>

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
  hintMain: {
    marginTop: spacing.sm,
    color: '#888888',
    fontStyle: 'italic',
    fontSize: 11,
    textAlign: 'center',
  },
  hintSub: {
    marginTop: 2,
    color: '#888888',
    fontStyle: 'italic',
    fontSize: 11,
    textAlign: 'center',
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
    paddingVertical: scaled(13),
    minHeight: scaled(44),
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
