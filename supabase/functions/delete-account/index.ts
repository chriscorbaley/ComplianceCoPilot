// Supabase Edge Function: delete-account
//
// Permanently deletes one account and everything belonging to it. This is the
// in-app path required by App Store Review Guideline 5.1.1(v) (deletion must be
// initiable inside the app, not merely deactivation) and the terminal step of
// Google Play's web-based deletion request.
//
// Order of operations, for the target user_id:
//   1. Purge every user-owned storage bucket under <user_id>/… (storage is NOT
//      covered by the database's FK cascade — files would otherwise survive the
//      account forever).
//   2. Delete the two user-identifying rows that have no FK to users and so are
//      NOT cascaded: revenuecat_webhook_events.app_user_id and
//      admin_audit_log.record_key (where table_affected = 'users').
//   3. auth.admin.deleteUser() — removes the auth.users row, which cascades to
//      public.users and from there to all 14 user-owned tables (businesses,
//      properties, hours_log, business_trips, meeting_minutes, documents,
//      cancellations, strategy_documents, compliance_checklist_items,
//      scorp_signatures, augusta_rentals, augusta_comparables, vehicles,
//      mileage_log) plus tos_acceptances / privacy_acceptances, which reference
//      auth.users directly. Any pending public.deletion_requests row for this
//      user cascades away too, so a live confirmation token cannot outlive the
//      account it pointed at.
//
// ─── Why step 1 comes before step 3 ──────────────────────────────────────────
// Once the auth row is gone we have no reliable way to enumerate what was
// theirs: the file paths are keyed by user id, but nothing remains to tell us
// that id ever existed. Storage first means a failure leaves a still-deletable
// account rather than an orphaned pile of documents. The trade-off is accepted
// deliberately: a storage error does NOT abort the deletion (see below).
//
// ─── Failure policy ──────────────────────────────────────────────────────────
// Storage and step-2 errors are collected and returned, never fatal. The user
// asked for their account to be gone; refusing to remove it because one bucket
// listing failed would leave them with an account they explicitly deleted, and
// the residue is recoverable later from the logged user id. Step 3 is different:
// if deleteUser() fails the account still exists, so the response is ok:false
// and the caller must tell the user deletion did not complete.
//
// ─── Auth model — deploy WITH JWT verification ───────────────────────────────
// Deploy WITHOUT --no-verify-jwt. The platform verifies the JWT's signature
// before this code runs, so the payload below is decoded (not re-verified) only
// to read its claims:
//
//   • role = 'service_role' → the target is `user_id` from the request body.
//     Reaching this branch requires the service-role secret itself, so it is
//     for internal callers only (the forthcoming confirm-account-deletion
//     function, which redeems an emailed token and then calls in here).
//   • role = 'authenticated' → the target is the JWT's own `sub` claim and any
//     user_id in the body is ignored outright. A signed-in user can only ever
//     delete themselves; there is no parameter that lets them name someone else.
//   • anything else → 401. This is load-bearing rather than defensive: the
//     public anon key is itself a valid JWT (role 'anon'), so platform-level
//     verify_jwt alone would let any anonymous caller through. Only the role
//     check distinguishes a signed-in user from the public key.
//
// No admin_audit_log row is written for the deletion. Step 2 exists precisely to
// remove this user's identifiers from that table, so re-inserting one with their
// id would defeat the point; the console lines below are the audit trail, the
// same as in process-deletions.
//
// Deploy (JWT verification ON — do NOT pass --no-verify-jwt):
//   supabase functions deploy delete-account
// Schedule: none. Invoked on demand by the app and by confirm-account-deletion.
//
// Required secrets:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

