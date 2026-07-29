-- ═══════════════════════════════════════════════════════════════════════════
-- Subscription pricing plans (editable from the Admin panel)
-- ═══════════════════════════════════════════════════════════════════════════
-- Moves subscription pricing out of the app binary and into the database so
-- price, trial length, feature bullets, and availability can be edited from the
-- Admin → Pricing tab without shipping a new build. Client apps read the active
-- rows and re-render on next launch.
--
-- IMPORTANT: `plan_key` is the STABLE identity used for all subscription_tier
-- gating ('starter' | 'core' | 'pro'). plan_key 'starter' is displayed as
-- 'Basic' via display_name — the gating value stays 'starter'. Only the shown
-- name and price come from this table; never change plan_key.
--
-- Run in Supabase → SQL Editor. Idempotent: safe to re-run.

create table if not exists public.pricing_plans (
  plan_key text primary key check (plan_key in ('starter', 'core', 'pro')),
  display_name text not null,
  monthly_price numeric not null,
  trial_days integer not null default 3,
  sort_order integer not null default 0,
  features jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ── Row level security ──────────────────────────────────────────────────────
-- Public read: anyone (anon + authenticated) can read plans to render pricing.
-- Admin write: only is_admin() users may insert or update.

alter table public.pricing_plans enable row level security;

drop policy if exists pricing_plans_read on public.pricing_plans;
create policy pricing_plans_read on public.pricing_plans
  for select to anon, authenticated using (true);

drop policy if exists pricing_plans_admin_insert on public.pricing_plans;
create policy pricing_plans_admin_insert on public.pricing_plans
  for insert to authenticated with check (public.is_admin());

drop policy if exists pricing_plans_admin_update on public.pricing_plans;
create policy pricing_plans_admin_update on public.pricing_plans
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Keep updated_at fresh on any edit.
create or replace function public.set_pricing_plans_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists pricing_plans_set_updated_at on public.pricing_plans;
create trigger pricing_plans_set_updated_at
  before update on public.pricing_plans
  for each row execute function public.set_pricing_plans_updated_at();

-- ── Seed (only if a plan_key doesn't already exist) ──────────────────────────
insert into public.pricing_plans (plan_key, display_name, monthly_price, trial_days, sort_order, features, is_active)
values
  ('starter', 'Basic', 49, 3, 1, $$[
    "1 tax strategy",
    "AI document generator",
    "Strategy-specific compliance checklists",
    "Document storage"
  ]$$::jsonb, true),
  ('core', 'Core', 99, 3, 2, $$[
    "Up to 3 tax strategies",
    "All Basic features",
    "Strategy progress tracking",
    "Priority support"
  ]$$::jsonb, true),
  ('pro', 'Pro', 199, 3, 3, $$[
    "All strategies",
    "AI voice meeting minutes",
    "Complete audit trail",
    "Mileage tracker with IRS deduction calculator",
    "All Core and Basic features"
  ]$$::jsonb, true)
on conflict (plan_key) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- Admin audit log (optional — records who changed what)
-- ═══════════════════════════════════════════════════════════════════════════
-- The app writes an entry here whenever a pricing plan is edited. The write is
-- best-effort in the client: if this table is absent the pricing edit still
-- succeeds. Creating it here enables the audit trail.

-- Columns must match src/services/auditLog.ts, which is the only write path in
-- the app. This DDL previously declared admin_id / table_name / details; the
-- live table was since changed to the shape below, and the stale version here
-- is what the revenuecat-webhook function was written against — every one of
-- its audit inserts failed silently. Do not reintroduce the old names.
create table if not exists public.admin_audit_log (
  id uuid primary key default uuid_generate_v4(),
  admin_email text,
  action text not null,
  table_affected text,
  record_key text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

alter table public.admin_audit_log enable row level security;

drop policy if exists admin_audit_log_admin_read on public.admin_audit_log;
create policy admin_audit_log_admin_read on public.admin_audit_log
  for select to authenticated using (public.is_admin());

drop policy if exists admin_audit_log_admin_insert on public.admin_audit_log;
create policy admin_audit_log_admin_insert on public.admin_audit_log
  for insert to authenticated with check (public.is_admin());

-- Confirm: should print the three plans.
select plan_key, display_name, monthly_price, trial_days, sort_order, is_active,
       jsonb_array_length(features) as feature_count
from public.pricing_plans
order by sort_order;
