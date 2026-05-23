import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors } from '../theme';
import { BottomTabs } from './BottomTabs';
import { DocumentDetailScreen } from '../screens/DocumentDetailScreen';
import { StrategyDetailScreen } from '../screens/StrategyDetailScreen';
import { AdminPanelScreen } from '../screens/admin/AdminPanelScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { MinutesDocumentScreen } from '../screens/MinutesDocumentScreen';
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
    </Stack.Navigator>
  );
};
