// Supabase Edge Function: confirm-account-deletion
//
// Step 2 — the last step — of the WEB deletion flow that Google Play requires.
// request-account-deletion recorded a pending deletion_requests row and emailed
// its token to the address's owner. This function redeems that token: it is
// what turns "somebody typed this address into a form" into "the person who
// can read that mailbox asked for this".
//
// Possession of the token IS the authentication. Nothing else in this flow
// proves identity — the email address in step 1 was attacker-controllable, so
// every guard that matters lives here.
//
//   1. Atomically claim the token (see below). Invalid/spent/expired → one
//      generic failure.
//   2. Read the account's display name while the account still exists.
//   3. Call delete-account server-to-server with the service-role key.
//   4. Email deletion_complete to the address stored on the request row.
//
// ─── Auth model — deploy WITH --no-verify-jwt ────────────────────────────────
// Same caller as request-account-deletion: an anonymous visitor on a static
// GitHub Pages page with no Supabase session and no anon key. There is no JWT
// to verify, so the token in the body is the entire credential. That is why it
// is 256 bits of CSPRNG output, single-use and short-lived — see the token
// notes in supabase/account_deletion.sql.
//
// This function holds the service-role key and can delete any account, so the
// body is treated as hostile: the token is never interpolated into a query, is
// only ever used as an equality filter, and the user_id acted on comes from the
// matched ROW, never from the request.
//
// ─── Claiming the token is one atomic statement ──────────────────────────────
// The lookup and the consume are deliberately NOT two steps. A select-then-
// update leaves a window in which a double-clicked link (or a retried POST)
// passes the validity check twice and fires two concurrent deletions. Instead a
// single conditional UPDATE does both:
//
//   update deletion_requests set consumed_at = now()
//    where token = $1 and consumed_at is null and expires_at > now()
//   returning id, email, user_id
//
// Postgres locks the row for the duration, so of two simultaneous requests
// exactly one sees consumed_at still null and updates; the other re-reads the
// committed row, fails the predicate and matches zero rows. The returned row is
// the proof of a successful claim — there is no separate "is it valid?" answer
// that could go stale between the check and the act.
//
// It also collapses the three failure cases into one indistinguishable path:
// unknown token, already-consumed token and expired token all come back as zero
// rows from the same single statement, so they cost the same work and produce
// the same bytes. The page shows one message. Telling them apart would confirm
// to a token-guesser that a value had once been real, and would let anyone
// probe whether a given link had already been used.
//
// ─── A token consumed by a deletion that then failed ─────────────────────────
// Claiming before deleting means a delete-account failure leaves a spent token
// and an account still standing. That is the right trade, but it must not be a
// dead end, so:
//
//   • The token is NOT un-consumed. Rolling consumed_at back would re-arm a
//     link that has already been emailed, on the strength of an error we may
//     have misread — a timeout or a dropped response can mean the deletion
//     actually succeeded. Re-arming a credential on ambiguous evidence is the
//     wrong default for an irreversible action.
//   • The path forward is a NEW request. delete-account deletes the auth row
//     last, so a failure there leaves the account (and its email) intact, and
//     the user can simply ask for another link from the same public page. The
//     error response says so explicitly rather than leaving them at a dead
//     link.
//   • For the operator, the failure is logged with the user id and the request
//     row id. deletion_requests has no status column to write a failure into,
//     so — as in process-deletions and delete-account — the console line is the
//     audit trail.
//
// Deploy (JWT verification OFF — the caller is anonymous by design):
//   supabase functions deploy confirm-account-deletion --no-verify-jwt
// Schedule: none. Invoked by the public deletion page when a link is clicked.
//
// Requires supabase/account_deletion.sql to have been run, and delete-account
// to be deployed.
//
// Required secrets:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   RESEND_API_KEY                 (optional — if absent, email is skipped and
//                                   the deletion still completes)
//   DELETION_FROM_EMAIL            (e.g. "Compliance Co-Pilot <no-reply@yourdomain.com>")

// deno-lint-ignore-file no-explicit-any
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL = Deno.env.get('DELETION_FROM_EMAIL') ?? 'Compliance Co-Pilot <noreply@send.thecopilot.app>';

