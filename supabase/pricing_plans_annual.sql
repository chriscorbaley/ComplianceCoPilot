-- ═══════════════════════════════════════════════════════════════════════════
-- Annual (paid-in-full) pricing for subscription plans
-- ═══════════════════════════════════════════════════════════════════════════
-- Additive follow-up to pricing_plans.sql. Adds an annual paid-in-full option
-- alongside the existing monthly pricing so business owners can pay once a year
-- at a discount. This is DATA ONLY for now — the monthly/annual toggle UI on the
-- onboarding and payment screens ships with the Stripe work. Nothing here
-- changes monthly pricing, gating, or subscription_tier logic.
--
--   annual_price         numeric  — rounded whole-dollar charge billed once/year
--   annual_discount_pct  numeric  — % savings vs paying monthly (default 10)
--   annual_enabled       boolean  — whether the annual option is offered (default true)
--
-- Run in Supabase → SQL Editor. Idempotent: safe to re-run.

alter table public.pricing_plans
  add column if not exists annual_price numeric,
  add column if not exists annual_discount_pct numeric not null default 10,
  add column if not exists annual_enabled boolean not null default true;

-- ── Backfill rounded annual prices ───────────────────────────────────────────
-- round(monthly * 12 * (1 - 10/100)), then rounded to a clean whole-dollar
-- figure: Basic $529, Core $1069, Pro $2149. Only fills rows that don't yet
-- have an annual_price so a hand-tuned value is never clobbered on re-run.
update public.pricing_plans set annual_price = 529  where plan_key = 'starter' and annual_price is null;
update public.pricing_plans set annual_price = 1069 where plan_key = 'core'    and annual_price is null;
update public.pricing_plans set annual_price = 2149 where plan_key = 'pro'     and annual_price is null;

-- Confirm: should print the three plans with their annual pricing.
select plan_key, display_name, monthly_price, annual_price, annual_discount_pct, annual_enabled
from public.pricing_plans
order by sort_order;
