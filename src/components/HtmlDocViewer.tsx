// Full-screen viewer for generated HTML documents (signed plans/resolutions/
// leases and invoices). Renders the stored HTML in a WebView with the brand
// logo hydrated in, a Share action that re-exports the PDF, and — for invoices —
// a "Mark as Paid" toggle that regenerates the document with the PAID watermark.

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { colors, spacing, typography } from '../theme';
import { DatePickerModal } from './DateInputField';
import { hydrateLogo, shareHtmlAsPdf } from '../services/pdfDocuments';
import { setInvoicePaid } from '../services/augustaDocuments';

interface Props {
  visible: boolean;
  name: string;
  html: string; // stored (un-hydrated) HTML
  docId: string;
  isInvoice: boolean;
  initialPaid?: boolean;
  onClose: () => void;
  // Called after the paid status changes so the list can refresh.
  onChanged?: (newHtml: string, paid: boolean) => void;
}

const toIso = (d: Date): string => {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
};

export const HtmlDocViewer: React.FC<Props> = ({
  visible,
  name,
  html,
  docId,
  isInvoice,
  initialPaid,
  onClose,
  onChanged,
}) => {
  const insets = useSafeAreaInsets();
  const [currentHtml, setCurrentHtml] = useState(html);
  const [rendered, setRendered] = useState<string | null>(null);
  const [paid, setPaid] = useState(Boolean(initialPaid));
  const [busy, setBusy] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  useEffect(() => {
    if (visible) {
      setCurrentHtml(html);
      setPaid(Boolean(initialPaid));
    }
  }, [visible, html, initialPaid]);

  // Hydrate the brand logo into the HTML before injecting into the WebView.
  useEffect(() => {
    let active = true;
    if (visible) {
      hydrateLogo(currentHtml).then((h) => {
        if (active) setRendered(h);
      });
    } else {
      setRendered(null);
    }
    return () => {
      active = false;
    };
  }, [visible, currentHtml]);

  const onShare = async () => {
    try {
      await shareHtmlAsPdf(currentHtml, name);
    } catch (e) {
      Alert.alert('Could not share', e instanceof Error ? e.message : String(e));
    }
  };

  const applyPaid = async (nextPaid: boolean, paidDate: string | null) => {
    setBusy(true);
    try {
      const newHtml = await setInvoicePaid(docId, nextPaid, paidDate);
      setCurrentHtml(newHtml);
      setPaid(nextPaid);
      onChanged?.(newHtml, nextPaid);
      if (nextPaid) {
        Alert.alert('Invoice marked as paid — document updated');
      }
    } catch (e) {
      Alert.alert('Could not update invoice', e instanceof Error ? e.message : String(e));
      setPaid(!nextPaid); // revert the switch
    } finally {
      setBusy(false);
    }
  };

  const onTogglePaid = (next: boolean) => {
    if (busy) return;
    setPaid(next); // optimistic
    if (next) {
      setDatePickerOpen(true);
    } else {
      applyPaid(false, null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <Ionicons name="chevron-back" size={24} color={colors.navy} />
          </TouchableOpacity>
          <Text style={styles.title} numberOfLines={1}>
            {name}
          </Text>
          <TouchableOpacity onPress={onShare} hitSlop={10}>
            <Ionicons name="share-outline" size={22} color={colors.navy} />
          </TouchableOpacity>
        </View>

        {rendered ? (
          <WebView
            originWhitelist={['*']}
            source={{ html: rendered }}
            style={styles.web}
          />
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={colors.midNavy} />
          </View>
        )}

        {isInvoice ? (
          <View style={[styles.paidBar, { paddingBottom: spacing.md + insets.bottom }]}>
            <View style={styles.paidText}>
              <Text style={styles.paidTitle}>Mark Invoice as Paid</Text>
              <Text style={styles.paidSub}>
                {paid ? 'Invoice shows a PAID watermark' : 'Toggle when payment is received'}
              </Text>
            </View>
            {busy ? (
              <ActivityIndicator size="small" color={colors.teal} />
            ) : (
              <Switch
                value={paid}
                onValueChange={onTogglePaid}
                trackColor={{ false: '#CCCCCC', true: colors.teal }}
                thumbColor={colors.white}
              />
            )}
          </View>
        ) : null}
      </View>

      <DatePickerModal
        visible={datePickerOpen}
        title="Date payment received"
        value={new Date()}
        onCancel={() => {
          setDatePickerOpen(false);
          setPaid(false); // user backed out of marking paid
        }}
        onConfirm={(d) => {
          setDatePickerOpen(false);
          applyPaid(true, toIso(d));
        }}
      />
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    backgroundColor: colors.white,
  },
  title: {
    flex: 1,
    ...typography.h3,
    color: colors.bodyText,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  web: { flex: 1, backgroundColor: colors.white },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  paidBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  paidText: { flex: 1, paddingRight: spacing.md },
  paidTitle: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    fontSize: 14,
    fontWeight: '700',
  },
  paidSub: {
    ...typography.body,
    color: colors.mutedText,
    fontSize: 12,
    marginTop: 2,
  },
});
