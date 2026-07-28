// Supabase Edge Function: revenuecat-webhook
//
// Receives RevenueCat webhook events and keeps users.subscription_tier /
// users.subscription_status in sync with native store purchases.
//
// WHY REVENUECAT AND NOT APPLE'S App Store Server Notifications V2:
//   • One function covers every store. RevenueCat normalizes Apple, Google and
//     Stripe into a single payload shape; raw ASSN V2 is iOS-only and would
//     need a second Google Play RTDN consumer to match.
//   • User matching is already solved. App.tsx calls
//     identifyRevenueCatUser(session.user.id), so `app_user_id` IS our
//     public.users.id. Raw Apple notifications only carry
//     originalTransactionId, which would require a separate mapping table.
//   • Verification is tractable. RevenueCat signs with a shared Authorization
//     header and/or HMAC-SHA256 — the same scheme stripe-webhook already
//     implements here. ASSN V2 requires verifying a JWS x5c certificate chain
//     against Apple's root CAs, which is a lot of crypto to get right (and to
//     keep working as Apple rotates certs).
//   • Single source of truth. RevenueCat is the purchase layer; reading
//     entitlements from anywhere else invites the two to disagree.
//
// EVENT NAME MAPPING (Apple ASSN → RevenueCat), since these differ:
//   REFUND             → CANCELLATION with cancel_reason = CUSTOMER_SUPPORT
//   DID_RENEW          → RENEWAL
//   EXPIRED            → EXPIRATION
//   DID_FAIL_TO_RENEW  → BILLING_ISSUE
//   CANCEL             → CANCELLATION with cancel_reason = UNSUBSCRIBE
//   (There is no standalone "REFUND" event type in RevenueCat.)
//
// ENTITLEMENT → TIER: RevenueCat entitlements are basic / core / pro; our DB
// tiers are starter / core / pro. "basic" maps to "starter" — this mismatch is
// deliberate and mirrors src/services/revenueCat.ts. Do NOT rename DB values.
//
// Deploy (JWT verification must be OFF — RevenueCat sends no Supabase JWT):
//   supabase functions deploy revenuecat-webhook --no-verify-jwt
//
// Required secrets (at least ONE of the two auth mechanisms):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   REVENUECAT_WEBHOOK_AUTH             Shared secret; must equal the
//                                       Authorization header set in the
//                                       RevenueCat dashboard.
//   REVENUECAT_WEBHOOK_SIGNING_SECRET   HMAC-SHA256 signing secret, if you
//                                       enabled signature verification.
//
// Optional secrets:
//   REVENUECAT_IGNORE_SANDBOX=true          Skip environment=SANDBOX events.
//                                           Leave unset while testing; set to
//                                           true before public launch.
//   REVENUECAT_REVOKE_ON_BILLING_ISSUE=true Downgrade immediately on
//                                           BILLING_ISSUE. Off by default: a
//                                           billing issue starts Apple/Google's
//                                           retry + grace period during which
//                                           the user still holds entitlement,
//                                           and EXPIRATION fires if the retries
//                                           are exhausted. Turning this on will
//                                           lock out paying customers who
//                                           recover from a declined card.
//
// Requires: supabase/revenuecat_webhook.sql (dedupe table + lookup column).

// deno-lint-ignore-file no-explicit-any
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const AUTH_HEADER_SECRET = Deno.env.get('REVENUECAT_WEBHOOK_AUTH') ?? '';
const SIGNING_SECRET = Deno.env.get('REVENUECAT_WEBHOOK_SIGNING_SECRET') ?? '';
const IGNORE_SANDBOX = Deno.env.get('REVENUECAT_IGNORE_SANDBOX') === 'true';
const REVOKE_ON_BILLING_ISSUE =
  Deno.env.get('REVENUECAT_REVOKE_ON_BILLING_ISSUE') === 'true';

// Reject HMAC-signed requests older than this to blunt replay attacks.
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

type Tier = 'starter' | 'core' | 'pro';
type Status = 'trial' | 'active' | 'cancelled';

// Mirrors ENTITLEMENT_TO_TIER in src/services/revenueCat.ts.
const ENTITLEMENT_TO_TIER: Record<string, Tier> = {
  basic: 'starter',
  core: 'core',
  pro: 'pro',
};

const ENTITLEMENT_RANK: Record<string, number> = { basic: 1, core: 2, pro: 3 };

const supabase = SUPABASE_URL && SERVICE_ROLE
  ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
  : null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// ─── Verification ──────────────────────────────────────────────────────────
