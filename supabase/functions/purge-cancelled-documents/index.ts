// Supabase Edge Function: purge-cancelled-documents
//
// Runs daily. For each cancellation whose deletion_scheduled_for is in the
// past and is_deleted = false:
//   1. Delete every object in storage owned by that user (documents/<user_id>/*
//      across all known buckets that the app uses for user documents).
//   2. Delete every row in public.documents for that user.
//   3. Mark the cancellation row is_deleted=true, deleted_at=now().
//
// Deploy:
//   supabase functions deploy purge-cancelled-documents
// Schedule (daily 03:00 UTC):
//   supabase functions schedule create purge-cancelled-documents --cron "0 3 * * *"
//
// Required secrets:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

// deno-lint-ignore-file no-explicit-any
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Buckets that may hold user-uploaded compliance documents. Adjust as new
// buckets are added; missing buckets are tolerated.
const USER_DOCUMENT_BUCKETS = ['documents', 'compliance-documents', 'user-docs'];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function purgeStorageForUser(admin: SupabaseClient, userId: string): Promise<number> {
  let deleted = 0;
  for (const bucket of USER_DOCUMENT_BUCKETS) {
    const { data: entries, error } = await admin.storage.from(bucket).list(userId, { limit: 1000 });
    if (error || !entries || entries.length === 0) continue;
    const paths = entries.map((e) => `${userId}/${e.name}`);
    const { data: removed } = await admin.storage.from(bucket).remove(paths);
    deleted += removed?.length ?? 0;
  }
  return deleted;
}

async function purgeUser(admin: SupabaseClient, cancellation: { id: string; user_id: string }): Promise<{
  cancellation_id: string;
  user_id: string;
  storage_deleted: number;
  rows_deleted: number;
  ok: boolean;
  error?: string;
}> {
  try {
    const storageDeleted = await purgeStorageForUser(admin, cancellation.user_id);

    const { error: docsErr, count } = await admin
      .from('documents')
      .delete({ count: 'exact' })
      .eq('user_id', cancellation.user_id);
    if (docsErr) throw docsErr;

    const { error: updateErr } = await admin
      .from('cancellations')
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq('id', cancellation.id);
    if (updateErr) throw updateErr;

    return {
      cancellation_id: cancellation.id,
      user_id: cancellation.user_id,
      storage_deleted: storageDeleted,
      rows_deleted: count ?? 0,
      ok: true,
    };
  } catch (err) {
    return {
      cancellation_id: cancellation.id,
      user_id: cancellation.user_id,
      storage_deleted: 0,
      rows_deleted: 0,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

Deno.serve(async (_req) => {
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'Supabase env missing' }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const today = new Date().toISOString();

  const { data: due, error: dueErr } = await admin
    .from('cancellations')
    .select('id, user_id')
    .lte('deletion_scheduled_for', today)
    .eq('is_deleted', false);
  if (dueErr) return json({ error: dueErr.message }, 500);

  const queue = (due ?? []) as Array<{ id: string; user_id: string }>;
  const results = [];
  for (const c of queue) {
    results.push(await purgeUser(admin, c));
  }

  return json({
    ok: true,
    processed: results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
});
