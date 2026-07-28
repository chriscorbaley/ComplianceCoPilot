-- RevenueCat webhook support.
-- Paste into Supabase → SQL Editor → Run, or apply via `supabase db push`.
--
-- Required by supabase/functions/revenuecat-webhook/index.ts. Run this BEFORE
-- deploying that function, or every delivery will 500.
--
-- Safe to re-run: idempotent throughout.

-- ─── users: store-transaction fallback lookup ────────────────────────────
-- The webhook normally matches on app_user_id (which identifyRevenueCatUser()
-- sets to public.users.id). This column is the fallback path for users whose
-- purchase happened before sign-in: once any event resolves them, we record
-- the store's original transaction id so later events can find them directly.

alter table public.users
  add column if not exists revenuecat_original_transaction_id text;

create index if not exists users_revenuecat_original_txn_idx
  on public.users (revenuecat_original_transaction_id)
  where revenuecat_original_transaction_id is not null;

-- ─── Webhook idempotency ─────────────────────────────────────────────────
-- RevenueCat reuses the same event id across its 5 retries (5/10/20/40/80 min),
-- and duplicate deliveries are expected in normal operation. The webhook
-- inserts here first and treats a unique violation as "already processed".

create table if not exists public.revenuecat_webhook_events (
  event_id     text primary key,
  event_type   text,
  app_user_id  text,
  received_at  timestamptz not null default now()
);

create index if not exists revenuecat_webhook_events_received_at_idx
  on public.revenuecat_webhook_events (received_at);

-- Written only by the Edge Function via the service role key, which bypasses
-- RLS. Enabling RLS with no policy therefore denies every client while leaving
-- the function unaffected.
alter table public.revenuecat_webhook_events enable row level security;

drop policy if exists revenuecat_webhook_events_admin_read
  on public.revenuecat_webhook_events;
create policy revenuecat_webhook_events_admin_read
  on public.revenuecat_webhook_events
  for select to authenticated using (public.is_admin());

-- ─── Retention ───────────────────────────────────────────────────────────
-- Dedupe rows only need to outlive RevenueCat's retry window (~2.6 hours).
-- Keeping 90 days gives plenty of slack for debugging; admin_audit_log is the
-- permanent record. Call periodically (pg_cron, or from an existing cleanup
-- job) — nothing schedules this automatically.

create or replace function public.prune_revenuecat_webhook_events()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.revenuecat_webhook_events
  where received_at < now() - interval '90 days';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- Confirm: should return zero rows on a fresh install, and list the new column.
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'users'
  and column_name = 'revenuecat_original_transaction_id';

select count(*) as webhook_events_rows from public.revenuecat_webhook_events;
