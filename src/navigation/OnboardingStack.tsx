import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors } from '../theme';
import { EmailVerifyScreen } from '../screens/onboarding/EmailVerifyScreen';
import { TermsScreen } from '../screens/onboarding/TermsScreen';
import { PrivacyScreen } from '../screens/onboarding/PrivacyScreen';
import { ChoosePlanScreen } from '../screens/onboarding/ChoosePlanScreen';
import { UpgradeTeaserScreen } from '../screens/onboarding/UpgradeTeaserScreen';
import { BusinessTravelIntroScreen } from '../screens/onboarding/BusinessTravelIntroScreen';
import { PaymentScreen } from '../screens/onboarding/PaymentScreen';
import { StrategySelectionScreen } from '../screens/onboarding/StrategySelectionScreen';
import { RealEstateTypeScreen } from '../screens/onboarding/RealEstateTypeScreen';
import { RealEstateMpTestScreen } from '../screens/onboarding/RealEstateMpTestScreen';
import { RealEstateRepsScreen } from '../screens/onboarding/RealEstateRepsScreen';
import { RealEstatePropertiesScreen } from '../screens/onboarding/RealEstatePropertiesScreen';
import { RealEstateGroupingScreen } from '../screens/onboarding/RealEstateGroupingScreen';
import { RealEstateCompleteScreen } from '../screens/onboarding/RealEstateCompleteScreen';
import type { OnboardingStackParamList } from './types';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

export const OnboardingStack: React.FC = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        gestureEnabled: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="EmailVerify" component={EmailVerifyScreen} />
      <Stack.Screen name="Terms" component={TermsScreen} />
      <Stack.Screen name="Privacy" component={PrivacyScreen} />
      <Stack.Screen name="ChoosePlan" component={ChoosePlanScreen} />
      <Stack.Screen name="UpgradeTeaser" component={UpgradeTeaserScreen} />
      <Stack.Screen name="BusinessTravelIntro" component={BusinessTravelIntroScreen} />
      <Stack.Screen name="Payment" component={PaymentScreen} />
      <Stack.Screen name="StrategySelection" component={StrategySelectionScreen} />
      <Stack.Screen name="RealEstateType" component={RealEstateTypeScreen} />
      <Stack.Screen name="RealEstateMpTest" component={RealEstateMpTestScreen} />
      <Stack.Screen name="RealEstateReps" component={RealEstateRepsScreen} />
      <Stack.Screen name="RealEstateProperties" component={RealEstatePropertiesScreen} />
      <Stack.Screen name="RealEstateGrouping" component={RealEstateGroupingScreen} />
      <Stack.Screen name="RealEstateComplete" component={RealEstateCompleteScreen} />
    </Stack.Navigator>
  );
};
