// Subscription pricing lives in the Supabase `pricing_plans` table so prices,
// trial lengths, and feature bullets can be edited from the Admin panel without
// shipping a new build. The hardcoded PRICING_FALLBACK below is the SHIPPED
// safety net: if the table read ever fails (offline, RLS, cold start) every
// pricing surface — onboarding, upgrade flow, locked screens — still renders the
// last-known-good values and never breaks.
//
// IMPORTANT: `plan_key` is the stable identity used for ALL subscription_tier
// gating logic ('starter' | 'core' | 'pro'). Only the DISPLAYED name and price
// come from the table. plan_key 'starter' maps to display_name 'Basic'; the
// database value stays 'starter' everywhere gating is concerned.

import { useEffect, useState } from 'react';
import { supabase, type SubscriptionTier } from './supabase';

export interface PricingPlan {
  plan_key: SubscriptionTier;
  display_name: string;
  monthly_price: number;
  trial_days: number;
  sort_order: number;
  features: string[];
  is_active: boolean;
}

// ── Fallback plans (shipped in the binary) ──────────────────────────────────
// Mirrors the values the app previously hardcoded. Ordered by sort_order.
export const PRICING_FALLBACK: Record<SubscriptionTier, PricingPlan> = {
  starter: {
    plan_key: 'starter',
    display_name: 'Basic',
    monthly_price: 49,
    trial_days: 3,
    sort_order: 1,
    features: [
      '1 tax strategy',
      'AI document generator',
      'Strategy-specific compliance checklists',
      'Document storage',
    ],
    is_active: true,
  },
  core: {
    plan_key: 'core',
    display_name: 'Core',
    monthly_price: 99,
    trial_days: 3,
    sort_order: 2,
    features: [
      'Up to 3 tax strategies',
      'All Basic features',
      'Strategy progress tracking',
      'Priority support',
    ],
    is_active: true,
  },
  pro: {
    plan_key: 'pro',
    display_name: 'Pro',
    monthly_price: 199,
    trial_days: 3,
    sort_order: 3,
    features: [
      'All strategies',
      'AI voice meeting minutes',
      'Complete audit trail',
      'Mileage tracker with IRS deduction calculator',
      'All Core and Basic features',
    ],
    is_active: true,
  },
};

const FALLBACK_LIST: PricingPlan[] = [
  PRICING_FALLBACK.starter,
  PRICING_FALLBACK.core,
  PRICING_FALLBACK.pro,
];

// ── Normalization ───────────────────────────────────────────────────────────

// The `features` jsonb column is an array. Accept either plain strings or
// `{ text }` objects and coerce to a clean string[]. Anything else is dropped.
export function normalizeFeatures(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((f) => {
      if (typeof f === 'string') return f;
      if (f && typeof f === 'object' && typeof (f as { text?: unknown }).text === 'string') {
        return (f as { text: string }).text;
      }
      return '';
    })
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Coerce a raw DB row into a typed PricingPlan. `monthly_price` and `trial_days`
// may arrive as strings (Postgres numeric) so they are Number()-coerced.
function normalizePlan(row: Record<string, unknown>): PricingPlan | null {
  const key = row.plan_key;
  if (key !== 'starter' && key !== 'core' && key !== 'pro') return null;
  const fallback = PRICING_FALLBACK[key];
  const price = Number(row.monthly_price);
  const trial = Number(row.trial_days);
  const sort = Number(row.sort_order);
  return {
    plan_key: key,
    display_name:
      typeof row.display_name === 'string' && row.display_name.trim()
        ? row.display_name
        : fallback.display_name,
    monthly_price: Number.isFinite(price) ? price : fallback.monthly_price,
    trial_days: Number.isFinite(trial) ? trial : fallback.trial_days,
    sort_order: Number.isFinite(sort) ? sort : fallback.sort_order,
    features: normalizeFeatures(row.features),
    is_active: row.is_active !== false,
  };
}

// Format a monthly price for display: integers show without decimals ($99),
// fractional prices show cents ($99.50).
export function formatPrice(price: number): string {
  return Number.isInteger(price) ? `$${price}` : `$${price.toFixed(2)}`;
}

// ── Reads ───────────────────────────────────────────────────────────────────

// Fetch the active plans ordered by sort_order. Returns the shipped fallback on
// any error or if no active rows exist so callers can render unconditionally.
export async function fetchActivePricingPlans(): Promise<PricingPlan[]> {
  try {
    const { data, error } = await supabase
      .from('pricing_plans')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error || !data || data.length === 0) return FALLBACK_LIST;
    const plans = (data as Record<string, unknown>[])
      .map(normalizePlan)
      .filter((p): p is PricingPlan => p !== null);
    return plans.length > 0 ? plans : FALLBACK_LIST;
  } catch {
    return FALLBACK_LIST;
  }
}

