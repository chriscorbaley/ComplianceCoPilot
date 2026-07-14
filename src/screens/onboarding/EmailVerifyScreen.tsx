import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme';
import { supabase } from '../../services/supabase';
import { useAuth } from '../../auth/AuthContext';
import type { OnboardingStackParamList } from '../../navigation/types';

const POLL_INTERVAL_MS = 3000;

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'EmailVerify'>;

export const EmailVerifyScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const { session, emailVerified } = useAuth();
  const [resending, setResending] = useState(false);
  const [checking, setChecking] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const email = session?.user.email ?? '';

  // Poll for verification — Supabase doesn't push email_confirmed_at to the
  // client, so we ask the server every 3s until the JWT reflects it.
  const checkVerified = useCallback(async () => {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session) return false;
    return Boolean(data.session.user.email_confirmed_at);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const advance = () => {
      if (cancelled) return;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      nav.replace('Terms');
    };

    // The context flag is already true (email confirmed) — skip immediately.
    if (emailVerified) {
      advance();
      return () => {
        cancelled = true;
      };
    }

    // A session existing this early means either the email is already
    // confirmed OR Supabase email confirmation is disabled (signUp returns a
    // session immediately). In both cases there's nothing to wait for, so we
    // skip the verification screen and go straight to Terms. Only when there
    // is no session yet do we fall back to polling for confirmation.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) {
        advance();
        return;
      }
      pollRef.current = setInterval(async () => {
        const ok = await checkVerified();
        if (ok) advance();
      }, POLL_INTERVAL_MS);
    });

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [emailVerified, nav, checkVerified]);

  const onResend = async () => {
    if (!email) return;
    setResending(true);
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email });
      if (error) throw error;
      Alert.alert('Verification email sent', `We sent another link to ${email}.`);
    } catch (err) {
      Alert.alert('Could not resend', err instanceof Error ? err.message : String(err));
    } finally {
      setResending(false);
    }
  };

  // Beta bypass: Supabase's free tier rate-limits verification emails to 3/hour,
  // so the link often never arrives during testing. Refresh the session first in
  // case the email WAS confirmed (so downstream has the freshest JWT), then
  // proceed to Terms regardless so testing isn't blocked.
  // TODO(pre-launch): remove the unconditional advance once a production email
  // provider (Resend/SendGrid) is configured.
  const onManualCheck = async () => {
    setChecking(true);
    try {
      await checkVerified();
    } finally {
      setChecking(false);
      nav.replace('Terms');
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.brand}>
        <Image
          source={require('../../../assets/logo.png')}
          style={styles.logo}
          resizeMode="contain"
          tintColor="#FFFFFF"
        />
      </View>

      <View style={styles.iconWrap}>
        <Ionicons name="mail-outline" size={56} color={colors.white} />
      </View>

      <Text style={styles.title}>Check your email</Text>
      <Text style={styles.body}>
        Tap the verification link we sent to{'\n'}
        <Text style={styles.email}>{email}</Text>
        {'\n\n'}to continue.
      </Text>

      <View style={styles.spinnerRow}>
        <ActivityIndicator color="#85B7EB" />
        <Text style={styles.spinnerLabel}>Waiting for verification…</Text>
      </View>

      <View style={styles.actions}>
        <Text style={styles.note}>
          If you don't receive the email, tap "Already verified? Continue" to proceed.
        </Text>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onResend}
          disabled={resending}
          style={[styles.resendBtn, resending && styles.btnDim]}
        >
          {resending ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.resendText}>Resend Email</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity activeOpacity={0.7} onPress={onManualCheck} disabled={checking} style={styles.manualWrap}>
          <Text style={styles.manualText}>
            Already verified?{' '}
            <Text style={styles.manualEmphasis}>{checking ? 'Checking…' : 'Continue'}</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.navy,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  brand: {
    alignItems: 'center',
    marginTop: 8,
  },
  logo: {
    height: 60,
    width: undefined,
    aspectRatio: 1,
  },
  iconWrap: {
    marginTop: 32,
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    marginTop: 24,
    color: colors.white,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  body: {
    marginTop: 12,
    color: 'rgba(255,255,255,0.78)',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  email: {
    color: '#85B7EB',
    fontWeight: '700',
  },
  spinnerRow: {
    marginTop: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  spinnerLabel: {
    color: '#85B7EB',
    fontSize: 13,
    fontWeight: '500',
  },
  actions: {
    width: '100%',
    marginTop: 'auto',
    gap: 12,
  },
  resendBtn: {
    backgroundColor: '#185FA5',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnDim: { opacity: 0.7 },
  resendText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  note: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginBottom: 4,
  },
  manualWrap: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  manualText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '500',
  },
  manualEmphasis: {
    color: '#85B7EB',
    fontWeight: '700',
  },
});