// deno-lint-ignore-file no-explicit-any
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Every bucket that stores files under a <user_id>/… prefix. All five enforce
// that convention through their owner-folder RLS policies, so the user id is a
// complete index of what belongs to them.
//   strategy-documents   <user_id>/<strategy_key>/<document_key>/<file>
//   business-logos       <user_id>/<business_id>/logo.jpg
//   scorp-signatures     <user_id>/<file>
//   augusta-comparables  <user_id>/<file>
//   cancellations        <user_id>/signature_{1,2}.png
const USER_STORAGE_BUCKETS = [
  'strategy-documents',
  'business-logos',
  'scorp-signatures',
  'augusta-comparables',
  'cancellations',
];

// Storage list() page size. The API caps a single call, so every prefix is
// walked in pages rather than assumed to fit in one.
const LIST_PAGE_SIZE = 1000;

// Safety valve on the pagination loop. Nothing legitimate needs this many pages
// for one prefix; hitting it means the listing is not converging, and stalling
// forever inside a deletion is worse than reporting the prefix as incomplete.
const MAX_PAGES_PER_PREFIX = 1000;

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

interface BucketPurgeResult {
  bucket: string;
  deleted: number;
  errors: string[];
}

/**
 * Recursively remove every object under <bucket>/<userId>/… .
 *
 * Derived from process-deletions' walk, with its two defects fixed:
 *
 *   • PAGINATED. A single list({ limit: 1000 }) silently stops at the first
 *     1000 entries of a prefix, so a heavy user kept files. Each prefix is now
 *     drained page by page.
 *   • ERRORS SURFACED. list() / remove() failures were swallowed by `continue`,
 *     which reports a clean purge while files remain. Both are collected into
 *     `errors` so the caller can see what survived.
 *
 * Folder detection is unchanged and still relies on the storage API quirk that
 * a pseudo-folder entry carries no id/metadata.
 */
async function purgeStorageForUser(
  admin: SupabaseClient,
  bucket: string,
  userId: string,
): Promise<BucketPurgeResult> {
  let deleted = 0;
  const errors: string[] = [];
  const prefixes = [userId];

  while (prefixes.length > 0) {
    const prefix = prefixes.pop() as string;
    // Offset of the first entry in this prefix that is NOT going away on this
    // pass — i.e. sub-folders, plus files whose removal failed. Successfully
    // deleted files vacate their offsets, so the window must not advance past
    // them or the next page would skip live entries.
    let offset = 0;
    let pages = 0;

    for (;;) {
      if (pages >= MAX_PAGES_PER_PREFIX) {
        errors.push(`list ${prefix}: exceeded ${MAX_PAGES_PER_PREFIX} pages, giving up`);
        break;
      }
      pages += 1;

      const { data: entries, error } = await admin.storage
        .from(bucket)
        .list(prefix, { limit: LIST_PAGE_SIZE, offset });
      if (error) {
        errors.push(`list ${prefix}: ${error.message}`);
        break;
      }
      if (!entries || entries.length === 0) break;

      const filePaths: string[] = [];
      let folderCount = 0;
      for (const entry of entries) {
        // A storage "folder" entry has no id/metadata; recurse into it.
        if (entry.id === null || entry.metadata === null) {
          prefixes.push(`${prefix}/${entry.name}`);
          folderCount += 1;
        } else {
          filePaths.push(`${prefix}/${entry.name}`);
        }
      }

      let removalFailed = false;
      if (filePaths.length > 0) {
        const { data: removed, error: removeErr } = await admin.storage
          .from(bucket)
          .remove(filePaths);
        if (removeErr) {
          removalFailed = true;
          errors.push(
            `remove ${prefix} (${filePaths.length} file(s)): ${removeErr.message}`,
          );
        } else {
          deleted += removed?.length ?? 0;
        }
      }

      // A short page means the prefix is drained.
      if (entries.length < LIST_PAGE_SIZE) break;
      offset += folderCount + (removalFailed ? filePaths.length : 0);
    }
  }

  return { bucket, deleted, errors };
}

interface JwtClaims {
  role?: string;
  sub?: string;
}

