// Supabase Edge Function: request-account-deletion
//
// Step 1 of the WEB deletion flow that Google Play requires: a deletion request
// page reachable without installing the app. An anonymous visitor types an
// email address here; this function records a pending request and, if that
// address actually has an account, emails its owner a one-time confirmation
// link. Clicking that link is what makes the request actionable — see
// confirm-account-deletion, which redeems the token and then calls
// delete-account service-role-side.
//
// The IN-APP path (Apple Guideline 5.1.1(v)) does not come through here at all:
// a signed-in user already holds a proven identity, so the app calls
// delete-account directly with its own JWT and deletion happens immediately.
//
// ─── Auth model — deploy WITH --no-verify-jwt ────────────────────────────────
// The caller is an anonymous visitor on a static GitHub Pages page with no
// Supabase session and no anon key, so there is no JWT to verify. That makes
// this function deliberately unauthenticated, and the design has to assume the
// input is attacker-controlled:
//
//   • The email address in the body proves nothing. It is never trusted as
//     identity — it only selects who gets *emailed*. Possession of the mailbox
//     is the actual authentication, and it is checked later, by
//     confirm-account-deletion, when the token comes back.
//   • Nothing here deletes anything. The only write is an unprivileged pending
//     row in deletion_requests.
//   • The response is constant (see below), so the endpoint cannot be used to
//     discover which addresses are registered.
//
// ─── The response must never reveal whether the email is registered ──────────
// This is the same reasoning as the nullable deletion_requests.user_id column.
// A row is written either way, the response body and status are byte-identical
// either way, and only the email send is conditional. Concretely:
//
//   • No match  → row with user_id null, no email, generic 200.
//   • Match     → row with user_id set, email scheduled, generic 200.
//   • Match but Resend fails or RESEND_API_KEY is unset → still the generic
//     200. A 502 here would fire ONLY for registered addresses, which would
//     hand an enumeration oracle back through the error path. Send failures are
//     logged for operators instead; the visitor is told to check their inbox.
//
// Genuine server errors (bad JSON, missing env, insert failure) DO return a
// non-200, because none of them correlate with whether an account exists.
//
// ─── …and the clock must not reveal it either ───────────────────────────────
// An identical response body is not enough on its own. If the Resend
// round-trip ran before the response, a registered address would answer
// measurably slower than an unregistered one, and the timing would leak
// exactly what the body withholds — an enumeration oracle with a stopwatch
// instead of a diff.
//
// So the send is handed to runAfterResponse() and the handler returns without
// waiting for it. Both paths now perform the same awaited work — one address
// lookup, one insert — and a match differs only by scheduling a promise, which
// is not a measurable amount of time. The email still goes out: waitUntil()
// keeps the isolate alive until it settles.
//
// ─── Token ───────────────────────────────────────────────────────────────────
// 32 bytes from crypto.getRandomValues(), hex-encoded. Not a UUID: as the
// account_deletion.sql header notes, a UUIDv4 spends bits on version/variant
// structure and is not meant to be an unguessable secret handed out in a URL.
// Expiry is TOKEN_TTL_HOURS below, which must stay 24 as long as the
// deletion_confirm copy says "expires 24 hours after it was sent".
//
// Deploy (JWT verification OFF — the caller is anonymous by design):
//   supabase functions deploy request-account-deletion --no-verify-jwt
// Schedule: none. Invoked by the public deletion request page.
//
// Requires supabase/account_deletion.sql to have been run (deletion_requests +
// the deletion_confirm template).
//
// Required secrets:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   RESEND_API_KEY                 (optional — if absent, email is skipped and
//                                   the response is unchanged)
//   DELETION_FROM_EMAIL            (e.g. "Compliance Co-Pilot <no-reply@yourdomain.com>")
//   DELETION_CONFIRM_LINK_BASE     (optional — the public page the link points at)

// deno-lint-ignore-file no-explicit-any
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL = Deno.env.get('DELETION_FROM_EMAIL') ?? 'Compliance Co-Pilot <noreply@send.thecopilot.app>';

// The public request page. The same page handles both halves of the flow: bare
// it shows the email form, with ?token=… it redeems the confirmation.
const CONFIRM_LINK_BASE = Deno.env.get('DELETION_CONFIRM_LINK_BASE') ??
  'https://chriscorbaley.github.io/ComplianceCoPilot/delete-account.html';