export interface PricingPlansState {
  // Active plans in sort order — what the Choose Your Plan grid renders.
  plans: PricingPlan[];
  // Every tier resolved (DB row merged over fallback) for direct price lookups
  // like `byKey.core.monthly_price`. Always contains all three tiers.
  byKey: Record<SubscriptionTier, PricingPlan>;
  loading: boolean;
  error: string | null;
}

// Hook for any screen that shows a price. Starts with the fallback (so the first
// paint is never empty) then swaps in the live values once the fetch resolves.
export function usePricingPlans(): PricingPlansState {
  const [plans, setPlans] = useState<PricingPlan[]>(FALLBACK_LIST);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error: e } = await supabase
          .from('pricing_plans')
          .select('*')
          .eq('is_active', true)
          .order('sort_order', { ascending: true });
        if (cancelled) return;
        if (e || !data || data.length === 0) {
          setPlans(FALLBACK_LIST);
          setError(e?.message ?? null);
        } else {
          const normalized = (data as Record<string, unknown>[])
            .map(normalizePlan)
            .filter((p): p is PricingPlan => p !== null);
          setPlans(normalized.length > 0 ? normalized : FALLBACK_LIST);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setPlans(FALLBACK_LIST);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Merge active rows over the fallback so a tier missing from the fetch (e.g.
  // toggled inactive by an admin) still resolves to a sensible price/name.
  const byKey: Record<SubscriptionTier, PricingPlan> = {
    starter: PRICING_FALLBACK.starter,
    core: PRICING_FALLBACK.core,
    pro: PRICING_FALLBACK.pro,
  };
  for (const p of plans) byKey[p.plan_key] = p;

  return { plans, byKey, loading, error };
}

// ── Admin writes ─────────────────────────────────────────────────────────────

export interface PricingPlanUpdate {
  display_name?: string;
  monthly_price?: number;
  trial_days?: number;
  features?: string[];
  is_active?: boolean;
  sort_order?: number;
}

// Fetch ALL plans (active + inactive) for the Admin editor.
export async function fetchAllPricingPlans(): Promise<PricingPlan[]> {
  const { data, error } = await supabase
    .from('pricing_plans')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return ((data as Record<string, unknown>[]) ?? [])
    .map(normalizePlan)
    .filter((p): p is PricingPlan => p !== null);
}

// Persist an edit to a plan and best-effort append an entry to admin_audit_log.
// The audit insert is wrapped so a missing admin_audit_log table (the "if that
// table exists" case) never blocks the pricing update.
export async function updatePricingPlan(
  planKey: SubscriptionTier,
  updates: PricingPlanUpdate,
  adminUserId: string | null,
): Promise<void> {
  // Snapshot the current values for the audit "before" record.
  let before: Record<string, unknown> | null = null;
  try {
    const { data } = await supabase
      .from('pricing_plans')
      .select('display_name, monthly_price, trial_days, features, is_active, sort_order')
      .eq('plan_key', planKey)
      .maybeSingle();
    before = (data as Record<string, unknown> | null) ?? null;
  } catch {
    before = null;
  }

  const { error } = await supabase
    .from('pricing_plans')
    .update(updates)
    .eq('plan_key', planKey);
  if (error) throw error;

  // Best-effort audit log. Ignore any failure (table absent, RLS, offline) so
  // it never blocks the price change itself.
  try {
    await supabase.from('admin_audit_log').insert({
      admin_id: adminUserId,
      action: 'update_pricing_plan',
      table_name: 'pricing_plans',
      record_key: planKey,
      details: { before, after: updates },
    });
  } catch {
    /* admin_audit_log may not exist — pricing update already succeeded */
  }
}
