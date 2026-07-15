import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { supabase } from '../services/supabase';
import {
  defaultFeatureFlagMap,
  fetchFeatureFlagMap,
  REVIEW_MODE_FLAG_KEY,
  type FeatureFlagMap,
} from '../services/featureFlags';

// Global feature-flag layer. Fetches every flag from `feature_flags` on app
// start and keeps them live via a realtime subscription, so an admin toggling a
// flag propagates to all client apps within seconds — no restart needed.
//
// FAIL-OPEN: the map starts with every flag enabled and any missing flag reads
// as enabled, so a fetch failure never hides a feature. This is a global
// on/off switch that sits ON TOP OF subscription-tier gating; it never relaxes
// tier gating. A feature shows only when its flag is on AND the tier allows it.

export interface FeatureFlagState {
  flags: FeatureFlagMap;
  // True unless the flag is explicitly disabled. Unknown/missing flags → true.
  isEnabled: (flagKey: string) => boolean;
  loading: boolean;
}

const FeatureFlagContext = createContext<FeatureFlagState | null>(null);

export const FeatureFlagProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  // Start fail-open: every known flag enabled.
  const [flags, setFlags] = useState<FeatureFlagMap>(() => defaultFeatureFlagMap());
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    const load = async () => {
      const map = await fetchFeatureFlagMap();
      if (!mounted.current) return;
      // Merge fetched values over the fail-open defaults so a flag missing from
      // the response stays enabled rather than disappearing.
      setFlags((prev) => ({ ...prev, ...map }));
      setLoading(false);
    };

    void load();

    // Realtime: any insert/update/delete on feature_flags re-pulls the full set
    // so every client reflects an admin toggle within seconds.
    const channel = supabase
      .channel('feature-flags-stream-' + Date.now())
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'feature_flags' },
        () => {
          void load();
        },
      )
      .subscribe();

    return () => {
      mounted.current = false;
      supabase.removeChannel(channel);
    };
  }, []);

  const value = useMemo<FeatureFlagState>(
    () => ({
      flags,
      // Only an explicit `false` disables. Unknown flags default to enabled.
      isEnabled: (flagKey: string) => flags[flagKey] !== false,
      loading,
    }),
    [flags, loading],
  );

  return (
    <FeatureFlagContext.Provider value={value}>
      {children}
    </FeatureFlagContext.Provider>
  );
};

// Boolean hook for a single flag. Returns true when used outside the provider
// or when the flag is unknown — features stay visible unless explicitly turned
// off (fail open).
export function useFeatureFlag(flagKey: string): boolean {
  const ctx = useContext(FeatureFlagContext);
  if (!ctx) return true;
  return ctx.isEnabled(flagKey);
}

// App Store review mode. FAIL-CLOSED, and deliberately NOT built on
// useFeatureFlag (which fails open). Returns true ONLY when the review_mode row
// is explicitly enabled in the DB: outside the provider, before the flags have
// loaded, or when the row is missing it returns false, so review mode can never
// switch on by accident. review_mode is not in the fail-open default map, so
// flags[REVIEW_MODE_FLAG_KEY] is undefined until the real DB value arrives and
// the strict `=== true` keeps it off in every ambiguous case.
//
// It still rides the same realtime subscription as every other flag, so an
// admin flipping it in the panel reaches (and, crucially, LEAVES) every client
// app within seconds — a live kill switch.
export function useReviewMode(): boolean {
  const ctx = useContext(FeatureFlagContext);
  if (!ctx) return false;
  return ctx.flags[REVIEW_MODE_FLAG_KEY] === true;
}

// Full context accessor for callers that need the whole map or loading state.
export function useFeatureFlags(): FeatureFlagState {
  const ctx = useContext(FeatureFlagContext);
  if (!ctx) {
    const flags = defaultFeatureFlagMap();
    return {
      flags,
      isEnabled: (flagKey: string) => flags[flagKey] !== false,
      loading: false,
    };
  }
  return ctx;
}
