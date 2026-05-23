import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase, type Session } from '../services/supabase';

interface AuthState {
  session: Session | null;
  loading: boolean;
  isAdmin: boolean;
  fullName: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

interface UserProfile {
  isAdmin: boolean;
  fullName: string | null;
}

async function fetchUserProfile(userId: string): Promise<UserProfile> {
  const { data, error } = await supabase
    .from('users')
    .select('is_admin, full_name')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return { isAdmin: false, fullName: null };
  const row = data as { is_admin?: boolean; full_name?: string | null };
  return { isAdmin: Boolean(row.is_admin), fullName: row.full_name ?? null };
}

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [fullName, setFullName] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session?.user.id) {
        const profile = await fetchUserProfile(data.session.user.id);
        if (mounted) {
          setIsAdmin(profile.isAdmin);
          setFullName(profile.fullName);
        }
      }
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      setSession(s);
      if (s?.user.id) {
        const profile = await fetchUserProfile(s.user.id);
        setIsAdmin(profile.isAdmin);
        setFullName(profile.fullName);
      } else {
        setIsAdmin(false);
        setFullName(null);
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

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

  return (
    <AuthContext.Provider value={{ session, loading, isAdmin, fullName, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
