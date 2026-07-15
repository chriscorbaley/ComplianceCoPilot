// Supabase Edge Function: send-cancellation-email
//
// Sends a confirmation email after a successful double-signature cancellation.
// Uses Resend (https://resend.com) — set RESEND_API_KEY and CANCELLATION_FROM_EMAIL
// as secrets. If RESEND_API_KEY is missing the function returns ok:true with
// emailed:false so the client flow still completes.
//
// Subject + body come from the admin-editable `email_templates` row with
// template_key='cancellation_confirm' (rendered with the user's real values).
// If that row is absent/unreadable the hardcoded copy below is used as a
// fallback.
//
// Deploy:
//   supabase functions deploy send-cancellation-email
//
// Required secrets:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   RESEND_API_KEY                 (optional — if absent, email is skipped)
//   CANCELLATION_FROM_EMAIL        (e.g. "Compliance Co-Pilot <no-reply@yourdomain.com>")

// deno-lint-ignore-file no-explicit-any
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL = Deno.env.get('CANCELLATION_FROM_EMAIL') ?? 'no-reply@example.com';

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// Substitute {placeholder} tokens with real values. Tokens without a matching
// key are left intact. (Mirror of renderTemplate in
// src/services/emailTemplates.ts — duplicated here because Edge Functions can't
// import the React Native service module.)
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
// copy below.
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

function buildEmailHtml(args: { name: string; deletionDate: string; documentCount: number }): string {
  return `
<!doctype html><html><body style="font-family: -apple-system, system-ui, sans-serif; color: #1a1a2e; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h1 style="color: #A32D2D; margin-bottom: 8px;">Subscription Cancelled</h1>
  <p>Hi ${args.name},</p>
  <p>This email confirms that your Compliance Co-Pilot subscription has been cancelled. You signed two acknowledgments before this took effect.</p>
  <div style="background:#FCEBEB;border-left:4px solid #A32D2D;padding:16px;border-radius:8px;margin:24px 0;">
    <p style="margin:0;"><strong>Your ${args.documentCount} compliance document${args.documentCount === 1 ? '' : 's'} will be permanently deleted on ${args.deletionDate}.</strong></p>
    <p style="margin:8px 0 0;">After that date, the documents cannot be recovered.</p>
  </div>
  <p>If this was a mistake or you have questions, reply to this email and we will help right away.</p>
  <p style="color:#6b7280;font-size:12px;margin-top:32px;">Compliance Co-Pilot</p>
</body></html>`;
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

  const { data: cancellation, error: cErr } = await admin
    .from('cancellations')
    .select('id, user_id, deletion_scheduled_for, document_count_at_cancellation')
    .eq('id', cancellationId)
    .maybeSingle();
  if (cErr || !cancellation) return json({ error: cErr?.message ?? 'not found' }, 404);

  const { data: userRow } = await admin
    .from('users')
    .select('email, full_name')
    .eq('id', (cancellation as any).user_id)
    .maybeSingle();
  const email = (userRow as any)?.email as string | null;
  const name = ((userRow as any)?.full_name as string | null) || (email?.split('@')[0] ?? 'there');
  if (!email) return json({ ok: true, emailed: false, reason: 'no email on user' });

  if (!RESEND_KEY) return json({ ok: true, emailed: false, reason: 'RESEND_API_KEY not set' });

  const deletionDate = formatDate((cancellation as any).deletion_scheduled_for as string);
  const documentCount = Number((cancellation as any).document_count_at_cancellation ?? 0);

  // Prefer the admin-editable template; fall back to the hardcoded copy so a
  // missing/unseeded row never blocks the cancellation email.
  const template = await fetchTemplate(admin, 'cancellation_confirm');
  let subject: string;
  let html: string;
  if (template) {
    const rendered = renderTemplate(template.subject, template.body_html, {
      user_name: name,
      deletion_date: deletionDate,
      document_count: documentCount,
    });
    subject = rendered.subject;
    html = rendered.html;
  } else {
    subject = 'Your Compliance Co-Pilot subscription has been cancelled';
    html = buildEmailHtml({ name, deletionDate, documentCount });
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
