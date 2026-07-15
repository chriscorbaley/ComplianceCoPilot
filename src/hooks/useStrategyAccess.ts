import { useMemo } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useReviewMode } from '../context/FeatureFlagContext';
import type { SubscriptionTier } from '../services/supabase';

export interface StrategyAccess {
  activeStrategies: string[];
  tier: SubscriptionTier | null;
  isAdmin: boolean;
  isPro: boolean;
  // Voice logging is available to Core and Pro subscribers; admins (null tier)
  // count as Pro.
  canUseVoice: boolean;
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
  // App Store review mode grants Pro-level access to EVERY user at runtime so
  // reviewers can exercise every strategy, voice, mileage, and travel without a
  // paid tier. This overlays the access check ONLY — the stored
  // subscription_tier is never touched. useReviewMode is fail-closed, so when
  // review mode is off (the normal, production state) this changes nothing and
  // regular tier gating applies. We treat review-mode users as Pro, NOT admin,
  // so it never exposes admin-only surfaces.
  const reviewMode = useReviewMode();
  const proAccess = isAdmin || reviewMode;

  return useMemo<StrategyAccess>(() => {
    const set = new Set(activeStrategies);
    return {
      activeStrategies,
      tier: subscriptionTier,
      isAdmin,
      isPro: proAccess || subscriptionTier === 'pro',
      canUseVoice:
        proAccess || subscriptionTier === 'core' || subscriptionTier === 'pro',
      hasStrategy: (key: string) => proAccess || set.has(key),
      hasAnyStrategy: (keys: string[]) =>
        proAccess || keys.some((k) => set.has(k)),
      requiredTierFor: () => (subscriptionTier === 'starter' ? 'Core' : 'Pro'),
    };
  }, [activeStrategies, subscriptionTier, isAdmin, proAccess]);
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
