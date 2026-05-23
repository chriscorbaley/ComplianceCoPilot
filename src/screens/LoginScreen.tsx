import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { useAuth } from '../auth/AuthContext';

interface LoginScreenProps {
  onCreateAccount: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onCreateAccount }) => {
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const onSignIn = async () => {
    const e = email.trim().toLowerCase();
    if (!e || !password) {
      Alert.alert('Email and password are required.');
      return;
    }
    setBusy(true);
    try {
      await signIn(e, password);
    } catch (err) {
      Alert.alert(
        'Sign-in failed',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBusy(false);
    }
  };

  const onForgotPassword = () => {
    Alert.alert(
      'Forgot password',
      'Contact your administrator to reset your password.',
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <Image
            source={require('../../assets/logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={colors.subtleText}
          />
          <TextInput
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={colors.subtleText}
          />

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={onSignIn}
            disabled={busy}
            style={[styles.signInBtn, busy && styles.signInBtnDim]}
          >
            {busy ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.signInText}>Sign In</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={onForgotPassword}
            style={styles.forgotWrap}
          >
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={onCreateAccount}
            style={styles.createWrap}
          >
            <Text style={styles.createText}>
              New here? <Text style={styles.createTextEmphasis}>Create an account</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.navy,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    gap: 32,
  },
  brand: {
    alignItems: 'center',
    marginTop: 24,
  },
  logo: {
    height: 120,
    width: undefined,
    aspectRatio: 1,
  },
  form: {
    gap: 12,
  },
  input: {
    backgroundColor: colors.white,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 12,
    color: colors.bodyText,
  },
  signInBtn: {
    marginTop: 8,
    backgroundColor: '#185FA5',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    width: '100%',
  },
  signInBtnDim: { opacity: 0.7 },
  signInText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  forgotWrap: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  forgotText: {
    color: '#85B7EB',
    fontSize: 13,
    fontWeight: '500',
  },
  createWrap: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  createText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    fontWeight: '500',
  },
  createTextEmphasis: {
    color: '#85B7EB',
    fontWeight: '700',
  },
});
