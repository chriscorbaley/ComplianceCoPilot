// Read-only viewer for a legal document (Terms of Service / Privacy Policy).
//
// The onboarding TermsScreen / PrivacyScreen are ACCEPTANCE screens — they own a
// checkbox and advance the flow. This is the plain "let me read it" surface, so
// any screen that must expose the documents without asking for acceptance again
// (e.g. the paywall, per Apple's Paid Applications Agreement §3.8(b)) can render
// it as a modal.
//
// Text comes from fetchActiveLegalDoc(), which already falls back to the shipped
// copy on any read failure — so this never renders empty.

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import type { LegalDocumentType } from '../services/supabase';
import { fetchActiveLegalDoc, LEGAL_FALLBACK, type LegalDocContent } from '../services/legalDocuments';
import { contentContainerStyle } from '../constants/layout';

const TITLES: Record<LegalDocumentType, string> = {
  tos: 'Terms of Service',
  privacy: 'Privacy Policy',
};

interface LegalDocModalProps {
  // Which document to show, or null to keep the modal closed.
  docType: LegalDocumentType | null;
  onClose: () => void;
}

export const LegalDocModal: React.FC<LegalDocModalProps> = ({ docType, onClose }) => {
  const insets = useSafeAreaInsets();
  const [doc, setDoc] = useState<LegalDocContent | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!docType) return;
    let cancelled = false;
    setLoading(true);
    setDoc(null);
    fetchActiveLegalDoc(docType)
      .then((d) => {
        if (!cancelled) setDoc(d);
      })
      .catch(() => {
        // fetchActiveLegalDoc already falls back internally; this is belt-and-
        // braces so a rejected promise still shows the shipped text.
        if (!cancelled) setDoc(LEGAL_FALLBACK[docType]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [docType]);

  return (
    <Modal
      visible={docType !== null}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <View style={styles.headerText}>
            <Text style={styles.title}>{docType ? TITLES[docType] : ''}</Text>
            {doc?.effectiveDate ? (
              <Text style={styles.effectiveDate}>{doc.effectiveDate}</Text>
            ) : null}
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityRole="button">
            <Ionicons name="close" size={22} color={colors.white} />
          </TouchableOpacity>
        </View>

        {loading || !doc ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.midNavy} />
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
            showsVerticalScrollIndicator={false}
          >
            <View style={contentContainerStyle}>
              <Text style={styles.body}>{doc.content}</Text>
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.white,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 14,
    backgroundColor: colors.navy,
  },
  headerText: {
    flex: 1,
  },
  title: {
    color: colors.white,
    fontSize: 18,
    fontWeight: '700',
  },
  effectiveDate: {
    color: '#85B7EB',
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    color: colors.mutedText,
    fontSize: 13,
  },
  scroll: {
    padding: 20,
  },
  body: {
    color: colors.bodyText,
    fontSize: 13,
    lineHeight: 20,
  },
});