/**
 * Read the claims out of a JWT payload WITHOUT verifying the signature.
 *
 * Safe only because this function is deployed with verify_jwt = true: the
 * platform has already rejected anything unsigned, tampered with or expired
 * before the request reaches us, so the payload is trustworthy by the time we
 * look at it. Never copy this into a function deployed with --no-verify-jwt.
 */
function decodeJwtClaims(token: string): JwtClaims | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    // base64url → base64, then restore the stripped '=' padding.
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const parsed = JSON.parse(atob(padded));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as JwtClaims;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'Supabase env missing' }, 500);

  const authHeader = req.headers.get('authorization') ?? '';
  const bearer = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!bearer) return json({ error: 'Missing Authorization bearer token' }, 401);
  const claims = decodeJwtClaims(bearer[1]);
  if (!claims) return json({ error: 'Malformed token' }, 401);

  // Body is optional for the authenticated path; only the service-role path
  // requires anything from it.
  let body: { user_id?: string } = {};
  try {
    const raw = await req.text();
    if (raw.trim().length > 0) body = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  let userId: string;
  if (claims.role === 'service_role') {
    if (!body.user_id) return json({ error: 'user_id required for service-role calls' }, 400);
    userId = body.user_id;
  } else if (claims.role === 'authenticated') {
    // Deliberately ignores body.user_id — the JWT's subject is the only target
    // an end user can ever name.
    if (!claims.sub) return json({ error: 'Token has no subject' }, 401);
    userId = claims.sub;
  } else {
    return json({ error: 'Not authorized to delete accounts' }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  // ── 1. Storage ────────────────────────────────────────────────────────────
  const storage: BucketPurgeResult[] = [];
  for (const bucket of USER_STORAGE_BUCKETS) {
    storage.push(await purgeStorageForUser(admin, bucket, userId));
  }

  // Non-fatal by policy (see the file header), but recorded so a partial purge
  // is traceable to a user id after the account itself is gone.
  const residualErrors: string[] = [];
  for (const result of storage) {
    for (const err of result.errors) residualErrors.push(`${result.bucket}: ${err}`);
  }

  // ── 2. User-identifying rows with no FK cascade ───────────────────────────
  // revenuecat_webhook_events.app_user_id is a plain text copy of users.id.
  const { error: rcErr } = await admin
    .from('revenuecat_webhook_events')
    .delete()
    .eq('app_user_id', userId);
  if (rcErr) residualErrors.push(`revenuecat_webhook_events: ${rcErr.message}`);

  // admin_audit_log has no user column at all: the user id lands in the generic
  // `record_key` column, written by the revenuecat-webhook as
  // `record_key: userId, table_affected: 'users'`. Scoping to that pair is what
  // makes the delete precise — record_key otherwise holds config keys
  // ('starter', 'welcome') and row ids from non-user tables, and matching on
  // record_key alone would risk destroying unrelated admin history that happened
  // to share the value.
  const { error: auditErr } = await admin
    .from('admin_audit_log')
    .delete()
    .eq('record_key', userId)
    .eq('table_affected', 'users');
  if (auditErr) residualErrors.push(`admin_audit_log: ${auditErr.message}`);

  // ── 3. The account itself ─────────────────────────────────────────────────
  // shouldSoftDelete is passed explicitly: a soft delete would leave the
  // auth.users row in place, so nothing would cascade and the account would
  // still exist.
  const { error: authErr } = await admin.auth.admin.deleteUser(userId, false);
  if (authErr) {
    console.error(
      `[delete-account] FAILED user=${userId} auth deletion: ${authErr.message} ` +
        `storage=${JSON.stringify(storage)}`,
    );
    return json(
      {
        ok: false,
        userId,
        storage,
        authDeleted: false,
        error: authErr.message,
        residualErrors,
      },
      500,
    );
  }

  console.log(
    `[delete-account] deleted user=${userId} ` +
      `storage=${JSON.stringify(storage)} ` +
      `residual_errors=${residualErrors.length}`,
  );

  return json({ ok: true, userId, storage, authDeleted: true, residualErrors });
});
