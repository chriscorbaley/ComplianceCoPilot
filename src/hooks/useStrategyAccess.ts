import { useMemo } from 'react';
import { useAuth } from '../auth/AuthContext';
import type { SubscriptionTier } from '../services/supabase';

export interface StrategyAccess {
  activeStrategies: string[];
  tier: SubscriptionTier | null;
  isAdmin: boolean;
  isPro: boolean;
  hasStrategy: (key: string) => boolean;
  hasAnyStrategy: (keys: string[]) => boolean;
  requiredTierFor: (key: string) => 'Core' | 'Pro';
}

const TIER_STRATEGIES: Record<SubscriptionTier, Set<string> | null> = {
  starter: null,
  core: null,
  pro: null,
};

export function useStrategyAccess(): StrategyAccess {
  const { activeStrategies, subscriptionTier, isAdmin } = useAuth();

  return useMemo<StrategyAccess>(() => {
    const set = new Set(activeStrategies);
    return {
      activeStrategies,
      tier: subscriptionTier,
      isAdmin,
      isPro: isAdmin || subscriptionTier === 'pro',
      hasStrategy: (key: string) => isAdmin || set.has(key),
      hasAnyStrategy: (keys: string[]) => isAdmin || keys.some((k) => set.has(k)),
      requiredTierFor: () => (subscriptionTier === 'starter' ? 'Core' : 'Pro'),
    };
  }, [activeStrategies, subscriptionTier, isAdmin]);
}

// Map display strategy IDs (s1, s2, s3, …) used by the dashboard StrategyCard
// back to the canonical active_strategies keys stored on the user row.
export const DASHBOARD_STRATEGY_KEYS: Record<string, string> = {
  s1: 'real_estate',
  s2: 'augusta_rule',
  s3: 'business_travel',
};

// Silence unused export warning for TIER_STRATEGIES (placeholder for future
// tier→strategy gating beyond active_strategies). Remove if no longer needed.
void TIER_STRATEGIES;
