// Supabase Edge Function: process-deletions
//
// Runs on a daily schedule. For every cancellation whose grace period has
// elapsed (deletion_scheduled_for <= now AND is_deleted = false AND
// voided_at IS NULL) AND whose owner is confirmed to have actually cancelled,
// it permanently removes the user's compliance data:
//   1. All files under <user_id>/… in every bucket that holds user uploads:
//      strategy-documents, business-logos, scorp-signatures,
//      augusta-comparables
//   2. All rows in public.documents for that user
//   3. All rows in hours_log, business_trips, meeting_minutes,
//      strategy_documents for that user
//   4. Marks the cancellation row is_deleted = true, deleted_at = now()
// Each deletion is logged (user_id + document count + per-bucket results) for
// audit purposes.
//
// Step 1 previously named a single bucket, `documents`, which does not exist in
// this schema and which no app code uploads to — so the storage step deleted
// nothing while every real file survived. It now walks the four user-upload
// buckets the app actually writes to (paths are <user_id>/… in all four).
//
// The `cancellations` bucket is deliberately EXCLUDED. It holds the two
// signature PNGs that are the evidence justifying this purge, and the
// cancellations ROW outlives the purge (is_deleted / deleted_at), so its
// evidence has to outlive it too — otherwise the surviving audit row points at
// deleted objects through signature_1_url / signature_2_url. The account and
// its login survive here as well, so the signatures remain attributable.
// delete-account DOES purge that bucket: a whole-account deletion has no
// reason to preserve anything, and there is no longer an account to hold to
// the acknowledgment.
//
// This deletes DOCUMENTS, not the account: the users row, the subscription
// columns and the login all survive. Whole-account deletion is a separate
// function, delete-account, which shares this storage-walk approach.
//
// ─── The cancellation-confirmed guard ─────────────────────────────────────
// The app records a cancellations row BEFORE handing the user to Apple's /
// Google's subscription-management sheet, because that is when the signatures
// exist. No app can cancel an IAP subscription on a user's behalf, and the
// store gives no callback saying whether the user went through with it — so a
// row here proves INTENT, not outcome. Someone can sign, get handed to the
// store, dismiss the sheet, and keep paying.
//
// Deleting on intent alone would wipe an active paying subscriber's entire
// compliance history 30 days later, silently. So before purging we require one
// of two things to be true of the owner:
//
//   • users.subscription_status = 'cancelled' — written ONLY by the RevenueCat
//     webhook, on a real store CANCELLATION or EXPIRATION event. It also
//     self-heals: re-subscribing flips it back to 'active', which correctly
//     stands this purge down.
//   • users.revenuecat_original_transaction_id IS NULL — the user never had a
//     store subscription at all (free / Basic, never purchased), so no webhook
//     will ever fire for them and a status check alone would trap their
//     deletion request forever.
//
// Anything else means they are still subscribed 30 days after asking to cancel:
// void the row (voided_at = now) so it is visibly recorded and not retried
// nightly. A genuine later cancellation creates a fresh row.
//
// This supersedes the earlier `purge-cancelled-documents` function (which only
// removed the documents bucket + table). Schedule ONLY this one to avoid double
// processing — both guard on is_deleted so a stray run is harmless, but there is
// no reason to run both.
//
// TODO (email provider not yet connected): send a "documents will be deleted
// soon" warning email a few days BEFORE the purge, sourced from the admin-
// editable `email_templates` row with template_key='deletion_warning'. That
// belongs in a separate scheduled function (e.g. `send-deletion-warnings`) that
// selects cancellations whose deletion_scheduled_for is ~N days out, renders the
// template with { user_name, deletion_date, document_count }, and hands the
// result to the provider send call. The render layer already exists in
// src/services/emailTemplates.ts (renderTemplate) and is mirrored inline in the
// other email functions.
//
// Deploy:
//   supabase functions deploy process-deletions
// Schedule (daily 03:00 UTC):
//   supabase functions schedule create process-deletions --cron "0 3 * * *"
//
// Required secrets:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

