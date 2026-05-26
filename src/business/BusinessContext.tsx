// Multi-business state: list of businesses for the signed-in user plus the
// currently active business. The active id is persisted in AsyncStorage so the
// app comes back to the same business across launches.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, type BusinessRow } from '../services/supabase';
import { useAuth } from '../auth/AuthContext';

const ACTIVE_BUSINESS_KEY = 'ccp.activeBusinessId';

interface BusinessState {
  businesses: BusinessRow[];
  activeBusinessId: string | null;
  activeBusiness: BusinessRow | null;
  loading: boolean;
  setActiveBusinessId: (id: string | null) => void;
  refresh: () => Promise<void>;
}

const BusinessContext = createContext<BusinessState | null>(null);

export const BusinessProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [businesses, setBusinesses] = useState<BusinessRow[]>([]);
  const [activeBusinessId, setActiveBusinessIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const setActiveBusinessId = useCallback((id: string | null) => {
    setActiveBusinessIdState(id);
    if (id) AsyncStorage.setItem(ACTIVE_BUSINESS_KEY, id).catch(() => undefined);
    else AsyncStorage.removeItem(ACTIVE_BUSINESS_KEY).catch(() => undefined);
  }, []);

  const loadBusinesses = useCallback(async (uid: string): Promise<BusinessRow[]> => {
    const { data, error } = await supabase
      .from('businesses')
      .select('*')
      .eq('user_id', uid)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as BusinessRow[];
  }, []);

  // Pick the right active business after a list refresh: prefer the persisted
  // id, then the default flag, then the first business in the list.
  const resolveActiveId = useCallback(
    async (list: BusinessRow[]): Promise<string | null> => {
      if (list.length === 0) return null;
      const persisted = await AsyncStorage.getItem(ACTIVE_BUSINESS_KEY).catch(() => null);
      if (persisted && list.some((b) => b.id === persisted)) return persisted;
      const def = list.find((b) => b.is_default);
      return (def ?? list[0]).id;
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (!userId) {
      setBusinesses([]);
      setActiveBusinessIdState(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await loadBusinesses(userId);
      setBusinesses(list);
      const next = await resolveActiveId(list);
      setActiveBusinessIdState(next);
      if (next) AsyncStorage.setItem(ACTIVE_BUSINESS_KEY, next).catch(() => undefined);
    } catch {
      setBusinesses([]);
      setActiveBusinessIdState(null);
    } finally {
      setLoading(false);
    }
  }, [userId, loadBusinesses, resolveActiveId]);

  // Reload whenever the signed-in user changes.
  useEffect(() => {
    refresh();
  }, [refresh]);

  const activeBusiness = useMemo(
    () => businesses.find((b) => b.id === activeBusinessId) ?? null,
    [businesses, activeBusinessId],
  );

  return (
    <BusinessContext.Provider
      value={{
        businesses,
        activeBusinessId,
        activeBusiness,
        loading,
        setActiveBusinessId,
        refresh,
      }}
    >
      {children}
    </BusinessContext.Provider>
  );
};

export function useBusiness(): BusinessState {
  const ctx = useContext(BusinessContext);
  if (!ctx) throw new Error('useBusiness must be used inside BusinessProvider');
  return ctx;
}