// The single answer for an unknown, already-used or expired token. One constant
// so the three cases cannot drift apart into three distinguishable messages.
const INVALID_TOKEN_RESPONSE = {
  ok: false,
  error: 'This link is invalid or has expired.',
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

/**
 * Run `task` after the response has already been returned.
 *
 * The deletion is irreversible by the time the completion email is scheduled,
 * so nothing about the response may hang on whether Resend answers. The isolate
 * would normally be frozen the moment the handler returns, so EdgeRuntime's
 * waitUntil() is what keeps it alive until the promise settles.
 *
 * waitUntil is a Supabase runtime global rather than a Deno one, so it is read
 * off globalThis instead of imported; where it is absent (older local
 * `supabase functions serve`), the promise is left to run on its own and may be
 * cut short at teardown. Either way the rejection is swallowed here — an
 * unhandled rejection after the response would be logged as a crash rather than
 * as the send failure it actually is.
 */
function runAfterResponse(task: Promise<unknown>): void {
  const guarded = task.catch((err: unknown) => {
    console.error(
      '[confirm-account-deletion] deferred send threw: ' +
        (err instanceof Error ? err.message : String(err)),
    );
  });
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime && typeof runtime.waitUntil === 'function') {
    runtime.waitUntil(guarded);
  }
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

// Fallback copy, used only if the deletion_complete row is missing or
// unreadable. Same text and inline styles as the SQL seed and as
// FALLBACK_TEMPLATES in src/services/emailTemplates.ts — edit all three or they
// drift.
function buildCompleteEmailHtml(args: { name: string }): string {
  return `<!doctype html><html><body style="font-family:-apple-system,system-ui,sans-serif;color:#1a1a2e;max-width:560px;margin:0 auto;padding:24px;">
  <h1 style="color:#042C53;margin-bottom:8px;">Account deleted</h1>
  <p>Hi ${args.name},</p>
  <p>Your Compliance Co-Pilot account has been permanently deleted, along with all of the data in it.</p>
  <div style="background:#F5F7FA;border-left:4px solid #185FA5;padding:16px;border-radius:8px;margin:24px 0;">
    <p style="margin:0;"><strong>Removed:</strong> your sign-in, compliance documents and uploaded files, hours logs, business trips, meeting minutes, mileage and vehicles, businesses and properties, and your signed records.</p>
    <p style="margin:8px 0 0;">None of it can be recovered.</p>
  </div>
  <p><strong>One thing we cannot do for you:</strong> if you had a paid subscription, deleting your account does not cancel it. Only the App Store or Google Play can stop the billing, so please cancel there if you have not already.</p>
  <p>If you did not ask for this, reply to this email right away.</p>
  <p style="color:#6b7280;font-size:12px;margin-top:32px;">Compliance Co-Pilot</p>
</body></html>`;
}

interface ClaimedRequest {
  id: string;
  email: string;
  user_id: string | null;
}

/**
 * Atomically claim the token: mark it consumed and hand back the row, in one
 * statement, only if it was still unconsumed and unexpired. See the header for
 * why this is not a select followed by an update.
 *
 * Returns null for unknown / already-consumed / expired alike — the caller
 * cannot tell them apart, and neither can the visitor.
 */
async function claimToken(
  admin: SupabaseClient,
  token: string,
  nowIso: string,
): Promise<ClaimedRequest | null> {
  const { data, error } = await admin
    .from('deletion_requests')
    .update({ consumed_at: nowIso })
    .eq('token', token)
    .is('consumed_at', null)
    .gt('expires_at', nowIso)
    .select('id, email, user_id')
    // token is UNIQUE, so this is at most one row.
    .maybeSingle();

  if (error) {
    // An infrastructure failure is not the same as a bad token, but the visitor
    // is told the same thing either way: any extra detail here is a probe
    // result. The distinction is preserved in the log, for operators.
    console.error(`[confirm-account-deletion] claim failed: ${error.message}`);
    return null;
  }
  if (!data) return null;

  const row = data as { id: string; email: string; user_id: string | null };
  return { id: row.id, email: row.email, user_id: row.user_id };
}

/**
 * The account's display name, read BEFORE the deletion — afterwards the users
 * row is gone and there is nothing left to greet them by. Falls back to the
 * local part of the request row's email, which is the same fallback the other
 * email functions use.
 */
async function lookupUserName(
  admin: SupabaseClient,
  userId: string,
  email: string,
): Promise<string> {
  const fallback = email.split('@')[0] || 'there';
  try {
    const { data } = await admin
      .from('users')
      .select('full_name')
      .eq('id', userId)
      .maybeSingle();
    const fullName = (data as any)?.full_name as string | null | undefined;
    if (fullName && fullName.trim()) return fullName.trim();
  } catch {
    // fall through to the email local part
  }
  return fallback;
}

/**
 * Invoke delete-account over HTTP with the service-role key as the bearer
 * token. That key is itself a JWT carrying role 'service_role', which is
 * exactly the internal-caller branch delete-account documents: it is the only
 * branch that honours a user_id from the body rather than from the caller's own
 * `sub` claim.
 *
 * Two different failures have to be caught. delete-account answers 500 with
 * ok:false when the auth deletion itself failed, but it also answers 200 with
 * ok:true when only storage cleanup left residue — so the transport status and
 * the payload's own verdict are both checked, and only both together count as
 * deleted.
 */
async function callDeleteAccount(
  userId: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE}`,
        // The functions gateway expects apikey alongside Authorization the way
        // supabase-js always sends it.
        apikey: SERVICE_ROLE,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_id: userId }),
    });

    let payload: any = null;
    try {
      payload = await r.json();
    } catch {
      // Non-JSON body (a gateway error page, say) — handled below.
    }

    if (!r.ok || payload?.ok !== true) {
      const detail = payload?.error ?? payload?.message ?? `HTTP ${r.status} ${r.statusText}`;
      return { ok: false, detail: String(detail) };
    }

    // ok:true can still carry residualErrors (storage that would not purge).
    // The account IS gone, so this is a success, but the residue is worth a log
    // line — nothing else will mention it once the response is discarded.
    if (Array.isArray(payload.residualErrors) && payload.residualErrors.length > 0) {
      console.warn(
        `[confirm-account-deletion] deletion completed with residue user=${userId} ` +
          `residualErrors=${JSON.stringify(payload.residualErrors)}`,
      );
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Send the deletion_complete email. Never throws: the account is already gone
 * by the time this runs, so a send failure cannot be allowed to turn a
 * completed deletion into an error the visitor sees.
 */
async function sendCompleteEmail(
  admin: SupabaseClient,
  args: { email: string; name: string },
): Promise<void> {
  if (!RESEND_KEY) {
    console.warn(
      '[confirm-account-deletion] RESEND_API_KEY not set — deletion_complete email NOT sent. ' +
        'The account was still deleted; the user simply gets no confirmation.',
    );
    return;
  }

  // Prefer the admin-editable template; fall back to the hardcoded copy so a
  // missing/unseeded row never costs the user their confirmation.
  const template = await fetchTemplate(admin, 'deletion_complete');
  let subject: string;
  let html: string;
  if (template) {
    const rendered = renderTemplate(template.subject, template.body_html, {
      user_name: args.name,
    });
    subject = rendered.subject;
    html = rendered.html;
  } else {
    subject = 'Your Compliance Co-Pilot account has been deleted';
    html = buildCompleteEmailHtml({ name: args.name });
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
      console.error(`[confirm-account-deletion] Resend ${r.status}: ${text || r.statusText}`);
      return;
    }
    console.log('[confirm-account-deletion] deletion_complete email sent');
  } catch (err) {
    console.error(
      '[confirm-account-deletion] Resend request threw: ' +
        (err instanceof Error ? err.message : String(err)),
    );
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'Supabase env missing' }, 500);

  let body: { token?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  // A missing token is a malformed request, not a failed redemption — the page
  // should never produce one. A PRESENT but wrong token falls through to the
  // generic path below, so this early return leaks nothing about real tokens.
  if (!token) return json({ error: 'token required' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const nowIso = new Date().toISOString();

  // Consume first. Everything after this point is operating on a token that can
  // never be redeemed a second time, whatever happens next.
  const request = await claimToken(admin, token, nowIso);
  if (!request) return json(INVALID_TOKEN_RESPONSE, 400);

  // Should be unreachable: request-account-deletion only emails a link when it
  // matched an account, so a null user_id row never has its token delivered
  // anywhere. Handled anyway — the row is already consumed, and the visitor
  // gets the same success copy as a real deletion, because saying "there was no
  // account for that link" would confirm the address was unregistered.
  if (!request.user_id) {
    console.warn(
      `[confirm-account-deletion] consumed request=${request.id} with null user_id — nothing to delete`,
    );
    return json({ ok: true, message: 'Your account has been permanently deleted.' });
  }

  const userId = request.user_id;
  // Read the name while the account still exists (see lookupUserName).
  const name = await lookupUserName(admin, userId, request.email);

  const result = await callDeleteAccount(userId);
  if (!result.ok) {
    // Token stays consumed; the account is still standing. See the header for
    // why it is not re-armed and why a fresh request is the recovery path.
    console.error(
      `[confirm-account-deletion] delete-account FAILED user=${userId} ` +
        `request=${request.id}: ${result.detail}`,
    );
    return json(
      {
        ok: false,
        error:
          'We could not complete the deletion, and your account has not been deleted. ' +
          'This link has now been used — please request a new deletion link and try again.',
      },
      500,
    );
  }

  console.log(`[confirm-account-deletion] account deleted user=${userId} request=${request.id}`);

  // The stored email, not a fresh lookup: the users row no longer exists.
  // Deferred because the deletion is already irreversible — see
  // runAfterResponse.
  runAfterResponse(sendCompleteEmail(admin, { email: request.email, name }));

  return json({ ok: true, message: 'Your account has been permanently deleted.' });
});
