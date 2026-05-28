// Supabase Edge Function: stripe-webhook
//
// Receives Stripe webhook events and keeps the users.subscription_tier
// column in sync. Required by the real estate v2 update spec:
//
//   "A cancelled or failed subscription must downgrade subscription_tier
//    to 'starter' automatically."
//
// Mapped events:
//   • checkout.session.completed                → upgrade (starter|core|pro from price)
//   • customer.subscription.created             → same
//   • customer.subscription.updated             → re-evaluate from current price + status
//   • customer.subscription.deleted             → downgrade to 'starter'
//   • invoice.payment_failed                    → downgrade to 'starter' (with grace logic in client)
//
// User identification:
//   1. Try Stripe's `client_reference_id` on the checkout session (set to
//      the supabase user_id when the client opens checkout).
//   2. Otherwise look up users by `stripe_customer_id`.
//   3. As a last resort, look up users by `stripe_subscription_id`.
//
// Deploy:
//   supabase functions deploy stripe-webhook
//
// Required secrets:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   STRIPE_WEBHOOK_SECRET    (whsec_... — used to verify the signature)
//
// Optional secrets:
//   STRIPE_PRICE_CORE        (price_ID that maps to 'core' tier)
//   STRIPE_PRICE_PRO         (price_ID that maps to 'pro' tier)
//   STRIPE_PRICE_STARTER     (price_ID that maps to 'starter' tier; optional)
//
// If price→tier mapping isn't provided via env, the function falls back to
// matching the Stripe price nickname ("starter" / "core" / "pro") on the
// active subscription item.

// deno-lint-ignore-file no-explicit-any
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';

const PRICE_TIER: Record<string, 'starter' | 'core' | 'pro'> = {};
const cfgStarter = Deno.env.get('STRIPE_PRICE_STARTER');
const cfgCore = Deno.env.get('STRIPE_PRICE_CORE');
const cfgPro = Deno.env.get('STRIPE_PRICE_PRO');
if (cfgStarter) PRICE_TIER[cfgStarter] = 'starter';
if (cfgCore) PRICE_TIER[cfgCore] = 'core';
if (cfgPro) PRICE_TIER[cfgPro] = 'pro';

type Tier = 'starter' | 'core' | 'pro';

const supabase = SUPABASE_URL && SERVICE_ROLE
  ? createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
  : null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// ─── Stripe signature verification ─────────────────────────────────────────
// Stripe sends `Stripe-Signature: t=<ts>,v1=<sig>,…` where sig is HMAC-SHA256
// over `${ts}.${rawBody}` with the webhook secret. We verify manually to
// avoid pulling in the full stripe SDK.

