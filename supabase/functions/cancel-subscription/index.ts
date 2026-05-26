// Supabase Edge Function: cancel-subscription
//
// Invoked from the client at the end of the double-signature cancellation
// flow. Looks up the cancellation record, then calls Stripe to cancel the
// subscription that was recorded on the users row.
//
// Deploy:
//   supabase functions deploy cancel-subscription
//
// Required secrets (set via `supabase secrets set`):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   STRIPE_SECRET_KEY

// deno-lint-ignore-file no-explicit-any
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

async function stripeCancelSubscription(subscriptionId: string): Promise<{ ok: boolean; error?: string }> {
  if (!STRIPE_KEY) return { ok: false, error: 'STRIPE_SECRET_KEY not set' };
  const r = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      'Stripe-Version': '2024-06-20',
    },
  });
  if (!r.ok) {
    const text = await r.text();
    return { ok: false, error: `Stripe ${r.status}: ${text || r.statusText}` };
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'Supabase env missing' }, 500);

  let body: { cancellation_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const cancellationId = body.cancellation_id;
  if (!cancellationId) return json({ error: 'cancellation_id required' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: cancellation, error: fetchErr } = await admin
    .from('cancellations')
    .select('id, user_id, stripe_subscription_id')
    .eq('id', cancellationId)
    .maybeSingle();
  if (fetchErr || !cancellation) {
    return json({ error: fetchErr?.message ?? 'cancellation not found' }, 404);
  }

  const subscriptionId = (cancellation as any).stripe_subscription_id as string | null;
  if (!subscriptionId) {
    // Nothing to cancel — record the no-op but consider it a success so the
    // client flow finishes cleanly. Free / pre-Stripe users land here.
    return json({ ok: true, cancelled: false, reason: 'no stripe_subscription_id on record' });
  }

  const result = await stripeCancelSubscription(subscriptionId);
  if (!result.ok) return json({ error: result.error ?? 'stripe error' }, 502);

  // Clear the subscription id on the user row so they don't appear active anymore.
  await admin
    .from('users')
    .update({ stripe_subscription_id: null })
    .eq('id', (cancellation as any).user_id);

  return json({ ok: true, cancelled: true });
});
