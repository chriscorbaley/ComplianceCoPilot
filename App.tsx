import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootStack } from './src/navigation/RootStack';
import { OnboardingStack } from './src/navigation/OnboardingStack';
import { colors } from './src/theme';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { BusinessProvider } from './src/business/BusinessContext';
import { YearProvider } from './src/context/YearContext';
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
  const { session, loading, onboardingCompleted, isAdmin } = useAuth();
  const [splashElapsed, setSplashElapsed] = useState(false);
  const [authView, setAuthView] = useState<'signin' | 'signup'>('signin');

  useEffect(() => {
    const t = setTimeout(() => setSplashElapsed(true), SPLASH_DURATION_MS);
    return () => clearTimeout(t);
  }, []);

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
  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor={colors.navy} translucent={false} />
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