// RevenueCat supports two independent mechanisms. We accept either, but fail
// closed if neither is configured — an unauthenticated endpoint that mutates
// subscription tiers would let anyone downgrade any user.

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * HMAC-SHA256 over `${timestamp}.${rawBody}`, sent as
 * `X-RevenueCat-Webhook-Signature: t=<unix_seconds>,v1=<hex>`.
 * Same construction as Stripe's, so this mirrors stripe-webhook.
 */
async function verifySignature(rawBody: string, header: string): Promise<boolean> {
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return i === -1 ? [p, ''] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const ts = parts.t;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
  if (!Number.isFinite(age) || age > SIGNATURE_TOLERANCE_SECONDS) {
    console.warn('[revenuecat-webhook] signature timestamp outside tolerance', ts);
    return false;
  }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}.${rawBody}`));
  const hex = [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return timingSafeEqual(hex, v1.toLowerCase());
}

async function authorize(req: Request, rawBody: string): Promise<boolean> {
  if (!AUTH_HEADER_SECRET && !SIGNING_SECRET) {
    console.error(
      '[revenuecat-webhook] refusing request: neither REVENUECAT_WEBHOOK_AUTH ' +
        'nor REVENUECAT_WEBHOOK_SIGNING_SECRET is set',
    );
    return false;
  }
  if (AUTH_HEADER_SECRET) {
    const header = req.headers.get('authorization') ?? '';
    if (!timingSafeEqual(header, AUTH_HEADER_SECRET)) return false;
  }
  if (SIGNING_SECRET) {
    const header = req.headers.get('x-revenuecat-webhook-signature');
    if (!header) return false;
    if (!(await verifySignature(rawBody, header))) return false;
  }
  return true;
}

// ─── Tier resolution ───────────────────────────────────────────────────────

/** Highest-ranked tier among the event's entitlement_ids, or null. */
function tierFromEntitlements(ids: unknown): Tier | null {
  if (!Array.isArray(ids)) return null;
  const known = ids.filter(
    (id): id is string => typeof id === 'string' && id in ENTITLEMENT_RANK,
  );
  if (known.length === 0) return null;
  const best = known.reduce((a, b) =>
    ENTITLEMENT_RANK[b] > ENTITLEMENT_RANK[a] ? b : a,
  );
  return ENTITLEMENT_TO_TIER[best];
}

/** TRIAL/INTRO periods are still active access, just not yet paid. */
function statusFromPeriodType(periodType: unknown): Status {
  return periodType === 'TRIAL' ? 'trial' : 'active';
}

function isExpired(expirationAtMs: unknown): boolean {
  return typeof expirationAtMs === 'number' && expirationAtMs <= Date.now();
}

// ─── User lookup ───────────────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve the event to a public.users row.
 *
 * app_user_id is set to the Supabase user id by identifyRevenueCatUser(), so
 * that is the primary key path. Anonymous RevenueCat ids ($RCAnonymousID:…)
 * are skipped — they belong to users who never signed in. aliases[] must also
 * be searched: after logIn() the anonymous id and the real id are aliases of
 * one another, and RevenueCat may send either as app_user_id.
 */
async function findUserId(event: any): Promise<string | null> {
  if (!supabase) return null;

  const candidates: string[] = [];
  for (const raw of [event?.app_user_id, event?.original_app_user_id, ...(Array.isArray(event?.aliases) ? event.aliases : [])]) {
    if (typeof raw === 'string' && UUID_RE.test(raw) && !candidates.includes(raw)) {
      candidates.push(raw);
    }
  }

  if (candidates.length > 0) {
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .in('id', candidates)
      .limit(1);
    if (error) throw error;
    if (data && data.length > 0) return data[0].id as string;
  }

  // Fallback: a user who purchased before signing in may only be reachable via
  // the store transaction id we recorded on a previous event.
  const originalTxn = event?.original_transaction_id;
  if (typeof originalTxn === 'string' && originalTxn) {
    const { data, error } = await supabase
      .from('users')
      .select('id')
      .eq('revenuecat_original_transaction_id', originalTxn)
      .limit(1);
    if (error) throw error;
    if (data && data.length > 0) return data[0].id as string;
  }

  return null;
}

// ─── Mutations ─────────────────────────────────────────────────────────────

async function applyTierUpdate(
  userId: string,
  tier: Tier,
  status: Status,
  originalTransactionId?: string | null,
): Promise<void> {
  if (!supabase) return;
  const update: Record<string, unknown> = {
    subscription_tier: tier,
    subscription_status: status,
  };
  if (originalTransactionId) {
    update.revenuecat_original_transaction_id = originalTransactionId;
  }
  if (tier !== 'starter' && status === 'active') {
    update.subscription_start = new Date().toISOString();
  }
  const { error } = await supabase.from('users').update(update).eq('id', userId);
  // Thrown, not swallowed: a failed write must produce a non-200 so RevenueCat
  // retries rather than silently leaving the tier wrong.
  if (error) throw error;
}

/**
 * Mark the subscription cancelled but leave the tier intact. Apple and Google
 * subscriptions stay usable until the paid period ends, so cancelling is not
 * revocation — EXPIRATION does that later.
 */
async function markCancelledKeepAccess(userId: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('users')
    .update({ subscription_status: 'cancelled' })
    .eq('id', userId);
  if (error) throw error;
}

/**
 * Best-effort audit trail. admin_id is nullable and references auth.users, so
 * we store the affected user there (the actor is the store, not an admin).
 * Never throws: losing an audit row must not cause an infinite retry loop.
 */
async function logAudit(
  userId: string | null,
  event: any,
  outcome: string,
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from('admin_audit_log').insert({
      admin_id: userId,
      action: 'apple_subscription_event',
      table_name: 'users',
      record_key: userId ?? event?.app_user_id ?? null,
      details: {
        source: 'revenuecat',
        outcome,
        event_id: event?.id ?? null,
        event_type: event?.type ?? null,
        event_timestamp_ms: event?.event_timestamp_ms ?? null,
        store: event?.store ?? null,
        environment: event?.environment ?? null,
        product_id: event?.product_id ?? null,
        entitlement_ids: event?.entitlement_ids ?? null,
        period_type: event?.period_type ?? null,
        expiration_at_ms: event?.expiration_at_ms ?? null,
        cancel_reason: event?.cancel_reason ?? null,
        expiration_reason: event?.expiration_reason ?? null,
        original_transaction_id: event?.original_transaction_id ?? null,
        app_user_id: event?.app_user_id ?? null,
      },
    });
  } catch (e) {
    console.error('[revenuecat-webhook] audit log insert failed', e);
  }
}

/**
 * Idempotency gate. RevenueCat reuses the same event id across its 5 retries,
 * and duplicate deliveries are expected. Returns true if this event is new.
 */
async function claimEvent(event: any): Promise<boolean> {
  if (!supabase) return false;
  const eventId = event?.id;
  if (typeof eventId !== 'string' || !eventId) return true; // can't dedupe; process
  const { error } = await supabase.from('revenuecat_webhook_events').insert({
    event_id: eventId,
    event_type: event?.type ?? null,
    app_user_id: event?.app_user_id ?? null,
  });
  if (!error) return true;
  // 23505 = unique_violation → already processed.
  if ((error as any).code === '23505') return false;
  throw error;
}

// ─── Event routing ─────────────────────────────────────────────────────────

// Store the tier as-is; these all represent an active, paid-up subscription.
const GRANTING_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'PRODUCT_CHANGE',
  'SUBSCRIPTION_EXTENDED',
  'REFUND_REVERSED',
  'NON_RENEWING_PURCHASE',
  'TEMPORARY_ENTITLEMENT_GRANT',
]);

// Analytics/paywall noise we acknowledge without touching the DB.
const IGNORED_EVENTS = new Set([
  'TEST',
  'PAYWALL_IMPRESSION',
  'PAYWALL_CLOSE',
  'PAYWALL_CANCEL',
  'PAYWALL_EXIT_OFFER',
  'PAYWALL_COMPONENT_INTERACTED',
  'EXPERIMENT_ENROLLMENT',
  'INVOICE_ISSUANCE',
  'VIRTUAL_CURRENCY_TRANSACTION',
  'SUBSCRIBER_ALIAS',
  'PRICE_INCREASE_CONSENT_REQUIRED',
  'PRICE_INCREASE_CONSENT_APPROVED',
]);

/** Returns a short outcome string for the audit log. */
async function handleEvent(userId: string, event: any): Promise<string> {
  const type: string = event?.type ?? '';
  const originalTxn: string | null = event?.original_transaction_id ?? null;

  if (GRANTING_EVENTS.has(type)) {
    const tier = tierFromEntitlements(event?.entitlement_ids);
    if (!tier) {
      // entitlement_ids can be null when a product has no entitlement mapped in
      // the RevenueCat dashboard. Don't guess — leave the tier alone.
      console.warn('[revenuecat-webhook] no mappable entitlement', {
        type,
        entitlement_ids: event?.entitlement_ids,
        product_id: event?.product_id,
      });
      return 'skipped_no_entitlement_mapping';
    }
    await applyTierUpdate(userId, tier, statusFromPeriodType(event?.period_type), originalTxn);
    return `granted_${tier}`;
  }

  switch (type) {
    case 'CANCELLATION': {
      // A store-issued refund arrives here as cancel_reason CUSTOMER_SUPPORT.
      // That is the one cancellation that revokes access immediately — the
      // money is already back with the customer.
      const refunded = event?.cancel_reason === 'CUSTOMER_SUPPORT';
      if (refunded || isExpired(event?.expiration_at_ms)) {
        await applyTierUpdate(userId, 'starter', 'cancelled', originalTxn);
        return refunded ? 'revoked_refund' : 'revoked_cancel_already_expired';
      }
      // Voluntary cancellation: Apple/Google keep the subscription usable until
      // the paid period ends, so flag it but keep the tier.
      await markCancelledKeepAccess(userId);
      return 'cancelled_access_until_period_end';
    }

    case 'EXPIRATION': {
      await applyTierUpdate(userId, 'starter', 'cancelled', originalTxn);
      return 'revoked_expired';
    }

    case 'BILLING_ISSUE': {
      if (REVOKE_ON_BILLING_ISSUE) {
        await applyTierUpdate(userId, 'starter', 'cancelled', originalTxn);
        return 'revoked_billing_issue';
      }
      // Default: the store is still retrying the charge and the user keeps
      // entitlement through the grace period. EXPIRATION revokes if it fails.
      await markCancelledKeepAccess(userId);
      return 'billing_issue_grace_period';
    }

    case 'SUBSCRIPTION_PAUSED': {
      // Play Store only. Pause takes effect at period end, like a cancellation.
      await markCancelledKeepAccess(userId);
      return 'paused_access_until_period_end';
    }

    case 'TRANSFER': {
      // Entitlements moved between App User IDs (e.g. a shared family device).
      // Reassigning tiers here needs both sides of the transfer and is not
      // something this app can currently produce, so record it for review.
      console.warn('[revenuecat-webhook] TRANSFER received; manual review', {
        transferred_from: event?.transferred_from,
        transferred_to: event?.transferred_to,
      });
      return 'transfer_logged_only';
    }

    default: {
      if (IGNORED_EVENTS.has(type)) return 'ignored';
      console.warn('[revenuecat-webhook] unhandled event type', type);
      return 'unhandled';
    }
  }
}

// ─── Entry point ───────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!supabase) return json({ error: 'Supabase env missing' }, 500);

  const rawBody = await req.text();
  if (!(await authorize(req, rawBody))) {
    return json({ error: 'unauthorized' }, 401);
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }

  const event = payload?.event;
  if (!event || typeof event !== 'object') {
    return json({ error: 'missing event' }, 400);
  }

  // Sandbox purchases must not move production tiers once you're live.
  if (IGNORE_SANDBOX && event.environment === 'SANDBOX') {
    // Logged so a filtered sandbox event is distinguishable from a silent
    // failure: this path writes no dedupe row and no audit row, so without
    // this line it is indistinguishable from a duplicate in the logs.
    console.log('[revenuecat-webhook] ignored sandbox event', {
      id: event.id,
      type: event.type,
      app_user_id: event.app_user_id,
    });
    return json({ received: true, outcome: 'ignored_sandbox' });
  }

  try {
    if (!(await claimEvent(event))) {
      // Duplicate delivery — already handled. 200 stops the retry chain.
      return json({ received: true, outcome: 'duplicate' });
    }

    const userId = await findUserId(event);
    if (!userId) {
      // 200, not an error: an unmatched user won't resolve on retry (most often
      // an anonymous purchaser who never signed in), and 5 pointless retries
      // just delay real events. The audit row records it for review.
      console.warn('[revenuecat-webhook] no user match', {
        type: event.type,
        app_user_id: event.app_user_id,
      });
      await logAudit(null, event, 'no_user_match');
      return json({ received: true, outcome: 'no_user_match' });
    }

    const outcome = await handleEvent(userId, event);
    await logAudit(userId, event, outcome);
    return json({ received: true, outcome });
  } catch (e) {
    // 5xx so RevenueCat retries (5, 10, 20, 40, 80 min). The dedupe row is
    // rolled back below so the retry can re-claim the event.
    console.error('[revenuecat-webhook] handler threw', e);
    if (typeof event?.id === 'string' && event.id) {
      try {
        await supabase
          .from('revenuecat_webhook_events')
          .delete()
          .eq('event_id', event.id);
      } catch (delErr) {
        // Best effort. If this fails the retry is dropped as a duplicate, which
        // is why the audit log records every outcome.
        console.error('[revenuecat-webhook] could not release dedupe row', delErr);
      }
    }
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
