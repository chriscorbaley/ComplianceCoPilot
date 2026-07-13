import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase, type Session, type SubscriptionTier } from '../services/supabase';

interface AuthState {
  session: Session | null;
  loading: boolean;
  isAdmin: boolean;
  fullName: string | null;
  onboardingCompleted: boolean;
  businessOnboardingCompleted: boolean;
  subscriptionTier: SubscriptionTier | null;
  activeStrategies: string[];
  emailVerified: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

interface UserProfile {
  isAdmin: boolean;
  fullName: string | null;
  onboardingCompleted: boolean;
  businessOnboardingCompleted: boolean;
  subscriptionTier: SubscriptionTier | null;
  activeStrategies: string[];
}

async function fetchUserProfile(userId: string): Promise<UserProfile> {
  const { data, error } = await supabase
    .from('users')
    .select(
      'is_admin, full_name, onboarding_completed, business_onboarding_completed, subscription_tier, active_strategies',
    )
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) {
    return {
      isAdmin: false,
      fullName: null,
      onboardingCompleted: false,
      businessOnboardingCompleted: false,
      subscriptionTier: null,
      activeStrategies: [],
    };
  }
  const row = data as {
    is_admin?: boolean;
    full_name?: string | null;
    onboarding_completed?: boolean | null;
    business_onboarding_completed?: boolean | null;
    subscription_tier?: SubscriptionTier | null;
    active_strategies?: string[] | null;
  };
  return {
    isAdmin: Boolean(row.is_admin),
    fullName: row.full_name ?? null,
    onboardingCompleted: Boolean(row.onboarding_completed),
    businessOnboardingCompleted: Boolean(row.business_onboarding_completed),
    subscriptionTier: row.subscription_tier ?? null,
    activeStrategies: Array.isArray(row.active_strategies) ? row.active_strategies : [],
  };
}

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [fullName, setFullName] = useState<string | null>(null);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [businessOnboardingCompleted, setBusinessOnboardingCompleted] = useState(false);
  const [subscriptionTier, setSubscriptionTier] = useState<SubscriptionTier | null>(null);
  const [activeStrategies, setActiveStrategies] = useState<string[]>([]);

  const applyProfile = useCallback((p: UserProfile) => {
    setIsAdmin(p.isAdmin);
    setFullName(p.fullName);
    setOnboardingCompleted(p.onboardingCompleted);
    setBusinessOnboardingCompleted(p.businessOnboardingCompleted);
    setSubscriptionTier(p.subscriptionTier);
    setActiveStrategies(p.activeStrategies);
  }, []);

  const refreshProfile = useCallback(async () => {
    const uid = session?.user.id;
    if (!uid) return;
    const profile = await fetchUserProfile(uid);
    applyProfile(profile);
  }, [session?.user.id, applyProfile]);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session?.user.id) {
        const profile = await fetchUserProfile(data.session.user.id);
        if (mounted) applyProfile(profile);
      }
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      setSession(s);
      if (s?.user.id) {
        const profile = await fetchUserProfile(s.user.id);
        applyProfile(profile);
      } else {
        applyProfile({
          isAdmin: false,
          fullName: null,
          onboardingCompleted: false,
          businessOnboardingCompleted: false,
          subscriptionTier: null,
          activeStrategies: [],
        });
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [applyProfile]);

  const signIn: AuthState['signIn'] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUp: AuthState['signUp'] = async (email, password, fullName) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) throw error;
  };

  const signOut: AuthState['signOut'] = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const emailVerified = Boolean(session?.user.email_confirmed_at);

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        isAdmin,
        fullName,
        onboardingCompleted,
        businessOnboardingCompleted,
        subscriptionTier,
        activeStrategies,
        emailVerified,
        signIn,
        signUp,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
