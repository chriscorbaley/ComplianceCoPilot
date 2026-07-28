// RevenueCat integration. Native in-app purchases (Apple/Google) with receipt
// validation and subscription status handled by RevenueCat. This module owns
// SDK configuration, user identity, offerings, entitlements, and purchases.
//
// Entitlement → DB tier mapping. RevenueCat entitlements are named
// basic / core / pro; our DB subscription_tier values are starter / core / pro.
// The "basic" entitlement intentionally maps to the "starter" tier — this
// naming mismatch is existing and deliberate. Do NOT rename the DB values.
//
// Native module note: react-native-purchases requires native code, so it only
// works in a development / EAS build (prebuild), never in Expo Go. The SDK
// ships no Expo config plugin and needs none — Expo autolinking picks it up.

import { Linking, Platform } from 'react-native';
import Purchases, {
  LOG_LEVEL,
  REFUND_REQUEST_STATUS,
  type CustomerInfo,
  type PurchasesEntitlementInfo,
  type PurchasesOfferings,
  type PurchasesPackage,
  type MakePurchaseResult,
} from 'react-native-purchases';
import type { SubscriptionTier } from './supabase';

// RevenueCat entitlement identifiers configured in the RevenueCat dashboard.
export type RevenueCatEntitlement = 'basic' | 'core' | 'pro';

// Entitlement → DB tier. "basic" entitlement ⇒ "starter" tier (see header).
const ENTITLEMENT_TO_TIER: Record<RevenueCatEntitlement, SubscriptionTier> = {
  basic: 'starter',
  core: 'core',
  pro: 'pro',
};

// Rank for resolving the effective tier when more than one entitlement is
// somehow active at once — highest wins.
const ENTITLEMENT_RANK: Record<RevenueCatEntitlement, number> = {
  basic: 1,
  core: 2,
  pro: 3,
};

// Platform-specific public SDK keys. Supplied at build time as Expo public env
// vars; see .env. Missing keys leave the SDK unconfigured (all calls no-op).
const IOS_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
const ANDROID_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;

function apiKeyForPlatform(): string | undefined {
  if (Platform.OS === 'ios') return IOS_API_KEY;
  if (Platform.OS === 'android') return ANDROID_API_KEY;
  return undefined;
}

let configured = false;

/**
 * Configure the RevenueCat SDK. Safe to call once at app start (or after the
 * user is known). No-ops if already configured or if no API key is set for the
 * current platform. Optionally ties purchases to a known app user ID.
 */
export function configureRevenueCat(appUserId?: string | null): boolean {
  if (configured) return true;
  const apiKey = apiKeyForPlatform();
  if (!apiKey) {
    console.warn(
      `[RevenueCat] No API key for platform "${Platform.OS}". Set ` +
        'EXPO_PUBLIC_REVENUECAT_IOS_KEY / EXPO_PUBLIC_REVENUECAT_ANDROID_KEY. ' +
        'RevenueCat is disabled for this session.',
    );
    return false;
  }
  if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  Purchases.configure({
    apiKey,
    // When we already know the Supabase user, tie purchases to them from the
    // start. Otherwise RevenueCat generates an anonymous ID we later alias via
    // identifyRevenueCatUser() once the user logs in.
    appUserID: appUserId ?? undefined,
  });
  configured = true;
  return true;
}

export function isRevenueCatConfigured(): boolean {
  return configured;
}

/**
 * Point RevenueCat at our Supabase user_id so purchases and entitlements are
 * tied to the correct account across devices. Call after login. If the SDK
 * hasn't been configured yet (no key), this configures it with the user first.
 */
export async function identifyRevenueCatUser(
  appUserId: string,
): Promise<CustomerInfo | null> {
  if (!configured && !configureRevenueCat(appUserId)) return null;
  try {
    const { customerInfo } = await Purchases.logIn(appUserId);
    return customerInfo;
  } catch (err) {
    console.warn('[RevenueCat] logIn failed', err);
    return null;
  }
}

/**
 * Detach the current user from RevenueCat (reverts to an anonymous ID). Call on
 * sign-out so a shared device doesn't leak the previous user's entitlements.
 */
export async function logOutRevenueCatUser(): Promise<void> {
  if (!configured) return;
  try {
    await Purchases.logOut();
  } catch (err) {
    // logOut throws if already anonymous — harmless.
    console.warn('[RevenueCat] logOut skipped', err);
  }
}

/**
 * Fetch the current offerings (packages available to purchase). Returns null if
 * the SDK isn't configured or the fetch fails.
 */
