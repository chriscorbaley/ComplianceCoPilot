-- ═══════════════════════════════════════════════════════════════════════════
-- Global feature flags (editable from the Admin panel)
-- ═══════════════════════════════════════════════════════════════════════════
-- A firm-wide on/off switch for whole features, independent of subscription
-- tier. Toggling a flag from Admin → Flags propagates to every client app
-- within seconds via the realtime subscription in FeatureFlagContext.
--
-- IMPORTANT: this layer sits ON TOP OF subscription-tier gating. A feature
-- shows only when it is BOTH enabled by its flag AND allowed by the user's
-- tier. Flags never override tier gating — they only add a global switch.
--
-- The client is FAIL-OPEN: a missing row or failed read leaves the feature
-- enabled, so this table only ever turns features off.
--
-- Run in Supabase → SQL Editor. Idempotent: safe to re-run.

create table if not exists public.feature_flags (
  flag_key text primary key,
  description text,
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ── Row level security ──────────────────────────────────────────────────────
-- Public read: anyone (anon + authenticated) can read flags so the client can
-- evaluate them. Admin write: only is_admin() users may insert or update.

alter table public.feature_flags enable row level security;

drop policy if exists feature_flags_read on public.feature_flags;
create policy feature_flags_read on public.feature_flags
  for select to anon, authenticated using (true);

drop policy if exists feature_flags_admin_insert on public.feature_flags;
create policy feature_flags_admin_insert on public.feature_flags
  for insert to authenticated with check (public.is_admin());

drop policy if exists feature_flags_admin_update on public.feature_flags;
create policy feature_flags_admin_update on public.feature_flags
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Keep updated_at fresh on any edit.
create or replace function public.set_feature_flags_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists feature_flags_set_updated_at on public.feature_flags;
create trigger feature_flags_set_updated_at
  before update on public.feature_flags
  for each row execute function public.set_feature_flags_updated_at();

-- Broadcast row changes to realtime subscribers (safe to run repeatedly).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'feature_flags'
  ) then
    alter publication supabase_realtime add table public.feature_flags;
  end if;
end $$;

-- ── Seed (only if a flag_key doesn't already exist) ──────────────────────────
insert into public.feature_flags (flag_key, description, is_enabled)
values
  ('mileage_tracker',             'Pro mileage tracker with IRS deduction calculator and the Mileage tab.', true),
  ('business_travel',             'Business Travel tracker (Trips tab) and business-travel strategy behavior.', true),
  ('voice_features',              'Voice logging / AI meeting minutes and all in-app microphone buttons.', true),
  ('cancellation_signature',      'Double hand-signature flow when cancelling a subscription.', true),
  ('document_retention_warnings', 'Year-end document retention warning banners and reminders.', true),
  ('augusta_rule',                'Augusta Rule strategy (14-day tax-free home rental).', true),
  ('s_corp',                      'S-Corp compliance strategy and its document checklist.', true),
  ('home_office',                 'Home Office deduction strategy and its document checklist.', true),
  ('family_management',           'Family Management Company strategy and its document checklist.', true),
  ('real_estate',                 'Real Estate / REPS strategy and material-participation tracking.', true)
on conflict (flag_key) do nothing;

-- Confirm: should print all ten flags.
select flag_key, is_enabled, description
from public.feature_flags
order by flag_key;
