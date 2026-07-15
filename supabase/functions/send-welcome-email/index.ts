// Supabase Edge Function: send-welcome-email
//
// Sends a welcome / trial-started email after a user completes onboarding
// payment. Uses Resend (https://resend.com) — set RESEND_API_KEY and
// WELCOME_FROM_EMAIL as secrets. If RESEND_API_KEY is missing the function
// returns ok:true with emailed:false so the client flow still completes.
//
// Subject + body come from the admin-editable `email_templates` row with
// template_key='welcome' (rendered with the user's real values). If that row is
// absent/unreadable the hardcoded copy below is used as a fallback.
//
// Deploy:
//   supabase functions deploy send-welcome-email
//
// Required secrets:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   RESEND_API_KEY              (optional — if absent, email is skipped)
//   WELCOME_FROM_EMAIL          (e.g. "Compliance Co-Pilot <no-reply@yourdomain.com>")
//   WELCOME_APP_LINK            (optional — link rendered in CTA, defaults to https://compliancecopilot.com)

// deno-lint-ignore-file no-explicit-any
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL = Deno.env.get('WELCOME_FROM_EMAIL') ?? 'no-reply@example.com';
const APP_LINK = Deno.env.get('WELCOME_APP_LINK') ?? 'https://compliancecopilot.com';

const PLAN_PRICES: Record<string, number> = {
  starter: 49,
  core: 99,
  pro: 199,
};

const PLAN_NAMES: Record<string, string> = {
  starter: 'Starter',
  core: 'Core',
  pro: 'Pro',
};

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

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// Substitute {placeholder} tokens with real values. Tokens without a matching
// key are left intact so a missing value is visible rather than silently blank.
// (Mirror of renderTemplate in src/services/emailTemplates.ts — duplicated here
// because Edge Functions can't import the React Native service module.)
function renderTemplate(
  subject: string,
  bodyHtml: string,
  vars: Record<string, string | number>,
): { subject: string; html: string } {
  const apply = (s: string) =>
    s.replace(/\{(\w+)\}/g, (m, k: string) =>
      Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m,
    );
  return { subject: apply(subject), html: apply(bodyHtml) };
}

// Fetch the admin-editable template from email_templates. Returns null if the
// row is missing or unreadable so the caller can fall back to the hardcoded
// copy below and never fail to send.
async function fetchTemplate(
  admin: any,
  key: string,
): Promise<{ subject: string; body_html: string } | null> {
  try {
    const { data } = await admin
      .from('email_templates')
      .select('subject, body_html')
      .eq('template_key', key)
      .maybeSingle();
    if (data?.subject && data?.body_html) {
      return { subject: data.subject as string, body_html: data.body_html as string };
    }
  } catch {
    // fall through to null
  }
  return null;
}

function buildEmailHtml(args: {
  name: string;
  planName: string;
  planPrice: number;
  nextBillingDate: string;
  appLink: string;
}): string {
  return `
<!doctype html><html><body style="font-family: -apple-system, system-ui, sans-serif; color: #1a1a2e; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h1 style="color: #042C53; margin-bottom: 8px;">Welcome to Compliance Co-Pilot</h1>
  <p>Hi ${args.name},</p>
  <p>Your account is ready. Your 3-day free trial of <strong>${args.planName}</strong> has begun.</p>
  <div style="background:#F5F7FA;border-left:4px solid #185FA5;padding:16px;border-radius:8px;margin:24px 0;">
    <p style="margin:0;"><strong>Plan:</strong> ${args.planName}</p>
    <p style="margin:6px 0 0;"><strong>Price:</strong> $${args.planPrice}/month after trial</p>
    <p style="margin:6px 0 0;"><strong>Next billing date:</strong> ${args.nextBillingDate}</p>
  </div>
  <p>Open the app to set up your strategies and start tracking compliance:</p>
  <p><a href="${args.appLink}" style="display:inline-block;background:#042C53;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">Open Compliance Co-Pilot</a></p>
  <p>Questions? Reply to this email and we will help.</p>
  <p style="color:#6b7280;font-size:12px;margin-top:32px;">Compliance Co-Pilot</p>
</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'Supabase env missing' }, 500);

  let body: { user_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const userId = body.user_id;
  if (!userId) return json({ error: 'user_id required' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: userRow, error: userErr } = await admin
    .from('users')
    .select('email, full_name, subscription_tier, subscription_start')
    .eq('id', userId)
    .maybeSingle();
  if (userErr || !userRow) return json({ error: userErr?.message ?? 'user not found' }, 404);

  const email = (userRow as any).email as string | null;
  const name = ((userRow as any).full_name as string | null) || (email?.split('@')[0] ?? 'there');
  const tier = ((userRow as any).subscription_tier as string | null) ?? 'starter';
  if (!email) return json({ ok: true, emailed: false, reason: 'no email on user' });
  if (!RESEND_KEY) return json({ ok: true, emailed: false, reason: 'RESEND_API_KEY not set' });

  const subscriptionStart = (userRow as any).subscription_start as string | null;
  const start = subscriptionStart ? new Date(subscriptionStart) : new Date();
  const nextBilling = new Date(start.getTime() + 3 * 24 * 60 * 60 * 1000);

  const planName = PLAN_NAMES[tier] ?? tier;
  const planPrice = PLAN_PRICES[tier] ?? 0;
  const nextBillingDate = formatDate(nextBilling);

  // Prefer the admin-editable template; fall back to the hardcoded copy so a
  // missing/unseeded row never blocks the welcome email.
  const template = await fetchTemplate(admin, 'welcome');
  let subject: string;
  let html: string;
  if (template) {
    const rendered = renderTemplate(template.subject, template.body_html, {
      user_name: name,
      plan_name: planName,
      plan_price: `$${planPrice}`,
      trial_days: 3,
      next_billing_date: nextBillingDate,
      app_link: APP_LINK,
    });
    subject = rendered.subject;
    html = rendered.html;
  } else {
    subject = 'Welcome to Compliance Co-Pilot — your account is ready';
    html = buildEmailHtml({ name, planName, planPrice, nextBillingDate, appLink: APP_LINK });
  }

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [email],
      subject,
      html,
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    return json({ error: `Resend ${r.status}: ${text || r.statusText}` }, 502);
  }
  return json({ ok: true, emailed: true });
});
