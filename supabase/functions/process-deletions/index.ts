// Supabase Edge Function: process-deletions
//
// Runs on a daily schedule. For every cancellation whose grace period has
// elapsed (deletion_scheduled_for <= now AND is_deleted = false) it permanently
// removes the user's compliance data:
//   1. All files in the `documents` storage bucket under <user_id>/*
//   2. All rows in public.documents for that user
//   3. All rows in hours_log, business_trips, meeting_minutes,
//      strategy_documents for that user
//   4. Marks the cancellation row is_deleted = true, deleted_at = now()
// Each deletion is logged (user_id + document count) for audit purposes.
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

// Bucket holding user-uploaded / generated compliance documents.
const DOCUMENTS_BUCKET = 'documents';

// User-owned tables to wipe (in addition to `documents`).
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

// Recursively remove every object under documents/<user_id>/… . The storage
// list API is per-prefix, so we walk one level of sub-folders as well.
async function purgeStorageForUser(admin: SupabaseClient, userId: string): Promise<number> {
  let deleted = 0;
  const prefixes = [userId];
  while (prefixes.length > 0) {
    const prefix = prefixes.pop() as string;
    const { data: entries, error } = await admin.storage
      .from(DOCUMENTS_BUCKET)
      .list(prefix, { limit: 1000 });
    if (error || !entries || entries.length === 0) continue;

    const filePaths: string[] = [];
    for (const entry of entries) {
      // A storage "folder" entry has no id/metadata; recurse into it.
      if (entry.id === null || entry.metadata === null) {
        prefixes.push(`${prefix}/${entry.name}`);
      } else {
        filePaths.push(`${prefix}/${entry.name}`);
      }
    }
    if (filePaths.length > 0) {
      const { data: removed } = await admin.storage.from(DOCUMENTS_BUCKET).remove(filePaths);
      deleted += removed?.length ?? 0;
    }
  }
  return deleted;
}

async function purgeUser(
  admin: SupabaseClient,
  cancellation: { id: string; user_id: string; document_count_at_cancellation: number | null },
): Promise<{
  cancellation_id: string;
  user_id: string;
  storage_deleted: number;
  rows_deleted: Record<string, number>;
  document_count_at_cancellation: number;
  ok: boolean;
  error?: string;
}> {
  const rowsDeleted: Record<string, number> = {};
  try {
    const storageDeleted = await purgeStorageForUser(admin, cancellation.user_id);

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
    // Audit log: user_id + document count at time of cancellation.
    console.log(
      `[process-deletions] purged user=${cancellation.user_id} ` +
        `documents_at_cancellation=${documentCount} storage_deleted=${storageDeleted} ` +
        `rows=${JSON.stringify(rowsDeleted)}`,
    );

    return {
      cancellation_id: cancellation.id,
      user_id: cancellation.user_id,
      storage_deleted: storageDeleted,
      rows_deleted: rowsDeleted,
      document_count_at_cancellation: documentCount,
      ok: true,
    };
  } catch (err) {
    console.error(
      `[process-deletions] FAILED user=${cancellation.user_id}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
    return {
      cancellation_id: cancellation.id,
      user_id: cancellation.user_id,
      storage_deleted: 0,
      rows_deleted: rowsDeleted,
      document_count_at_cancellation: Number(cancellation.document_count_at_cancellation ?? 0),
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

Deno.serve(async (_req) => {
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'Supabase env missing' }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const now = new Date().toISOString();

  const { data: due, error: dueErr } = await admin
    .from('cancellations')
    .select('id, user_id, document_count_at_cancellation')
    .lte('deletion_scheduled_for', now)
    .eq('is_deleted', false);
  if (dueErr) return json({ error: dueErr.message }, 500);

  const queue = (due ?? []) as Array<{
    id: string;
    user_id: string;
    document_count_at_cancellation: number | null;
  }>;

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
