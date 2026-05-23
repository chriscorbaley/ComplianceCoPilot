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

interface SignUpScreenProps {
  onBackToSignIn: () => void;
}

export const SignUpScreen: React.FC<SignUpScreenProps> = ({ onBackToSignIn }) => {
  const insets = useSafeAreaInsets();
  const { signUp } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const onSignUp = async () => {
    const name = fullName.trim();
    const e = email.trim().toLowerCase();
    if (!name) {
      Alert.alert('Full name is required.');
      return;
    }
    if (!e || !password) {
      Alert.alert('Email and password are required.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Password must be at least 6 characters.');
      return;
    }
    setBusy(true);
    try {
      await signUp(e, password, name);
      Alert.alert(
        'Account created',
        'If email confirmation is enabled, check your inbox before signing in.',
        [{ text: 'OK', onPress: onBackToSignIn }],
      );
    } catch (err) {
      Alert.alert(
        'Sign-up failed',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBusy(false);
    }
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
            tintColor="#FFFFFF"
          />
        </View>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            autoCapitalize="words"
            autoCorrect={false}
            value={fullName}
            onChangeText={setFullName}
            placeholder="Full name"
            placeholderTextColor={colors.subtleText}
          />
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
            onPress={onSignUp}
            disabled={busy}
            style={[styles.signUpBtn, busy && styles.signUpBtnDim]}
          >
            {busy ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.signUpText}>Create Account</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={onBackToSignIn}
            style={styles.backWrap}
          >
            <Text style={styles.backText}>
              Already have an account? <Text style={styles.backTextEmphasis}>Sign in</Text>
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
    height: 60,
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
  signUpBtn: {
    marginTop: 8,
    backgroundColor: '#185FA5',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    width: '100%',
  },
  signUpBtnDim: { opacity: 0.7 },
  signUpText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  backWrap: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  backText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    fontWeight: '500',
  },
  backTextEmphasis: {
    color: '#85B7EB',
    fontWeight: '700',
  },
});
