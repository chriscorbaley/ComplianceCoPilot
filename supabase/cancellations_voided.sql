-- ═══════════════════════════════════════════════════════════════════════════
-- cancellations: voided_at / void_reason
-- ═══════════════════════════════════════════════════════════════════════════
-- Run in Supabase → SQL Editor. Idempotent: safe to re-run.
--
-- REQUIRED BY supabase/functions/process-deletions/index.ts (and the superseded
-- purge-cancelled-documents). Run this BEFORE deploying either, or their query
-- filter on voided_at will error and no purge will run.
--
-- WHY
-- The app writes a cancellations row BEFORE handing the user to Apple's /
-- Google's subscription-management sheet, because that is the moment the
-- signatures exist. No app can cancel an IAP subscription on a user's behalf,
-- and the store reports no outcome back — so the row proves INTENT, not that
-- the user went through with it. Someone can sign, get handed to the store,
-- dismiss the sheet, and keep paying.
--
-- Deleting on intent alone would erase an active paying subscriber's entire
-- compliance history 30 days later, silently. process-deletions therefore
-- re-checks at purge time that the owner really is cancelled, and marks the row
-- voided when they are not — visibly recorded rather than silently retried
-- every night. A genuine later cancellation creates a fresh row.

alter table public.cancellations
  add column if not exists voided_at   timestamptz,
  add column if not exists void_reason text;

comment on column public.cancellations.voided_at is
  'Set when the scheduled purge was refused because the user was still subscribed at the deletion date (i.e. they never completed the store-side cancellation). Non-null rows are permanently skipped by the deletion jobs.';

comment on column public.cancellations.void_reason is
  'Human-readable explanation recorded alongside voided_at, e.g. "still subscribed (status=active)".';

-- The deletion jobs scan for due, undeleted, unvoided rows. Partial index keeps
-- that nightly scan cheap as the table grows.
create index if not exists cancellations_pending_purge_idx
  on public.cancellations (deletion_scheduled_for)
  where is_deleted = false and voided_at is null;

-- ── Confirm ────────────────────────────────────────────────────────────────
-- Expect two rows: voided_at (timestamp with time zone), void_reason (text).
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'cancellations'
  and column_name in ('voided_at', 'void_reason')
order by column_name;

-- Expect 0 on a fresh install. Any rows here are cancellation requests where
-- the user never actually cancelled in the store — worth reviewing.
select count(*) as voided_cancellations
from public.cancellations
where voided_at is not null;
