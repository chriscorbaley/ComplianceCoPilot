// Shared plumbing for every screen that sells a subscription (onboarding
// PaymentScreen, post-onboarding UpgradeConfirmScreen).
//
// Prices displayed to the user ALWAYS come from the store's own
// product.priceString — never from pricing_plans, which is copy/features only.
// The numeric helpers here exist solely to decide whether an annual-savings
// line can be shown truthfully; when they can't be trusted they return null and
// the caller shows nothing rather than guessing.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PurchasesPackage } from 'react-native-purchases';
import {
  getTierOfferings,
  type BillingPeriod,
  type TierOffering,
} from './revenueCat';
import type { SubscriptionTier } from './supabase';

export const PERIOD_LABEL: Record<BillingPeriod, string> = {
  monthly: 'Monthly',
  annual: 'Annual',
};

// Apple's Paid Applications Agreement §3.8(b) requires the subscription LENGTH
// to be stated before purchase, not just the price.
export const PERIOD_LENGTH: Record<BillingPeriod, string> = {
  monthly: 'Billed every month, renews automatically',
  annual: 'Billed every 12 months, renews automatically',
};

// ── Price helpers ───────────────────────────────────────────────────────────

// Best-effort parse of a formatted price ("$49.99", "1.234,56 €", "¥4900").
// Treats a trailing separator followed by 1–2 digits as the decimal point and
// everything else as a grouping separator. Returns null if nothing sane comes
// out.
export function parsePriceString(priceString: string): number | null {
  const cleaned = priceString.replace(/[^\d.,]/g, '');
  if (!cleaned) return null;
  const decimal = /^(.*)([.,])(\d{1,2})$/.exec(cleaned);
  const normalized = decimal
    ? `${decimal[1].replace(/[.,]/g, '')}.${decimal[3]}`
    : cleaned.replace(/[.,]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Numeric price for a package, used only for the annual-savings math. Prefers
// the store's own numeric `price` (same StoreProduct as priceString, but already
// parsed and locale-independent) and falls back to parsing priceString when the
// store omits it.
function numericPrice(pkg: PurchasesPackage): number | null {
  const raw = pkg.product.price;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  return parsePriceString(pkg.product.priceString);
}

// Percentage saved by paying annually instead of 12× monthly. Null when either
// price is unusable, the currencies differ (can't compare), or there is no real
// saving — we show nothing rather than an invented number.
export function annualSavingsPercent(
  monthly: PurchasesPackage | null,
  annual: PurchasesPackage | null,
): number | null {
  if (!monthly || !annual) return null;
  if (
    monthly.product.currencyCode &&
    annual.product.currencyCode &&
    monthly.product.currencyCode !== annual.product.currencyCode
  ) {
    return null;
  }
  const m = numericPrice(monthly);
  const a = numericPrice(annual);
  if (m === null || a === null) return null;
  const yearAtMonthly = m * 12;
  const pct = Math.round(((yearAtMonthly - a) / yearAtMonthly) * 100);
  return pct >= 1 ? pct : null;
}

const INTRO_UNIT_DAYS: Record<string, number> = {
  DAY: 1,
  WEEK: 7,
  MONTH: 30,
  YEAR: 365,
};

/**
 * Free-trial length in days as configured on the App Store / Play Console for
 * this product. The store's introductory offer is the only truthful source: if
 * it reports no free trial we say nothing about one, rather than promising a
 * trial the store will not actually grant.
 *
 * NOTE: a product declares its intro offer regardless of whether THIS user is
 * still eligible for it. An existing subscriber changing tiers has already used
 * the offer for that subscription group, so upgrade surfaces must not show trial
 * messaging even when this returns a number.
 */
export function freeTrialDays(pkg: PurchasesPackage | null): number | null {
  const intro = pkg?.product.introPrice;
  if (!intro || intro.price !== 0) return null;
  const perUnit = INTRO_UNIT_DAYS[String(intro.periodUnit).toUpperCase()];
  if (!perUnit || !Number.isFinite(intro.periodNumberOfUnits)) return null;
  const days = Math.round(perUnit * intro.periodNumberOfUnits);
  return days > 0 ? days : null;
}

/** Pull a human-readable message out of a RevenueCat/StoreKit error object. */
export function purchaseErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; underlyingErrorMessage?: unknown };
    if (typeof e.message === 'string' && e.message.trim()) return e.message;
    if (typeof e.underlyingErrorMessage === 'string' && e.underlyingErrorMessage.trim()) {
      return e.underlyingErrorMessage;
    }
  }
  return fallback;
}

// ── Offering state ──────────────────────────────────────────────────────────

export interface TierOfferingState {
  offering: TierOffering | null;
  loading: boolean;
  /** Offerings failed to load, or this tier has no purchasable package. */
  unavailable: boolean;
  period: BillingPeriod;
  setPeriod: (period: BillingPeriod) => void;
  /** The package for the currently-selected billing period, if any. */
  selectedPackage: PurchasesPackage | null;
  savingsPercent: number | null;
  reload: () => void;
}

/**
 * Load the purchasable packages for one tier and track the selected billing
 * period. Returns `unavailable` rather than throwing when offerings can't be
 * fetched (SDK unconfigured, store unreachable, tier missing from the offering)
 * so screens can render a retry state instead of crashing or showing blank.
 */
export function useTierOffering(tier: SubscriptionTier): TierOfferingState {
  const [offering, setOffering] = useState<TierOffering | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<BillingPeriod>('monthly');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    void (async () => {
      const tiers = await getTierOfferings();
      if (!mounted.current) return;
      const match = tiers.find((o) => o.tier === tier) ?? null;
      setOffering(match);
      // Default to monthly, but fall back to whichever period this tier
      // actually has a package for.
      if (match) setPeriod(match.monthly ? 'monthly' : 'annual');
      setLoading(false);
    })();
  }, [tier]);

  useEffect(() => {
    reload();
  }, [reload]);

  const selectedPackage =
    (period === 'monthly' ? offering?.monthly : offering?.annual) ?? null;

  return {
    offering,
    loading,
    unavailable: !loading && (!offering || (!offering.monthly && !offering.annual)),
    period,
    setPeriod,
    selectedPackage,
    savingsPercent: annualSavingsPercent(
      offering?.monthly ?? null,
      offering?.annual ?? null,
    ),
    reload,
  };
}
