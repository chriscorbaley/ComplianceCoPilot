import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography } from '../theme';
import {
  isTablet,
  scaled,
  CONTENT_MAX_WIDTH,
  SCREEN_WIDTH,
} from '../constants/layout';
import { DashboardScreen } from '../screens/DashboardScreen';
import { HoursScreen } from '../screens/HoursScreen';
import { BusinessTravelScreen } from '../screens/BusinessTravelScreen';
import { MileageScreen } from '../screens/MileageScreen';
import { MinutesScreen } from '../screens/MinutesScreen';
import { DocsScreen } from '../screens/DocsScreen';
import { useFeatureFlag } from '../context/FeatureFlagContext';
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
    case 'Mileage':
      return focused ? 'speedometer' : 'speedometer-outline';
    case 'Minutes':
      return focused ? 'document-text' : 'document-text-outline';
    case 'Docs':
      return focused ? 'document' : 'document-outline';
  }
};

export const BottomTabs: React.FC = () => {
  // Feature flags fully remove a tab from navigation when the feature is off.
  // (Tier gating still applies inside each screen when the flag is on.)
  const businessTravelEnabled = useFeatureFlag('business_travel');
  const mileageEnabled = useFeatureFlag('mileage_tracker');
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.navy,
        tabBarInactiveTintColor: colors.subtleText,
        tabBarStyle: isTablet ? [styles.tabBar, styles.tabBarTablet] : styles.tabBar,
        tabBarLabelStyle: styles.label,
        tabBarItemStyle: styles.item,
        tabBarIcon: ({ focused, color, size }) => (
          <Ionicons
            name={iconFor(route.name as keyof TabParamList, focused)}
            size={scaled(size ?? 22)}
            color={color}
          />
        ),
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Hours" component={HoursScreen} />
      {businessTravelEnabled && (
        <Tab.Screen
          name="Trips"
          component={BusinessTravelScreen}
          options={{ tabBarLabel: 'Trips' }}
        />
      )}
      {mileageEnabled && <Tab.Screen name="Mileage" component={MileageScreen} />}
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
  // On tablets, constrain the tab bar to the 600px content column and center it
  // so the tabs align with the content instead of stretching across the screen.
  // alignSelf + maxWidth handle the centering; SCREEN_WIDTH/CONTENT_MAX_WIDTH are
  // referenced here to keep the math self-documenting.
  tabBarTablet: {
    maxWidth: CONTENT_MAX_WIDTH,
    width: SCREEN_WIDTH >= CONTENT_MAX_WIDTH ? '100%' : SCREEN_WIDTH,
    alignSelf: 'center',
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
