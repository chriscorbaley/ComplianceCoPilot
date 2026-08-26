// Shown after the cancellation request is recorded and the user has been handed
// to the store's subscription management.
//
// This screen must NOT claim the subscription is cancelled. Only Apple/Google
// can do that, and we cannot reliably observe the outcome of their sheet — so
// the copy confirms what we actually know (the request is recorded, documents
// are retained until the deletion date) and tells the user to finish in the
// store when there's any sign they might not have.

import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CommonActions, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { colors, radius, spacing } from '../theme';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';

export const CancelSuccessScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'CancelSuccess'>>();
  const { deletionDate, emailSent, manageOpened, stillRenewing } = route.params;

  const storeName = Platform.OS === 'ios' ? 'App Store' : 'Play Store';
  const storeSteps =
    Platform.OS === 'ios'
      ? 'Settings → your name → Subscriptions'
      : 'Play Store → Menu → Payments & subscriptions';

  // Two different "you may not be done" cases: we couldn't open the store at
  // all, or we opened it and the store still reports a renewing subscription.
  const needsStoreAction = manageOpened === false || stillRenewing === true;

  const handleDone = () => {
    // Reset to the Dashboard. The tier is deliberately unchanged — access runs
    // until the paid period ends, and the RevenueCat webhook revokes it then.
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Tabs', state: { routes: [{ name: 'Dashboard' }] } }],
      }),
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.body}>
        <View style={[styles.iconCircle, needsStoreAction && styles.iconCircleWarn]}>
          <Ionicons
            name={needsStoreAction ? 'alert' : 'checkmark'}
            size={44}
            color={colors.white}
          />
        </View>
        <Text style={styles.title}>
          {needsStoreAction ? `Finish in the ${storeName}` : 'Cancellation Requested'}
        </Text>
        <Text style={styles.message}>
          {needsStoreAction
            ? manageOpened === false
              ? `We recorded your request, but couldn't open the ${storeName}. To stop your billing, go to ${storeSteps} and cancel there.`
              : `We recorded your request, but the ${storeName} still shows your subscription as renewing. If you didn't complete the cancellation, go to ${storeSteps} to finish.`
            : `We've recorded your request. Your subscription stays active until the period you've paid for ends, and the ${storeName} handles the rest.`}
        </Text>
        <Text style={styles.message}>
          Your documents remain available until{' '}
          <Text style={styles.dateInline}>{deletionDate}</Text>.
          {emailSent === false
            ? ' If you do not receive a confirmation email, please contact support.'
            : ' We have sent a confirmation to your email address.'}
        </Text>
      </View>

      <TouchableOpacity style={styles.doneBtn} onPress={handleDone} activeOpacity={0.85}>
        <Text style={styles.doneText}>Done</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.white,
    padding: spacing.lg,
    justifyContent: 'space-between',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleWarn: {
    backgroundColor: colors.amber,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.navy,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    color: colors.bodyText,
    lineHeight: 22,
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
  },
  dateInline: {
    fontWeight: '700',
    color: colors.navy,
  },
  doneBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.navy,
    borderRadius: 8,
    paddingVertical: 14,
    marginBottom: spacing.lg,
  },
  doneText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },
});
