import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CommonActions, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, radius, spacing } from '../theme';
import type { RootStackParamList } from '../navigation/types';

export const CancelSuccessScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'CancelSuccess'>>();
  const { deletionDate, emailSent } = route.params;

  const handleDone = () => {
    // Reset to the Dashboard; the account is now downgraded (free tier).
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
        <View style={styles.iconCircle}>
          <Ionicons name="checkmark" size={44} color={colors.white} />
        </View>
        <Text style={styles.title}>Subscription Cancelled</Text>
        <Text style={styles.message}>
          Your subscription has been cancelled. Your documents will remain available until{' '}
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
