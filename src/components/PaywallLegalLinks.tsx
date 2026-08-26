// Terms of Service · Privacy Policy links for a purchase screen.
//
// Apple's Paid Applications Agreement §3.8(b) requires both documents to be
// reachable from within the screen that sells the subscription, so every paywall
// surface renders this. Owns its own modal state — a caller just drops it in.
//
// `tone` picks link colours for a navy background ('light') or a white/grey one
// ('dark').

import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../theme';
import type { LegalDocumentType } from '../services/supabase';
import { LegalDocModal } from './LegalDocModal';

interface PaywallLegalLinksProps {
  tone?: 'light' | 'dark';
}

export const PaywallLegalLinks: React.FC<PaywallLegalLinksProps> = ({ tone = 'light' }) => {
  const [docType, setDocType] = useState<LegalDocumentType | null>(null);
  const linkStyle = tone === 'light' ? styles.linkLight : styles.linkDark;
  const dotStyle = tone === 'light' ? styles.dotLight : styles.dotDark;

  return (
    <>
      <View style={styles.row}>
        <TouchableOpacity activeOpacity={0.7} onPress={() => setDocType('tos')}>
          <Text style={[styles.link, linkStyle]}>Terms of Service</Text>
        </TouchableOpacity>
        <Text style={[styles.dot, dotStyle]}>·</Text>
        <TouchableOpacity activeOpacity={0.7} onPress={() => setDocType('privacy')}>
          <Text style={[styles.link, linkStyle]}>Privacy Policy</Text>
        </TouchableOpacity>
      </View>
      <LegalDocModal docType={docType} onClose={() => setDocType(null)} />
    </>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
  },
  link: {
    fontSize: 12,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  linkLight: {
    color: colors.white,
  },
  linkDark: {
    color: '#185FA5',
  },
  dot: {
    fontSize: 12,
  },
  dotLight: {
    color: '#85B7EB',
  },
  dotDark: {
    color: colors.subtleText,
  },
});