// deno-lint-ignore-file no-explicit-any
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Every bucket of user UPLOADS stored under a <user_id>/… prefix. All of them
// enforce that convention through their owner-folder RLS policies.
//   strategy-documents   <user_id>/<strategy_key>/<document_key>/<file>
//   business-logos       <user_id>/<business_id>/logo.jpg
//   scorp-signatures     <user_id>/<file>
//   augusta-comparables  <user_id>/<file>
//
// Deliberately NOT `cancellations` (<user_id>/signature_{1,2}.png) — see the
// header: those signatures are the evidence for this purge and must outlive
// it, exactly as the cancellations row does. delete-account purges all five.
const USER_STORAGE_BUCKETS = [
  'strategy-documents',
  'business-logos',
  'scorp-signatures',
  'augusta-comparables',
];

// Storage list() page size. The API caps a single call, so every prefix is
// walked in pages rather than assumed to fit in one.
const LIST_PAGE_SIZE = 1000;

// Safety valve on the pagination loop. Nothing legitimate needs this many pages
// for one prefix; hitting it means the listing is not converging, and stalling
// forever inside a purge is worse than reporting the prefix as incomplete.
const MAX_PAGES_PER_PREFIX = 1000;

// User-owned tables to wipe. `documents` here is the TABLE — the files it used
// to point at are covered by the bucket walk above, not by this list.
const USER_DATA_TABLES = [
  'documents',
  'hours_log',
  'business_trips',
  'meeting_minutes',
  'strategy_documents',
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface BucketPurgeResult {
  bucket: string;
  deleted: number;
  errors: string[];
}

/**
 * Recursively remove every object under <bucket>/<userId>/… . The storage list
 * API is per-prefix, so sub-folders are walked too.
 *
 * Two earlier defects are fixed here (and the same corrected walk is used by
 * the delete-account function):
 *
 *   • PAGINATED. A single list({ limit: 1000 }) silently stops at the first
 *     1000 entries of a prefix, so a heavy user kept files. Each prefix is now
 *     drained page by page.
 *   • ERRORS SURFACED. list() / remove() failures were swallowed by `continue`,
 *     which reports a clean purge while files remain. Both are collected into
 *     `errors` so a partial purge is visible in the logs and the response.
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

// Walk every user-owned bucket. A failure in one bucket does not stop the
// others — the row purge below still has to happen.
async function purgeAllStorageForUser(
  admin: SupabaseClient,
  userId: string,
): Promise<BucketPurgeResult[]> {
  const results: BucketPurgeResult[] = [];
  for (const bucket of USER_STORAGE_BUCKETS) {
    results.push(await purgeStorageForUser(admin, bucket, userId));
  }
  return results;
}

async function purgeUser(
  admin: SupabaseClient,
  cancellation: { id: string; user_id: string; document_count_at_cancellation: number | null },
): Promise<{
  cancellation_id: string;
  user_id: string;
  storage_deleted: number;
  storage: BucketPurgeResult[];
  rows_deleted: Record<string, number>;
  document_count_at_cancellation: number;
  ok: boolean;
  error?: string;
}> {
  const rowsDeleted: Record<string, number> = {};
  // Declared out here so the catch path can still report what storage actually
  // did before a later step threw.
  let storage: BucketPurgeResult[] = [];
  let storageDeleted = 0;
  try {
    storage = await purgeAllStorageForUser(admin, cancellation.user_id);
    storageDeleted = storage.reduce((sum, r) => sum + r.deleted, 0);

    for (const table of USER_DATA_TABLES) {
      const { error, count } = await admin
        .from(table)
        .delete({ count: 'exact' })
        .eq('user_id', cancellation.user_id);
      if (error) throw new Error(`${table}: ${error.message}`);
      rowsDeleted[table] = count ?? 0;
    }

    const { error: updateErr } = await admin
      .from('cancellations')
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq('id', cancellation.id);
    if (updateErr) throw updateErr;

    const documentCount = Number(cancellation.document_count_at_cancellation ?? 0);
    // Audit log: user_id + document count at time of cancellation, plus the
    // per-bucket storage results so a bucket that failed to purge is visible.
    console.log(
      `[process-deletions] purged user=${cancellation.user_id} ` +
        `documents_at_cancellation=${documentCount} storage_deleted=${storageDeleted} ` +
        `storage=${JSON.stringify(storage)} ` +
        `rows=${JSON.stringify(rowsDeleted)}`,
    );

    return {
      cancellation_id: cancellation.id,
      user_id: cancellation.user_id,
      storage_deleted: storageDeleted,
      storage,
      rows_deleted: rowsDeleted,
      document_count_at_cancellation: documentCount,
      ok: true,
    };
  } catch (err) {
    console.error(
      `[process-deletions] FAILED user=${cancellation.user_id}: ` +
        (err instanceof Error ? err.message : String(err)) +
        ` storage=${JSON.stringify(storage)}`,
    );
    return {
      cancellation_id: cancellation.id,
      user_id: cancellation.user_id,
      storage_deleted: storageDeleted,
      storage,
      rows_deleted: rowsDeleted,
      document_count_at_cancellation: Number(cancellation.document_count_at_cancellation ?? 0),
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Is this cancellation confirmed enough to destroy data for? See the guard
 * explanation in the file header. Returns a reason string when it is NOT, so
 * the skip is legible in the logs and the response.
 */
async function cancellationConfirmed(
  admin: SupabaseClient,
  userId: string,
): Promise<{ confirmed: boolean; reason?: string }> {
  const { data, error } = await admin
    .from('users')
    .select('subscription_status, revenuecat_original_transaction_id')
    .eq('id', userId)
    .maybeSingle();

  // A read failure must NOT be read as "go ahead and delete". Skip without
  // voiding so the next run can try again.
  if (error) return { confirmed: false, reason: `user lookup failed: ${error.message}` };
  // No user row at all — the account is gone; nothing is being billed.
  if (!data) return { confirmed: true };

  const row = data as {
    subscription_status: string | null;
    revenuecat_original_transaction_id: string | null;
  };
  if (row.subscription_status === 'cancelled') return { confirmed: true };
  if (!row.revenuecat_original_transaction_id) return { confirmed: true };
  return {
    confirmed: false,
    reason: `still subscribed (status=${row.subscription_status ?? 'null'})`,
  };
}

Deno.serve(async (_req) => {
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'Supabase env missing' }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const now = new Date().toISOString();

  const { data: due, error: dueErr } = await admin
    .from('cancellations')
    .select('id, user_id, document_count_at_cancellation')
    .lte('deletion_scheduled_for', now)
    .eq('is_deleted', false)
    .is('voided_at', null);
  if (dueErr) return json({ error: dueErr.message }, 500);

  const queue = (due ?? []) as Array<{
    id: string;
    user_id: string;
    document_count_at_cancellation: number | null;
  }>;

  const results = [];
  const skipped = [];
  for (const c of queue) {
    const { confirmed, reason } = await cancellationConfirmed(admin, c.user_id);
    if (!confirmed) {
      // "still subscribed" is a settled answer 30 days on — void it so it is
      // recorded rather than silently retried every night. A transient lookup
      // failure is not settled, so leave that row alone for the next run.
      const settled = reason?.startsWith('still subscribed') ?? false;
      if (settled) {
        const { error: voidErr } = await admin
          .from('cancellations')
          .update({ voided_at: new Date().toISOString(), void_reason: reason })
          .eq('id', c.id);
        if (voidErr) {
          console.error(`[process-deletions] void failed for ${c.id}: ${voidErr.message}`);
        }
      }
      console.log(
        `[process-deletions] SKIPPED user=${c.user_id} cancellation=${c.id} ` +
          `reason="${reason}" voided=${settled}`,
      );
      skipped.push({ cancellation_id: c.id, user_id: c.user_id, reason, voided: settled });
      continue;
    }
    results.push(await purgeUser(admin, c));
  }

  return json({
    ok: true,
    processed: results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    skipped: skipped.length,
    results,
    skipped_details: skipped,
  });
});
