import React from 'react';
import { TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors } from '../theme';
import { BottomTabs } from './BottomTabs';
import { DocumentDetailScreen } from '../screens/DocumentDetailScreen';
import { StrategyDetailScreen } from '../screens/StrategyDetailScreen';
import { RealEstateActivityLog } from '../screens/strategy/RealEstateActivityLog';
import { AdminPanelScreen } from '../screens/admin/AdminPanelScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ChoosePlanScreen } from '../screens/onboarding/ChoosePlanScreen';
import { UpgradeConfirmScreen } from '../screens/UpgradeConfirmScreen';
import { UpgradeStrategySelectScreen } from '../screens/UpgradeStrategySelectScreen';
import { MinutesDocumentScreen } from '../screens/MinutesDocumentScreen';
import { CancelWarning1Screen } from '../screens/CancelWarning1Screen';
import { CancelWarning2Screen } from '../screens/CancelWarning2Screen';
import { BusinessesScreen } from '../screens/BusinessesScreen';
import { BusinessEditScreen } from '../screens/BusinessEditScreen';
import { BusinessSetupScreen } from '../screens/onboarding/BusinessSetupScreen';
import { PropertiesScreen } from '../screens/PropertiesScreen';
import { PropertyEditScreen } from '../screens/PropertyEditScreen';
import { RealEstateTypeScreen } from '../screens/onboarding/RealEstateTypeScreen';
import { RealEstateMpTestScreen } from '../screens/onboarding/RealEstateMpTestScreen';
import { RealEstateRepsScreen } from '../screens/onboarding/RealEstateRepsScreen';
import { RealEstatePropertiesScreen } from '../screens/onboarding/RealEstatePropertiesScreen';
import { RealEstateGroupingScreen } from '../screens/onboarding/RealEstateGroupingScreen';
import { RealEstateCompleteScreen } from '../screens/onboarding/RealEstateCompleteScreen';
import { SCorpComplianceScreen } from '../screens/strategy/SCorpComplianceScreen';
import { AugustaComplianceScreen } from '../screens/strategy/AugustaComplianceScreen';
import { HomeOfficeComplianceScreen } from '../screens/strategy/HomeOfficeComplianceScreen';
import { FamilyMgmtComplianceScreen } from '../screens/strategy/FamilyMgmtComplianceScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootStack: React.FC = () => {
  return (
    <Stack.Navigator
      screenOptions={({ navigation }) => ({
        headerStyle: { backgroundColor: colors.navy },
        headerTintColor: colors.white,
        headerTitleStyle: { color: colors.white, fontSize: 17, fontWeight: '600' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
        // Replace the platform back button with an explicit, always-functional
        // JS back button. The native header back button was intermittently not
        // firing on sub-menu screens (users had to swipe back); this guarantees
        // a tappable back control on every pushed screen while leaving the
        // swipe-back gesture enabled as a fallback. Rendered only when there's a
        // screen to return to.
        headerBackVisible: false,
        headerLeft: () =>
          navigation.canGoBack() ? (
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={{ paddingRight: 16, paddingVertical: 4 }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="chevron-back" size={24} color={colors.white} />
            </TouchableOpacity>
          ) : null,
      })}
    >
      <Stack.Screen
        name="Tabs"
        component={BottomTabs}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ChoosePlan"
        component={ChoosePlanScreen}
        options={{ title: 'Upgrade' }}
      />
      <Stack.Screen
        name="UpgradeConfirm"
        component={UpgradeConfirmScreen}
        options={({ route }) => ({
          title: `Upgrade to ${route.params.tier === 'pro' ? 'Pro' : 'Core'}`,
        })}
      />
      <Stack.Screen
        name="UpgradeStrategySelect"
        component={UpgradeStrategySelectScreen}
        options={{ title: 'Add Strategies', gestureEnabled: false }}
      />
      {/* Real-estate onboarding flow, reachable after an in-app upgrade that
          newly activates Real Estate. Headerless + no swipe-back, matching the
          onboarding stack presentation. */}
      <Stack.Group screenOptions={{ headerShown: false, gestureEnabled: false }}>
        <Stack.Screen name="RealEstateType" component={RealEstateTypeScreen} />
        <Stack.Screen name="RealEstateMpTest" component={RealEstateMpTestScreen} />
        <Stack.Screen name="RealEstateReps" component={RealEstateRepsScreen} />
        <Stack.Screen name="RealEstateProperties" component={RealEstatePropertiesScreen} />
        <Stack.Screen name="RealEstateGrouping" component={RealEstateGroupingScreen} />
        <Stack.Screen name="RealEstateComplete" component={RealEstateCompleteScreen} />
      </Stack.Group>

      <Stack.Screen
        name="DocumentDetail"
        component={DocumentDetailScreen}
        options={{ title: 'Document' }}
      />
      <Stack.Screen
        name="StrategyDetail"
        component={StrategyDetailScreen}
        options={{ title: 'Strategy' }}
      />
      <Stack.Screen
        name="RealEstateActivityLog"
        component={RealEstateActivityLog}
        options={{ title: 'Activity Log' }}
      />
      <Stack.Screen
        name="AdminPanel"
        component={AdminPanelScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Settings' }}
      />
      <Stack.Screen
        name="MinutesDocument"
        component={MinutesDocumentScreen}
        options={{ headerShown: false, presentation: 'modal' }}
      />
      <Stack.Screen
        name="CancelWarning1"
        component={CancelWarning1Screen}
        options={{ title: 'Cancel Subscription' }}
      />
      <Stack.Screen
        name="CancelWarning2"
        component={CancelWarning2Screen}
        options={{ title: 'Confirm Cancellation', gestureEnabled: false }}
      />
      <Stack.Screen
        name="Businesses"
        component={BusinessesScreen}
        options={{ title: 'Businesses' }}
      />
      <Stack.Screen
        name="BusinessEdit"
        component={BusinessEditScreen}
        options={{ title: 'Business' }}
      />
      <Stack.Screen
        name="BusinessSetup"
        component={BusinessSetupScreen}
        options={{ headerShown: false, gestureEnabled: false }}
      />
      <Stack.Screen
        name="Properties"
        component={PropertiesScreen}
        options={{ title: 'Properties' }}
      />
      <Stack.Screen
        name="PropertyEdit"
        component={PropertyEditScreen}
        options={{ title: 'Property' }}
      />
      <Stack.Screen
        name="SCorpCompliance"
        component={SCorpComplianceScreen}
        options={{ title: 'S-Corp Compliance' }}
      />
      <Stack.Screen
        name="AugustaCompliance"
        component={AugustaComplianceScreen}
        options={{ title: 'Augusta Compliance' }}
      />
      <Stack.Screen
        name="HomeOfficeCompliance"
        component={HomeOfficeComplianceScreen}
        options={{ title: 'Home Office Compliance' }}
      />
      <Stack.Screen
        name="FamilyMgmtCompliance"
        component={FamilyMgmtComplianceScreen}
        options={{ title: 'Family Mgmt Compliance' }}
      />
    </Stack.Navigator>
  );
};
