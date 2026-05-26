import React, { useState } from 'react';
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
import { colors, radius, spacing, typography } from '../theme';
import { useAuth } from '../auth/AuthContext';
import type { RootStackParamList } from '../navigation/types';

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { session, signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  const confirmLogout = () => {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await signOut();
          } catch (err) {
            Alert.alert(
              'Sign-out failed',
              err instanceof Error ? err.message : String(err),
            );
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Account</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Ionicons name="person-outline" size={20} color={colors.midNavy} />
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Signed in as</Text>
                <Text style={styles.rowValue} numberOfLines={1}>
                  {session?.user.email ?? '—'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Businesses</Text>
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.card}
            onPress={() => navigation.navigate('Businesses')}
          >
            <View style={styles.row}>
              <Ionicons name="business-outline" size={20} color={colors.midNavy} />
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Manage businesses</Text>
                <Text style={styles.rowValue}>Add, edit, or set a default</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.subtleText} />
            </View>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={confirmLogout}
          disabled={busy}
          style={[styles.logoutBtn, busy && styles.logoutBtnDim]}
        >
          {busy ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <>
              <Ionicons name="log-out-outline" size={18} color={colors.white} />
              <Text style={styles.logoutText}>Log out</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={styles.dangerSection}>
          <Text style={styles.dangerLabel}>Subscription</Text>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigation.navigate('CancelWarning1')}
            style={styles.cancelSubBtn}
          >
            <Ionicons name="close-circle-outline" size={18} color="#C0392B" />
            <Text style={styles.cancelSubText}>Cancel Subscription</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.xl,
  },
  section: {
    gap: spacing.sm,
  },
  sectionLabel: {
    ...typography.micro,
    color: colors.mutedText,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.card,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.cardBorder,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  rowText: {
    flex: 1,
  },
  rowLabel: {
    ...typography.caption,
    color: colors.mutedText,
  },
  rowValue: {
    ...typography.bodyMedium,
    color: colors.bodyText,
    marginTop: 2,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: '#185FA5',
    borderRadius: 8,
    paddingVertical: 14,
  },
  logoutBtnDim: { opacity: 0.7 },
  logoutText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  dangerSection: {
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  dangerLabel: {
    ...typography.micro,
    color: colors.mutedText,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  cancelSubBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderRadius: 8,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#C0392B',
  },
  cancelSubText: {
    color: '#C0392B',
    fontSize: 14,
    fontWeight: '700',
  },
});
