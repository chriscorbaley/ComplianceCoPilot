import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography } from '../theme';
import { DashboardScreen } from '../screens/DashboardScreen';
import { HoursScreen } from '../screens/HoursScreen';
import { BusinessTravelScreen } from '../screens/BusinessTravelScreen';
import { MinutesScreen } from '../screens/MinutesScreen';
import { DocsScreen } from '../screens/DocsScreen';
import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

type IconName = keyof typeof Ionicons.glyphMap;

const iconFor = (route: keyof TabParamList, focused: boolean): IconName => {
  switch (route) {
    case 'Dashboard':
      return focused ? 'grid' : 'grid-outline';
    case 'Hours':
      return focused ? 'time' : 'time-outline';
    case 'Trips':
      return focused ? 'airplane' : 'airplane-outline';
    case 'Minutes':
      return focused ? 'document-text' : 'document-text-outline';
    case 'Docs':
      return focused ? 'document' : 'document-outline';
  }
};

export const BottomTabs: React.FC = () => {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.navy,
        tabBarInactiveTintColor: colors.subtleText,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.label,
        tabBarItemStyle: styles.item,
        tabBarIcon: ({ focused, color, size }) => (
          <Ionicons
            name={iconFor(route.name as keyof TabParamList, focused)}
            size={size ?? 22}
            color={color}
          />
        ),
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Hours" component={HoursScreen} />
      <Tab.Screen
        name="Trips"
        component={BusinessTravelScreen}
        options={{ tabBarLabel: 'Trips' }}
      />
      <Tab.Screen name="Minutes" component={MinutesScreen} />
      <Tab.Screen name="Docs" component={DocsScreen} />
    </Tab.Navigator>
  );
};

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    height: Platform.select({ ios: 84, android: 64, default: 64 }),
    paddingTop: 8,
  },
  label: {
    ...typography.micro,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  item: {
    paddingVertical: 4,
  },
});
