-- Nightly schedule for the `process-deletions` edge function.
--
-- There is no `supabase functions schedule` CLI command (the Supabase CLI has
-- no such subcommand — `supabase functions` only does list/delete/download/
-- deploy/new/serve). Scheduling an edge function on Supabase is done in the
-- database with pg_cron + pg_net, which is what this file sets up.
--
-- Run order matters: step 2 stores the credential the job reads at fire time,
-- so the job 401s until it exists.
--
--   Supabase dashboard -> SQL Editor -> New query -> paste -> Run
--
-- Re-running is safe: the extensions use IF NOT EXISTS and cron.schedule()
-- upserts on the job name.

-- ── 1. Extensions ──────────────────────────────────────────────────────────
-- pg_cron installs its callable API into the `cron` schema, pg_net into `net`.
-- Neither is in `public`, so PostgREST does not expose net.http_post as RPC.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── 2. Service role key in Vault ───────────────────────────────────────────
-- process-deletions is deployed WITH JWT verification on (no --no-verify-jwt),
-- so the invocation has to carry a project-signed JWT. The function reads its
-- own SUPABASE_SERVICE_ROLE_KEY from the runtime env; this header only exists
-- to clear the platform's JWT check.
--
-- Keep the key in Vault rather than inlining it in the job body — cron.job is
-- readable by any role with access to the cron schema, and the job body is
-- stored in plaintext there.
--
-- Replace the placeholder with the project's service_role key
-- (Dashboard -> Project Settings -> API keys -> service_role, or
-- `supabase projects api-keys --project-ref hlmyalvpioddkrnbvguz`).
-- Do NOT commit the real key to this file.
select vault.create_secret(
  '<SERVICE_ROLE_KEY>',
  'service_role_key',
  'Service role JWT used by the nightly process-deletions cron job'
);

-- ── 3. The job ─────────────────────────────────────────────────────────────
-- 03:00 UTC daily. pg_cron schedules are always UTC on Supabase.
--
-- Schedule ONLY this function, not the superseded purge-cancelled-documents —
-- see the comment block at the top of functions/process-deletions/index.ts.
select cron.schedule(
  'process-deletions-nightly',
  '0 3 * * *',
  $job$
  select net.http_post(
    url     := 'https://hlmyalvpioddkrnbvguz.supabase.co/functions/v1/process-deletions',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $job$
);

-- ── Verify ─────────────────────────────────────────────────────────────────
-- select jobid, jobname, schedule, active from cron.job;
-- select count(*) from vault.decrypted_secrets where name = 'service_role_key';
--
-- Recent runs (empty until the job first fires):
-- select jobid, status, return_message, start_time
--   from cron.job_run_details order by start_time desc limit 10;
--
-- Remove:
-- select cron.unschedule('process-deletions-nightly');