async function verifyStripeSignature(
  rawBody: string,
  header: string | null,
): Promise<boolean> {
  if (!WEBHOOK_SECRET || !header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return i === -1 ? [p, ''] : [p.slice(0, i), p.slice(i + 1)];
    }),
  );
  const ts = parts.t;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${ts}.${rawBody}`));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(hex, v1);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ─── Tier resolution ───────────────────────────────────────────────────────

function priceToTier(priceId: string | null | undefined, nickname?: string | null): Tier | null {
  if (priceId && PRICE_TIER[priceId]) return PRICE_TIER[priceId];
  const n = (nickname ?? '').trim().toLowerCase();
  if (n === 'starter' || n === 'core' || n === 'pro') return n;
  return null;
}

function subscriptionItemPrice(sub: any): { id: string | null; nickname: string | null } {
  const item = sub?.items?.data?.[0];
  return {
    id: item?.price?.id ?? null,
    nickname: item?.price?.nickname ?? null,
  };
}

// ─── User lookup ───────────────────────────────────────────────────────────

interface MatchedUser {
  id: string;
}

async function findUser(opts: {
  userId?: string | null;
  customerId?: string | null;
  subscriptionId?: string | null;
}): Promise<MatchedUser | null> {
  if (!supabase) return null;
  if (opts.userId) {
    const { data } = await supabase
      .from('users')
      .select('id')
      .eq('id', opts.userId)
      .maybeSingle();
    if (data) return data as MatchedUser;
  }
  if (opts.customerId) {
    const { data } = await supabase
      .from('users')
      .select('id')
      .eq('stripe_customer_id', opts.customerId)
      .maybeSingle();
    if (data) return data as MatchedUser;
  }
  if (opts.subscriptionId) {
    const { data } = await supabase
      .from('users')
      .select('id')
      .eq('stripe_subscription_id', opts.subscriptionId)
      .maybeSingle();
    if (data) return data as MatchedUser;
  }
  return null;
}

// ─── Event handlers ────────────────────────────────────────────────────────

async function applyTierUpdate(
  user: MatchedUser,
  tier: Tier,
  status: 'trial' | 'active' | 'cancelled',
  fields: { customerId?: string | null; subscriptionId?: string | null } = {},
): Promise<void> {
  if (!supabase) return;
  const update: Record<string, unknown> = {
    subscription_tier: tier,
    subscription_status: status,
  };
  if (fields.customerId) update.stripe_customer_id = fields.customerId;
  if (fields.subscriptionId) update.stripe_subscription_id = fields.subscriptionId;
  if (tier !== 'starter' && status === 'active') {
    update.subscription_start = new Date().toISOString();
  }
  const { error } = await supabase.from('users').update(update).eq('id', user.id);
  if (error) console.error('[stripe-webhook] users update failed', error);
}

async function handleCheckoutCompleted(event: any): Promise<void> {
  const obj = event?.data?.object ?? {};
  const userId: string | null = obj.client_reference_id ?? null;
  const customerId: string | null = obj.customer ?? null;
  const subscriptionId: string | null = obj.subscription ?? null;
  const user = await findUser({ userId, customerId, subscriptionId });
  if (!user) {
    console.warn('[stripe-webhook] checkout.session.completed: no user match');
    return;
  }
  // Checkout doesn't include the subscription items inline. The followup
  // customer.subscription.created event will carry the price; for now, just
  // record the IDs so we can join them later.
  if (subscriptionId || customerId) {
    if (supabase) {
      await supabase.from('users').update({
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
      }).eq('id', user.id);
    }
  }
}

async function handleSubscriptionUpsert(event: any): Promise<void> {
  const sub = event?.data?.object ?? {};
  const customerId: string | null = sub.customer ?? null;
  const subscriptionId: string | null = sub.id ?? null;
  const status: string = sub.status ?? '';
  const user = await findUser({ customerId, subscriptionId });
  if (!user) {
    console.warn('[stripe-webhook] subscription event: no user match');
    return;
  }
  const { id: priceId, nickname } = subscriptionItemPrice(sub);
  const tier = priceToTier(priceId, nickname);
  if (!tier) {
    console.warn('[stripe-webhook] could not map price → tier', { priceId, nickname });
    return;
  }
  const cancelledStates = new Set(['canceled', 'unpaid', 'incomplete_expired']);
  if (cancelledStates.has(status)) {
    await applyTierUpdate(user, 'starter', 'cancelled', { customerId, subscriptionId });
  } else if (status === 'trialing') {
    await applyTierUpdate(user, tier, 'trial', { customerId, subscriptionId });
  } else {
    await applyTierUpdate(user, tier, 'active', { customerId, subscriptionId });
  }
}

async function handleSubscriptionDeleted(event: any): Promise<void> {
  const sub = event?.data?.object ?? {};
  const customerId: string | null = sub.customer ?? null;
  const subscriptionId: string | null = sub.id ?? null;
  const user = await findUser({ customerId, subscriptionId });
  if (!user) {
    console.warn('[stripe-webhook] subscription.deleted: no user match');
    return;
  }
  await applyTierUpdate(user, 'starter', 'cancelled', { customerId, subscriptionId });
}

async function handleInvoiceFailed(event: any): Promise<void> {
  const inv = event?.data?.object ?? {};
  const customerId: string | null = inv.customer ?? null;
  const subscriptionId: string | null = inv.subscription ?? null;
  const user = await findUser({ customerId, subscriptionId });
  if (!user) {
    console.warn('[stripe-webhook] invoice.payment_failed: no user match');
    return;
  }
  await applyTierUpdate(user, 'starter', 'cancelled', { customerId, subscriptionId });
}

// ─── Entry point ───────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!supabase) return json({ error: 'Supabase env missing' }, 500);

  const rawBody = await req.text();
  const signature = req.headers.get('stripe-signature');
  const verified = await verifyStripeSignature(rawBody, signature);
  if (!verified) return json({ error: 'invalid signature' }, 400);

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpsert(event);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event);
        break;
      case 'invoice.payment_failed':
        await handleInvoiceFailed(event);
        break;
      default:
        // No-op for events we don't care about — Stripe expects a 200.
        break;
    }
  } catch (e) {
    console.error('[stripe-webhook] handler threw', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }

  return json({ received: true });
});