export async function getOfferings(): Promise<PurchasesOfferings | null> {
  if (!configured) return null;
  try {
    return await Purchases.getOfferings();
  } catch (err) {
    console.warn('[RevenueCat] getOfferings failed', err);
    return null;
  }
}

/**
 * The DB tiers currently entitled to this user (empty if none/unconfigured),
 * derived from RevenueCat's active entitlements. Useful when a user could hold
 * more than one entitlement.
 */
export async function getActiveEntitlementTiers(): Promise<SubscriptionTier[]> {
  if (!configured) return [];
  try {
    const info = await Purchases.getCustomerInfo();
    return activeTiersFromCustomerInfo(info);
  } catch (err) {
    console.warn('[RevenueCat] getCustomerInfo failed', err);
    return [];
  }
}

/**
 * The single effective DB tier for this user (highest active entitlement), or
 * null if they hold none. This is the value to reconcile against
 * users.subscription_tier.
 */
export async function getActiveTier(): Promise<SubscriptionTier | null> {
  if (!configured) return null;
  try {
    const info = await Purchases.getCustomerInfo();
    return effectiveTierFromCustomerInfo(info);
  } catch (err) {
    console.warn('[RevenueCat] getCustomerInfo failed', err);
    return null;
  }
}

// Pure helpers so callers already holding a CustomerInfo (e.g. from a purchase
// result) can derive tiers without another round-trip.
export function activeTiersFromCustomerInfo(
  info: CustomerInfo,
): SubscriptionTier[] {
  const tiers: SubscriptionTier[] = [];
  for (const id of Object.keys(info.entitlements.active)) {
    const tier = ENTITLEMENT_TO_TIER[id as RevenueCatEntitlement];
    if (tier) tiers.push(tier);
  }
  return tiers;
}

export function effectiveTierFromCustomerInfo(
  info: CustomerInfo,
): SubscriptionTier | null {
  const active = Object.keys(info.entitlements.active).filter(
    (id): id is RevenueCatEntitlement => id in ENTITLEMENT_RANK,
  );
  if (active.length === 0) return null;
  const best = active.reduce((a, b) =>
    ENTITLEMENT_RANK[b] > ENTITLEMENT_RANK[a] ? b : a,
  );
  return ENTITLEMENT_TO_TIER[best];
}

// ─── Refund requests (Apple only) ──────────────────────────────────────────
// Apple's StoreKit2 beginRefundRequest(in:) sheet, surfaced by RevenueCat. iOS
// 15+ only; Android has no equivalent API (Google refunds go through the Play
// Store website), so callers must gate the UI on canRequestRefund().

/** True only where Apple's native refund sheet can actually be presented. */
export function canRequestRefund(): boolean {
  // iOS 15+ is required. Expo SDK 54 already floors iOS at 15.1, so the
  // platform check alone is sufficient; the SDK throws
  // UnsupportedPlatformError if that ever stops holding.
  return Platform.OS === 'ios' && configured;
}

export type RefundRequestResult =
  // Apple received the request (they decide the outcome later, by email).
  | 'submitted'
  // User dismissed Apple's sheet without submitting.
  | 'cancelled'
  // User holds no active entitlement, so there is nothing to refund.
  | 'no_subscription'
  // Not iOS / SDK unconfigured.
  | 'unsupported'
  | 'error';

/**
 * Present Apple's native refund request sheet for the user's current
 * subscription.
 *
 * Targets the *highest-ranked* active entitlement explicitly rather than using
 * beginRefundRequestForActiveEntitlement(), which errors out when a user holds
 * more than one active entitlement at once. Resolving the entitlement ourselves
 * makes the multi-entitlement case work instead of failing.
 */
export async function requestRefund(): Promise<RefundRequestResult> {
  if (!canRequestRefund()) return 'unsupported';
  try {
    const info = await Purchases.getCustomerInfo();
    const entitlement = highestActiveEntitlement(info);
    if (!entitlement) return 'no_subscription';

    const status = await Purchases.beginRefundRequestForEntitlement(entitlement);
    if (status === REFUND_REQUEST_STATUS.SUCCESS) return 'submitted';
    if (status === REFUND_REQUEST_STATUS.USER_CANCELLED) return 'cancelled';
    return 'error';
  } catch (err) {
    console.warn('[RevenueCat] beginRefundRequest failed', err);
    return 'error';
  }
}