// Must match the "expires 24 hours after it was sent" line in the
// deletion_confirm template (seeded in supabase/account_deletion.sql and
// mirrored in FALLBACK_TEMPLATES). Change both together or the email lies.
const TOKEN_TTL_HOURS = 24;

// 32 bytes = 256 bits. Far past anything brute-forceable against a 24-hour
// single-use token.
const TOKEN_BYTES = 32;

// Upper bound on rows pulled back by the address lookup. The ilike below is an
// exact-match pattern, so in practice this is 0 or 1; the cap only bounds the
// pathological case described in findUserByEmail().
const EMAIL_MATCH_LIMIT = 25;

// The one and only thing this endpoint ever tells an anonymous caller.
const GENERIC_RESPONSE = {
  ok: true,
  message: 'If an account exists for this email, a confirmation link has been sent.',
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

// Fallback copy, used only if the deletion_confirm row is missing or
// unreadable. Same text and inline styles as the SQL seed and as
// FALLBACK_TEMPLATES in src/services/emailTemplates.ts — edit all three or they
// drift.
function buildConfirmEmailHtml(args: { name: string; confirmLink: string }): string {
  return `<!doctype html><html><body style="font-family:-apple-system,system-ui,sans-serif;color:#1a1a2e;max-width:560px;margin:0 auto;padding:24px;">
  <h1 style="color:#A32D2D;margin-bottom:8px;">Confirm account deletion</h1>
  <p>Hi ${args.name},</p>
  <p>We received a request to permanently delete your Compliance Co-Pilot account. Tap below to confirm.</p>
  <div style="background:#FCEBEB;border-left:4px solid #A32D2D;padding:16px;border-radius:8px;margin:24px 0;">
    <p style="margin:0;"><strong>This permanently deletes your account and every compliance record in it</strong> — documents, hours logs, business trips, meeting minutes, mileage, businesses and properties.</p>
    <p style="margin:8px 0 0;">It cannot be undone, and we cannot recover anything afterwards.</p>
  </div>
  <p><a href="${args.confirmLink}" style="display:inline-block;background:#A32D2D;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">Confirm account deletion</a></p>
  <p>For your security this link works once and expires 24 hours after it was sent.</p>
  <p><strong>Didn't request this?</strong> Ignore this email and nothing will happen. Your account stays exactly as it is.</p>
  <p>Deleting your account does not cancel an active App Store or Google Play subscription — cancel that in the store to stop billing.</p>
  <p style="color:#6b7280;font-size:12px;margin-top:32px;">Compliance Co-Pilot</p>
</body></html>`;
}

/**
 * Run `task` after the response has already been returned.
 *
 * This exists for the timing reason in the header, not for latency: the send
 * must not be on the measured path between request and response. The isolate
 * would normally be frozen the moment the handler returns, so EdgeRuntime's
 * waitUntil() is what keeps it alive until the promise settles.
 *
 * waitUntil is a Supabase runtime global rather than a Deno one, so it is read
 * off globalThis instead of imported; where it is absent (older local
 * `supabase functions serve`), the promise is left to run on its own and may be
 * cut short at teardown. Either way the rejection is swallowed here — an
 * unhandled rejection after the response would be logged as a crash rather
 * than as the send failure it actually is.
 */
function runAfterResponse(task: Promise<unknown>): void {
  const guarded = task.catch((err: unknown) => {
    console.error(
      '[request-account-deletion] deferred send threw: ' +
        (err instanceof Error ? err.message : String(err)),
    );
  });
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime && typeof runtime.waitUntil === 'function') {
    runtime.waitUntil(guarded);
  }
}

function generateToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Shape check only. This is not an attempt to validate deliverability — it just
// rejects obvious junk before a row is written. Note that rejecting a malformed
// address is not an enumeration leak: the verdict depends on the input alone,
// never on whether an account exists.
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320;
}

// Escape the LIKE metacharacters so an address is matched literally. Without
// this, `john_doe@x.com` would also match `johnXdoe@x.com`, and `_` is common
// in real addresses.
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Case-insensitive exact lookup of a public.users row by email.
 *
 * ilike does the case folding in Postgres, and the result is then re-checked in
 * JS against a lowercased comparison. That second pass is not redundant:
 * PostgREST rewrites `*` in a like/ilike value into `%`, which escapeLikePattern
 * cannot neutralise, so a pathological address could widen the pattern. The
 * JS equality check means a widened pattern can only ever yield NO match —
 * never somebody else's account.
 */
