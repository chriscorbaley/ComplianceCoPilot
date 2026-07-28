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
import {
  configureRevenueCat,
  identifyRevenueCatUser,
  logOutRevenueCatUser,
  getOfferings,
} from './src/services/revenueCat';

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

  // Configure RevenueCat once and keep its app user ID in sync with the signed-
  // in Supabase user, so native purchases (Apple/Google) are tied to the right
  // account across devices. Configure is idempotent; identify/logOut track the
  // session. RevenueCat is a no-op until its platform API key env var is set.
  const revenueCatUserId = session?.user.id ?? null;
  useEffect(() => {
    configureRevenueCat(revenueCatUserId);
    void (async () => {
      if (revenueCatUserId) {
        await identifyRevenueCatUser(revenueCatUserId);
      } else {
        await logOutRevenueCatUser();
      }
      // TEMPORARY (RevenueCat bring-up): print available offerings to verify the
      // SDK connection. Remove once the paywall UI is built.
      const offerings = await getOfferings();
      console.log(
        '[RevenueCat] offerings:',
        JSON.stringify(
          {
            current: offerings?.current?.identifier ?? null,
            all: offerings ? Object.keys(offerings.all) : null,
            currentPackages:
              offerings?.current?.availablePackages.map((p) => ({
                identifier: p.identifier,
                productId: p.product.identifier,
                priceString: p.product.priceString,
              })) ?? null,
          },
          null,
          2,
        ),
      );
    })();
  }, [revenueCatUserId]);

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
