import React, { useCallback, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
// Imported for its startup side effect: logs SCREEN_WIDTH / isTablet on launch
// and guarantees the layout module loads at app start.
import './src/constants/layout';
import { RootStack } from './src/navigation/RootStack';
import { OnboardingStack } from './src/navigation/OnboardingStack';
import { LegalReacceptanceFlow } from './src/screens/onboarding/LegalReacceptanceFlow';
import { colors } from './src/theme';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { BusinessProvider } from './src/business/BusinessContext';
import { YearProvider } from './src/context/YearContext';
import { FeatureFlagProvider } from './src/context/FeatureFlagContext';
import { LoginScreen } from './src/screens/LoginScreen';
import { SignUpScreen } from './src/screens/SignUpScreen';
import { SplashScreen } from './src/screens/SplashScreen';

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.background,
    card: colors.white,
    primary: colors.navy,
    text: colors.bodyText,
    border: colors.divider,
  },
};

const SPLASH_DURATION_MS = 1500;

const Gate: React.FC = () => {
  const {
    session,
    loading,
    onboardingCompleted,
    isAdmin,
    legalReacceptanceNeeded,
    refreshProfile,
  } = useAuth();
  const [splashElapsed, setSplashElapsed] = useState(false);
  const [authView, setAuthView] = useState<'signin' | 'signup'>('signin');

  useEffect(() => {
    const t = setTimeout(() => setSplashElapsed(true), SPLASH_DURATION_MS);
    return () => clearTimeout(t);
  }, []);

  const onReacceptanceComplete = useCallback(() => {
    void refreshProfile();
  }, [refreshProfile]);

  if (loading || !splashElapsed) return <SplashScreen />;
  if (!session) {
    return authView === 'signin' ? (
      <LoginScreen onCreateAccount={() => setAuthView('signup')} />
    ) : (
      <SignUpScreen onBackToSignIn={() => setAuthView('signin')} />
    );
  }
  if (!onboardingCompleted && !isAdmin) {
    return (
      <NavigationContainer theme={navTheme}>
        <OnboardingStack />
      </NavigationContainer>
    );
  }
  // An onboarded user whose accepted ToS/Privacy version is now out of date
  // must re-accept before reaching the app. refreshProfile re-runs the check,
  // clearing this once every changed document has been re-accepted.
  if (legalReacceptanceNeeded.length > 0) {
    return (
      <LegalReacceptanceFlow
        needed={legalReacceptanceNeeded}
        onComplete={onReacceptanceComplete}
      />
    );
  }
  return (
    <BusinessProvider>
      <YearProvider>
        <NavigationContainer theme={navTheme}>
          <RootStack />
        </NavigationContainer>
      </YearProvider>
    </BusinessProvider>
  );
};

export default function App() {
  // Lock the whole app to portrait/vertical orientation on both phones and
  // tablets. Landscape is never supported. (app.json also sets portrait +
  // requiresFullScreen; this is the runtime belt-and-suspenders lock.)
  useEffect(() => {
    ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.PORTRAIT_UP,
    ).catch(() => undefined);
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor={colors.navy} translucent={false} />
      <AuthProvider>
        <FeatureFlagProvider>
          <Gate />
        </FeatureFlagProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
