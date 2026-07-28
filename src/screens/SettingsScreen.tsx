import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
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
import { useFeatureFlag } from '../context/FeatureFlagContext';
import {
  completeCancellation,
  fetchDocumentCount,
  formatDeletionDate,
} from '../services/cancellation';
import { requireUserId } from '../services/supabase';
import {
  canRequestRefund,
  openManageSubscriptions,
  requestRefund,
} from '../services/revenueCat';
import type { RootStackParamList } from '../navigation/types';

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { session, signOut, refreshProfile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [managing, setManaging] = useState(false);
  const [refunding, setRefunding] = useState(false);
  // Apple's refund sheet is a StoreKit API with no Android equivalent, so the
  // row only exists on iOS. Google refunds are handled on the Play website,
  // reachable from the Manage Subscription row below.
  const refundSupported = canRequestRefund();
  // When the double-signature flow is turned off firm-wide, cancellation uses a
  // simple confirmation dialog instead. (Tier/subscription behavior unchanged.)
  const signatureFlowEnabled = useFeatureFlag('cancellation_signature');

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

  // Simple-confirmation cancellation used when the signature flow flag is off.
  const runSimpleCancellation = async () => {
    setCancelling(true);
    try {
      const uid = await requireUserId();
      const documentCount = await fetchDocumentCount(uid).catch(() => 0);
      const result = await completeCancellation({ documentCount });
      try {
        await refreshProfile();
      } catch {
        // non-fatal; Dashboard refreshes on focus anyway
      }
      navigation.replace('CancelSuccess', {
        deletionDate: formatDeletionDate(new Date(result.deletionScheduledFor)),
        emailSent: result.emailSent,
      });
    } catch (err) {
      Alert.alert(
        'Cancellation failed',
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setCancelling(false);
    }
  };

  // Opens the store's own subscription management UI: Apple's native sheet on
  // iOS, Google Play's subscription page on Android.
  const onManagePress = async () => {
    setManaging(true);
    try {
      const result = await openManageSubscriptions();
      if (result !== 'opened') {
        Alert.alert(
          'Could not open subscriptions',
          Platform.OS === 'ios'
            ? 'Open the Settings app, tap your name, then Subscriptions to manage your plan.'
            : 'Open the Google Play Store app, then Menu → Payments & subscriptions to manage your plan.',
        );
      }
    } finally {
      setManaging(false);
    }
  };

  // Presents Apple's refund sheet. Apple — not us — decides the outcome and
  // notifies the user by email, so the copy here promises nothing.
  const runRefundRequest = async () => {
    setRefunding(true);
    try {
      const result = await requestRefund();
      switch (result) {
        case 'submitted':
          Alert.alert(
            'Request sent',
            'Apple has received your refund request. They review it directly and will email you their decision. Your access continues until Apple processes the refund.',
          );
          break;
        case 'no_subscription':
          Alert.alert(
            'No active subscription',
            'There is no active subscription on this account to request a refund for.',
          );
          break;
        case 'unsupported':
          Alert.alert(
            'Not available',
            'Refund requests can only be made on the device where the subscription was purchased.',
          );
          break;
        case 'error':
          Alert.alert(
            'Request failed',
            'We could not open Apple’s refund form. You can request a refund at reportaproblem.apple.com.',
          );
          break;
        case 'cancelled':
        default:
          // User dismissed Apple's sheet — no message needed.
          break;
      }
    } finally {
      setRefunding(false);
    }
  };

  const onRefundPress = () => {
    Alert.alert(
      'Request Refund',
      'This opens Apple’s refund request form for your most recent subscription charge. Apple reviews and decides all refunds.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Continue', onPress: () => void runRefundRequest() },
      ],
    );
  };

  const onCancelPress = () => {
    if (signatureFlowEnabled) {
      navigation.navigate('CancelWarning1');
      return;
    }
    Alert.alert(
      'Cancel Subscription',
      'This cancels your subscription and schedules your documents for deletion in 30 days. This cannot be undone. Continue?',
      [
        { text: 'Keep Subscription', style: 'cancel' },
        {
          text: 'Cancel Subscription',
          style: 'destructive',
          onPress: () => void runSimpleCancellation(),
        },
      ],
    );
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

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Subscription</Text>
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.card}
            onPress={() => void onManagePress()}
            disabled={managing}
          >
            <View style={styles.row}>
              <Ionicons name="card-outline" size={20} color={colors.midNavy} />
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Manage subscription</Text>
                <Text style={styles.rowValue}>
                  {Platform.OS === 'ios'
                    ? 'Change or cancel your plan in the App Store'
                    : 'Change or cancel your plan in Google Play'}
                </Text>
              </View>
              {managing ? (
                <ActivityIndicator color={colors.midNavy} />
              ) : (
                <Ionicons name="chevron-forward" size={18} color={colors.subtleText} />
              )}
            </View>
          </TouchableOpacity>

          {refundSupported && (
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.card}
              onPress={onRefundPress}
              disabled={refunding}
            >
              <View style={styles.row}>
                <Ionicons
                  name="return-down-back-outline"
                  size={20}
                  color={colors.midNavy}
                />
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>Request refund</Text>
                  <Text style={styles.rowValue}>
                    Ask Apple to refund a recent charge
                  </Text>
                </View>
                {refunding ? (
                  <ActivityIndicator color={colors.midNavy} />
                ) : (
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={colors.subtleText}
                  />
                )}
              </View>
            </TouchableOpacity>
          )}
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
          <Text style={styles.dangerLabel}>Danger Zone</Text>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={onCancelPress}
            disabled={cancelling}
            style={[styles.cancelSubBtn, cancelling && styles.logoutBtnDim]}
          >
            {cancelling ? (
              <ActivityIndicator color="#A32D2D" />
            ) : (
              <>
                <Ionicons name="close-circle-outline" size={18} color="#A32D2D" />
                <Text style={styles.cancelSubText}>Cancel Subscription</Text>
              </>
            )}
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
    borderColor: '#A32D2D',
  },
  cancelSubText: {
    color: '#A32D2D',
    fontSize: 14,
    fontWeight: '700',
  },
});
