import React, { useState } from 'react';
import {
  ActivityIndicator,
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
import { requestNotificationPermission } from '../../services/notifications';
import type { OnboardingStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'NotificationsPermission'>;

// Shown during onboarding right after the Terms screen. Requests OS notification
// permission so we can send document-deadline and compliance reminders.
export const NotificationsPermissionScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const [busy, setBusy] = useState(false);

  const proceed = () => nav.replace('Privacy');

  const onAllow = async () => {
    setBusy(true);
    try {
      await requestNotificationPermission();
    } finally {
      setBusy(false);
      proceed();
    }
  };

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 },
      ]}
    >
      <View style={styles.brand}>
        <Image
          source={require('../../../assets/logo.png')}
          style={styles.logo}
          resizeMode="contain"
          tintColor="#FFFFFF"
        />
      </View>

      <View style={styles.body}>
        <View style={styles.iconWrap}>
          <Ionicons name="notifications" size={40} color={colors.amber} />
        </View>
        <Text style={styles.title}>Stay on top of your compliance</Text>
        <Text style={styles.subtitle}>
          Allow notifications so we can remind you about document deadlines and
          compliance milestones.
        </Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          activeOpacity={0.85}
          style={styles.allowBtn}
          onPress={onAllow}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.allowText}>Allow Notifications</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.7} style={styles.skipWrap} onPress={proceed}>
          <Text style={styles.skipText}>Not now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#042C53', paddingHorizontal: 24 },
  brand: { alignItems: 'center', marginBottom: 12 },
  logo: { height: 50, width: undefined, aspectRatio: 1 },
  body: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14 },
  iconWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(133,183,235,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: colors.white,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: '#85B7EB',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    paddingHorizontal: 8,
  },
  actions: { gap: 12 },
  allowBtn: {
    backgroundColor: colors.amber,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  allowText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  skipWrap: { alignItems: 'center', paddingVertical: 8 },
  skipText: { color: '#85B7EB', fontSize: 13, fontWeight: '500' },
});
