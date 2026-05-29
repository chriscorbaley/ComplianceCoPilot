import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors } from '../theme';
import { BottomTabs } from './BottomTabs';
import { DocumentDetailScreen } from '../screens/DocumentDetailScreen';
import { StrategyDetailScreen } from '../screens/StrategyDetailScreen';
import { RealEstateActivityLog } from '../screens/strategy/RealEstateActivityLog';
import { AdminPanelScreen } from '../screens/admin/AdminPanelScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { MinutesDocumentScreen } from '../screens/MinutesDocumentScreen';
import { CancelWarning1Screen } from '../screens/CancelWarning1Screen';
import { CancelWarning2Screen } from '../screens/CancelWarning2Screen';
import { BusinessesScreen } from '../screens/BusinessesScreen';
import { BusinessEditScreen } from '../screens/BusinessEditScreen';
import { PropertiesScreen } from '../screens/PropertiesScreen';
import { PropertyEditScreen } from '../screens/PropertyEditScreen';
import { SCorpComplianceScreen } from '../screens/strategy/SCorpComplianceScreen';
import { HomeOfficeComplianceScreen } from '../screens/strategy/HomeOfficeComplianceScreen';
import { FamilyMgmtComplianceScreen } from '../screens/strategy/FamilyMgmtComplianceScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootStack: React.FC = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.navy },
        headerTintColor: colors.white,
        headerTitleStyle: { color: colors.white, fontSize: 17, fontWeight: '600' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen
        name="Tabs"
        component={BottomTabs}
        options={{ headerShown: false }}
      />
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