async function findUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<{ id: string; email: string; full_name: string | null } | null> {
  const { data, error } = await admin
    .from('users')
    .select('id, email, full_name')
    .ilike('email', escapeLikePattern(email))
    .limit(EMAIL_MATCH_LIMIT);

  // A lookup failure must not be reported to the caller — that would be an
  // oracle in its own right, and the pending row is still worth writing.
  if (error) {
    console.error(`[request-account-deletion] user lookup failed: ${error.message}`);
    return null;
  }

  const wanted = email.toLowerCase();
  const rows = (data ?? []) as Array<{ id: string; email: string | null; full_name: string | null }>;
  for (const row of rows) {
    if ((row.email ?? '').toLowerCase() === wanted) {
      return { id: row.id, email: row.email as string, full_name: row.full_name };
    }
  }
  return null;
}

/**
 * Send the deletion_confirm email. Never throws and never affects the response:
 * a send failure is an operator problem, not something the anonymous caller is
 * allowed to observe (see the enumeration note in the header).
 */
async function sendConfirmEmail(
  admin: SupabaseClient,
  args: { email: string; name: string; token: string },
): Promise<void> {
  if (!RESEND_KEY) {
    console.warn(
      '[request-account-deletion] RESEND_API_KEY not set — confirmation email NOT sent. ' +
        'The request row exists but the user can never confirm it.',
    );
    return;
  }

  const confirmLink = `${CONFIRM_LINK_BASE}?token=${encodeURIComponent(args.token)}`;

  // Prefer the admin-editable template; fall back to the hardcoded copy so a
  // missing/unseeded row never blocks the confirmation email.
  const template = await fetchTemplate(admin, 'deletion_confirm');
  let subject: string;
  let html: string;
  if (template) {
    const rendered = renderTemplate(template.subject, template.body_html, {
      user_name: args.name,
      confirm_link: confirmLink,
    });
    subject = rendered.subject;
    html = rendered.html;
  } else {
    subject = 'Confirm your Compliance Co-Pilot account deletion';
    html = buildConfirmEmailHtml({ name: args.name, confirmLink });
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [args.email],
        subject,
        html,
      }),
    });
    if (!r.ok) {
      const text = await r.text();
      console.error(
        `[request-account-deletion] Resend ${r.status}: ${text || r.statusText}`,
      );
      return;
    }
    console.log('[request-account-deletion] confirmation email sent');
  } catch (err) {
    console.error(
      '[request-account-deletion] Resend request threw: ' +
        (err instanceof Error ? err.message : String(err)),
    );
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'Supabase env missing' }, 500);

  let body: { email?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!email || !looksLikeEmail(email)) return json({ error: 'A valid email is required' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const match = await findUserByEmail(admin, email);
  const token = generateToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString();

  // Always written, match or not. The unmatched row is what lets the response
  // below be identical in both cases, and it also gives an operator a record
  // that someone tried to delete an address that has no account.
  const { error: insertErr } = await admin.from('deletion_requests').insert({
    email,
    user_id: match?.id ?? null,
    token,
    expires_at: expiresAt,
  });
  if (insertErr) {
    // Not an enumeration risk: an insert failure has nothing to do with whether
    // the address is registered. Surfacing it means the page can say "try
    // again" rather than claiming an email is on its way that will never come.
    console.error(`[request-account-deletion] insert failed: ${insertErr.message}`);
    return json({ error: 'Could not record the request. Please try again.' }, 500);
  }

  // Deliberately logged without the address: this table is the sensitive part
  // of the flow and the logs should not become a second copy of it.
  console.log(`[request-account-deletion] request recorded matched=${match !== null}`);

  if (match) {
    const name = (match.full_name && match.full_name.trim()) || match.email.split('@')[0] || 'there';
    // Deliberately NOT awaited — see the timing note in the header. Failures
    // are still logged inside sendConfirmEmail; they just cannot reach, or
    // slow down, the response.
    runAfterResponse(sendConfirmEmail(admin, { email: match.email, name, token }));
  }

  return json(GENERIC_RESPONSE);
});
