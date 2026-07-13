-- ════════════════════════════════════════════════════════════════════════
-- Mileage Tracker (Pro feature)
-- Adds the `vehicles` and `mileage_log` tables, their RLS policies, and the
-- IRS standard mileage rates read by the Mileage screen and PDF report.
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

-- ─── vehicles ──────────────────────────────────────────────────────────────
create table if not exists public.vehicles (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  year integer,
  make text,
  model text,
  nickname text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists vehicles_user_idx on public.vehicles(user_id);
create index if not exists vehicles_business_idx on public.vehicles(business_id);

-- ─── mileage_log ─────────────────────────────────────────────────────────
create table if not exists public.mileage_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  trip_date date,
  start_odometer numeric,
  end_odometer numeric,
  total_miles numeric,
  trip_type text check (trip_type in ('business', 'medical')),
  purpose text,
  tax_year integer,
  deduction_amount numeric,
  created_at timestamptz not null default now()
);
create index if not exists mileage_log_user_year_idx
  on public.mileage_log(user_id, tax_year, trip_date desc);
create index if not exists mileage_log_vehicle_idx
  on public.mileage_log(vehicle_id);
create index if not exists mileage_log_business_idx
  on public.mileage_log(business_id);

-- ─── RLS ───────────────────────────────────────────────────────────────────
alter table public.vehicles enable row level security;
alter table public.mileage_log enable row level security;

do $$
declare t text;
begin
  foreach t in array array['vehicles', 'mileage_log']
  loop
    execute format('drop policy if exists %I_select_own on public.%I;', t, t);
    execute format('create policy %I_select_own on public.%I for select to authenticated using (user_id = auth.uid());', t, t);
    execute format('drop policy if exists %I_insert_own on public.%I;', t, t);
    execute format('create policy %I_insert_own on public.%I for insert to authenticated with check (user_id = auth.uid());', t, t);
    execute format('drop policy if exists %I_update_own on public.%I;', t, t);
    execute format('create policy %I_update_own on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());', t, t);
    execute format('drop policy if exists %I_delete_own on public.%I;', t, t);
    execute format('create policy %I_delete_own on public.%I for delete to authenticated using (user_id = auth.uid());', t, t);
  end loop;
end $$;

-- ─── IRS standard mileage rates (compliance_rules) ──────────────────────────
-- Read by the Mileage screen via key 'business_rate_[year]' / 'medical_rate_[year]'
-- under strategy_name = 'mileage'. Values are dollars per mile. Admins can edit
-- these from the Rules editor; the app falls back to these defaults if a row is
-- missing.
insert into public.compliance_rules (strategy_name, rule_key, rule_value, display_label)
values
  ('mileage', 'business_rate_2023', '0.655', 'IRS business mileage rate — 2023'),
  ('mileage', 'medical_rate_2023',  '0.22',  'IRS medical mileage rate — 2023'),
  ('mileage', 'business_rate_2024', '0.67',  'IRS business mileage rate — 2024'),
  ('mileage', 'medical_rate_2024',  '0.21',  'IRS medical mileage rate — 2024'),
  ('mileage', 'business_rate_2025', '0.70',  'IRS business mileage rate — 2025'),
  ('mileage', 'medical_rate_2025',  '0.21',  'IRS medical mileage rate — 2025'),
  ('mileage', 'business_rate_2026', '0.70',  'IRS business mileage rate — 2026'),
  ('mileage', 'medical_rate_2026',  '0.21',  'IRS medical mileage rate — 2026')
on conflict (strategy_name, rule_key) do nothing;
