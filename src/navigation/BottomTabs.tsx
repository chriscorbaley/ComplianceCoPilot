import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

// Tab bar height WITHOUT the bottom safe-area inset. The Android system nav bar
// inset (and, on iOS, the home indicator) is added on top of this at runtime.
const BASE_TAB_HEIGHT = Platform.select({ ios: 84, android: 64, default: 64 });

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
  // Safe-area bottom inset keeps the tab bar above the Android system navigation
  // bar (back/home/recent). iOS already accounts for the home indicator via the
  // fixed BASE_TAB_HEIGHT below, so we only add the actual inset on Android to
  // avoid changing the iOS appearance.
  const insets = useSafeAreaInsets();
  const bottomInset = Platform.OS === 'android' ? insets.bottom : 0;
  const tabBarInset = {
    height: BASE_TAB_HEIGHT + bottomInset,
    paddingBottom: bottomInset,
  };
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.navy,
        tabBarInactiveTintColor: colors.subtleText,
        tabBarStyle: isTablet
          ? [styles.tabBar, styles.tabBarTablet, tabBarInset]
          : [styles.tabBar, tabBarInset],
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
    // height + paddingBottom are applied dynamically via `tabBarInset` so the
    // bar clears the Android system navigation bar (see BASE_TAB_HEIGHT).
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