/** The active entitlement with the highest tier rank, or null if none. */
function highestActiveEntitlement(
  info: CustomerInfo,
): PurchasesEntitlementInfo | null {
  const active = Object.values(info.entitlements.active).filter(
    (e) => e.identifier in ENTITLEMENT_RANK,
  );
  if (active.length === 0) return null;
  return active.reduce((a, b) =>
    ENTITLEMENT_RANK[b.identifier as RevenueCatEntitlement] >
    ENTITLEMENT_RANK[a.identifier as RevenueCatEntitlement]
      ? b
      : a,
  );
}

// ─── Manage subscription ───────────────────────────────────────────────────

// Google Play's subscription centre. Appending ?package= deep links straight to
// this app's subscription rather than the full list.
const PLAY_SUBSCRIPTIONS_URL = 'https://play.google.com/store/account/subscriptions';

export type ManageSubscriptionResult = 'opened' | 'unsupported' | 'error';

/**
 * Send the user to the store's subscription management UI.
 *
 * iOS: Apple's native showManageSubscriptions() sheet (iOS 13+). Falls back to
 * RevenueCat's managementURL, then Apple's web page, if the sheet can't open —
 * the sheet is unavailable in some contexts (e.g. sandbox StoreKit configs).
 * Android: deep links to Google Play's subscription page for this package.
 */
export async function openManageSubscriptions(): Promise<ManageSubscriptionResult> {
  if (Platform.OS === 'android') {
    const pkg = applicationId();
    const url = pkg ? `${PLAY_SUBSCRIPTIONS_URL}?package=${pkg}` : PLAY_SUBSCRIPTIONS_URL;
    return openUrl(url);
  }
  if (Platform.OS !== 'ios') return 'unsupported';

  try {
    await Purchases.showManageSubscriptions();
    return 'opened';
  } catch (err) {
    console.warn('[RevenueCat] showManageSubscriptions failed, falling back', err);
    return openUrl(await managementUrl());
  }
}

/**
 * RevenueCat's store-specific management URL for the current customer, falling
 * back to Apple's generic subscriptions page when RevenueCat has none (which is
 * the case before the user has ever purchased).
 */
async function managementUrl(): Promise<string> {
  const APPLE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';
  if (!configured) return APPLE_SUBSCRIPTIONS_URL;
  try {
    const info = await Purchases.getCustomerInfo();
    return info.managementURL ?? APPLE_SUBSCRIPTIONS_URL;
  } catch {
    return APPLE_SUBSCRIPTIONS_URL;
  }
}

async function openUrl(url: string): Promise<ManageSubscriptionResult> {
  try {
    await Linking.openURL(url);
    return 'opened';
  } catch (err) {
    console.warn('[RevenueCat] openURL failed', url, err);
    return 'error';
  }
}

/** Android package name, needed to deep link Play's subscription page. */
function applicationId(): string | null {
  // Required lazily rather than imported: expo-constants ships with `expo`
  // itself but isn't a declared dependency here, and the iOS path never needs
  // it. Guarded so a missing module degrades to the generic Play URL.
  try {
    const Constants = require('expo-constants').default;
    return (
      Constants?.expoConfig?.android?.package ??
      Constants?.expoConfig?.slug ??
      null
    );
  } catch {
    return null;
  }
}

export interface PurchaseOutcome {
  ok: boolean;
  // User cancelled the native purchase sheet (not an error to surface loudly).
  userCancelled: boolean;
  customerInfo: CustomerInfo | null;
  tier: SubscriptionTier | null;
  error?: unknown;
}

/**
 * Initiate a purchase for the given package. Returns a structured outcome so
 * callers can distinguish success, user-cancellation, and failure without
 * try/catch. On success, tier reflects the newly-effective entitlement.
 */
export async function purchasePackage(
  pkg: PurchasesPackage,
): Promise<PurchaseOutcome> {
  if (!configured) {
    return { ok: false, userCancelled: false, customerInfo: null, tier: null };
  }
  try {
    const result: MakePurchaseResult = await Purchases.purchasePackage(pkg);
    return {
      ok: true,
      userCancelled: false,
      customerInfo: result.customerInfo,
      tier: effectiveTierFromCustomerInfo(result.customerInfo),
    };
  } catch (err) {
    const userCancelled = Boolean(
      err && typeof err === 'object' && (err as { userCancelled?: boolean }).userCancelled,
    );
    if (!userCancelled) console.warn('[RevenueCat] purchase failed', err);
    return {
      ok: false,
      userCancelled,
      customerInfo: null,
      tier: null,
      error: err,
    };
  }
}
