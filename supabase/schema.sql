-- Compliance Co-Pilot Supabase schema.
-- Paste into Supabase → SQL Editor → Run, or apply via `supabase db push`.
--
-- Safe to re-run: every CREATE uses IF NOT EXISTS, every policy uses
-- DROP POLICY IF EXISTS first, and the compliance_rules seed uses ON CONFLICT.

create extension if not exists "uuid-ossp";

-- ─── users ───────────────────────────────────────────────────────────────
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  active_strategies text[] default '{}'::text[],
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- Automatically mirror auth.users → public.users on signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── hours_log ───────────────────────────────────────────────────────────
create table if not exists public.hours_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  description text,
  category text,
  hours numeric,
  activity_date date,
  created_at timestamptz not null default now()
);
create index if not exists hours_log_user_date_idx
  on public.hours_log(user_id, activity_date desc);

-- ─── business_trips ──────────────────────────────────────────────────────
create table if not exists public.business_trips (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  trip_type text check (trip_type in ('domestic', 'international')),
  destination text,
  countries_visited text[],
  purpose text,
  departure_date date,
  return_date date,
  total_days integer,
  business_days integer,
  personal_days integer,
  business_day_pct numeric,
  transport_deduct_pct numeric,
  day_by_day_log jsonb,
  itinerary_transcript text,
  compliance_verdict text,
  compliance_notes text,
  expenses_transport numeric,
  expenses_lodging numeric,
  expenses_meals numeric,
  expenses_other numeric,
  status text,
  created_at timestamptz not null default now()
);
create index if not exists business_trips_user_date_idx
  on public.business_trips(user_id, departure_date desc);

-- ─── meeting_minutes ─────────────────────────────────────────────────────
create table if not exists public.meeting_minutes (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  meeting_type text,
  location text,
  meeting_date date,
  transcript text,
  minutes_document text,
  attendee_count integer,
  status text check (status in ('complete', 'draft')),
  created_at timestamptz not null default now()
);
create index if not exists meeting_minutes_user_date_idx
  on public.meeting_minutes(user_id, meeting_date desc);

-- ─── documents ───────────────────────────────────────────────────────────
create table if not exists public.documents (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text,
  strategy_category text,
  file_url text,
  file_type text,
  created_at timestamptz not null default now()
);
create index if not exists documents_user_date_idx
  on public.documents(user_id, created_at desc);

-- ─── compliance_rules (firm-wide, not user-scoped) ───────────────────────
create table if not exists public.compliance_rules (
  id uuid primary key default uuid_generate_v4(),
  strategy_name text not null,
  rule_key text not null,
  rule_value text not null,
  display_label text,
  updated_at timestamptz not null default now(),
  updated_by text,
  unique (strategy_name, rule_key)
);

-- ─── regulatory_alerts (admin-only) ──────────────────────────────────────
create table if not exists public.regulatory_alerts (
  id uuid primary key default uuid_generate_v4(),
  source text check (source in ('IRS', 'TaxCourt', 'Congress')),
  document_title text,
  document_url text,
  published_date date,
  affected_strategies text[],
  ai_summary text,
  affected_rule_keys text[],
  suggested_values jsonb,
  status text check (status in ('pending_review', 'approved', 'dismissed')),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists regulatory_alerts_status_idx
  on public.regulatory_alerts(status, created_at desc);

-- ─── strategies (admin-toggleable on/off list) ───────────────────────────
create table if not exists public.strategies (
  id text primary key,
  display_name text not null,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

-- ─── document_templates (PDF body content per strategy) ──────────────────
create table if not exists public.document_templates (
  id uuid primary key default uuid_generate_v4(),
  strategy_name text not null,
  template_key text not null,
  display_label text,
  template_content text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text,
  unique (strategy_name, template_key)
);

-- ─── form_fields (per-strategy, orderable) ───────────────────────────────
create table if not exists public.form_fields (
  id uuid primary key default uuid_generate_v4(),
  strategy_name text not null,
  field_key text not null,
  field_label text not null,
  field_type text not null default 'text',
  required boolean not null default false,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (strategy_name, field_key)
);
create index if not exists form_fields_strategy_idx
  on public.form_fields(strategy_name, sort_order);

-- ─── irc_references (IRC section + citation per strategy) ────────────────
create table if not exists public.irc_references (
  id uuid primary key default uuid_generate_v4(),
  strategy_name text not null,
  irc_section text not null,
  citation text not null default '',
  display_label text,
  updated_at timestamptz not null default now(),
  unique (strategy_name, irc_section)
);

-- ─── announcements (admin-published banner notifications) ────────────────
create table if not exists public.announcements (
  id uuid primary key default uuid_generate_v4(),
  message text not null,
  published_at timestamptz not null default now(),
  expires_at timestamptz,
  published_by text
);
create index if not exists announcements_published_idx
  on public.announcements(published_at desc);

-- ─── processed_rss_items (dedupe for the RSS scanner edge function) ──────
create table if not exists public.processed_rss_items (
  guid text primary key,
  source text,
  processed_at timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Row Level Security
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.users enable row level security;
alter table public.hours_log enable row level security;
alter table public.business_trips enable row level security;
alter table public.meeting_minutes enable row level security;
alter table public.documents enable row level security;
alter table public.compliance_rules enable row level security;
alter table public.regulatory_alerts enable row level security;
alter table public.strategies enable row level security;
alter table public.document_templates enable row level security;
alter table public.form_fields enable row level security;
alter table public.irc_references enable row level security;
alter table public.announcements enable row level security;
alter table public.processed_rss_items enable row level security;

-- Helper: is the current user an admin? Used by compliance_rules + alerts.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin from public.users where id = auth.uid()),
    false
  );
$$;

-- users: read own row, admins read all; users update own row.
drop policy if exists users_select_own on public.users;
create policy users_select_own on public.users
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists users_update_own on public.users;
create policy users_update_own on public.users
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Pattern for the four user-owned tables: full CRUD when user_id = auth.uid().
do $$
declare t text;
begin
  foreach t in array array['hours_log', 'business_trips', 'meeting_minutes', 'documents']
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

-- compliance_rules: anyone authenticated reads, admins write.
drop policy if exists compliance_rules_read on public.compliance_rules;
create policy compliance_rules_read on public.compliance_rules
  for select to authenticated using (true);

drop policy if exists compliance_rules_admin_write on public.compliance_rules;
create policy compliance_rules_admin_write on public.compliance_rules
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- regulatory_alerts: admin-only.
drop policy if exists regulatory_alerts_admin on public.regulatory_alerts;
create policy regulatory_alerts_admin on public.regulatory_alerts
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Firm-wide read tables (clients read, admins write):
-- strategies, document_templates, form_fields, irc_references, announcements
do $$
declare t text;
begin
  foreach t in array array['strategies', 'document_templates', 'form_fields',
                            'irc_references', 'announcements']
  loop
    execute format('drop policy if exists %I_read on public.%I;', t, t);
    execute format('create policy %I_read on public.%I for select to authenticated using (true);', t, t);
    execute format('drop policy if exists %I_admin_write on public.%I;', t, t);
    execute format('create policy %I_admin_write on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin());', t, t);
  end loop;
end $$;

-- processed_rss_items: admin-only (the edge function uses the service role).
drop policy if exists processed_rss_items_admin on public.processed_rss_items;
create policy processed_rss_items_admin on public.processed_rss_items
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ═══════════════════════════════════════════════════════════════════════════
-- Realtime
-- ═══════════════════════════════════════════════════════════════════════════

-- Enable realtime change feeds for tables that need push updates.
do $$
declare t text;
begin
  perform 1 from pg_publication where pubname = 'supabase_realtime';
  if not found then return; end if;
  foreach t in array array['compliance_rules', 'regulatory_alerts', 'strategies',
                            'document_templates', 'form_fields',
                            'irc_references', 'announcements']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Seed compliance_rules
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.compliance_rules (strategy_name, rule_key, rule_value, display_label) values
  ('real_estate',             'hours_required',            '750',                                                      'Material participation — annual hours'),
  ('real_estate',             'required_docs',             'activity_log,property_list',                                'Real estate — required documents'),
  ('augusta_rule',            'max_days',                  '14',                                                       'Augusta Rule — annual day cap'),
  ('augusta_rule',            'required_docs',             'rental_agreement,meeting_minutes,payment_records',          'Augusta Rule — required documents'),
  ('s_corp',                  'required_docs',             'salary_documentation,payroll_records,quarterly_filings',    'S-Corp — required documents'),
  ('business_travel_domestic','primary_purpose_threshold', '50',                                                       'Domestic primarily-business test (%)'),
  ('business_travel_intl',    'short_trip_day_limit',      '7',                                                        'Intl short-trip exception (days)'),
  ('business_travel_intl',    'personal_day_threshold',    '25',                                                       'Intl personal-day allocation threshold (%)'),
  ('business_travel_meals',   'deduct_pct',                '50',                                                       'Meals deduction (%) — IRC §274(n)'),
  ('home_office',             'required_docs',             'square_footage,expense_log,exclusive_use',                  'Home office — required documents'),
  ('family_management',       'required_docs',             'entity_docs,employment_agreements,meeting_records',         'Family management — required documents')
on conflict (strategy_name, rule_key) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- Seed strategies (the 7 toggleable strategies)
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.strategies (id, display_name, sort_order) values
  ('real_estate',        'Real Estate Professional Status',  1),
  ('augusta_rule',       'Augusta Rule',                     2),
  ('s_corp',             'S-Corp Reasonable Compensation',   3),
  ('business_travel',    'Business Travel Deductibility',    4),
  ('home_office',        'Home Office',                      5),
  ('family_management',  'Family Management Company',        6),
  ('vehicle',            'Vehicle / Section 179',            7)
on conflict (id) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- Seed document_templates
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.document_templates (strategy_name, template_key, display_label, template_content) values
  ('augusta_rule',      'rental_agreement',  'Augusta Rule rental agreement',
    'RENTAL AGREEMENT\n\nThis agreement is between {{owner_name}} and {{business_name}} for the rental of {{property_address}} on {{rental_dates}}. Rate: {{daily_rate}}/day. Total: {{total_amount}}.'),
  ('augusta_rule',      'meeting_minutes',   'Augusta Rule meeting minutes',
    'BOARD MEETING MINUTES\n\nDate: {{meeting_date}}\nLocation: {{property_address}}\nAttendees: {{attendees}}\nAgenda: {{agenda}}'),
  ('s_corp',            'comp_memo',         'S-Corp compensation memo',
    'REASONABLE COMPENSATION MEMO\n\nShareholder-employee: {{name}}\nSalary: {{salary}}\nBasis: {{methodology}}\nIRC §3121 analysis: {{analysis}}'),
  ('real_estate',       'activity_log',      'Real estate activity log',
    'ACTIVITY LOG\n\nTaxpayer: {{name}}\nYear: {{year}}\nProperties: {{properties}}\nHours logged: {{hours}}\nMaterial participation test: {{test}}'),
  ('home_office',       'exclusive_use_attest',  'Home office attestation',
    'HOME OFFICE ATTESTATION\n\nI, {{name}}, attest that {{sq_ft}} sq ft of my residence at {{address}} is used regularly and exclusively for {{business_name}}.'),
  ('family_management', 'employment_agreement',  'Family management employment agreement',
    'EMPLOYMENT AGREEMENT\n\nEmployer: {{family_mgmt_co}}\nEmployee: {{employee_name}}\nRole: {{role}}\nCompensation: {{compensation}}')
on conflict (strategy_name, template_key) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- Seed form_fields
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.form_fields (strategy_name, field_key, field_label, field_type, required, sort_order) values
  ('real_estate',       'property_address',  'Property address',     'text',     true,  1),
  ('real_estate',       'hours',             'Hours',                'number',   true,  2),
  ('real_estate',       'activity_type',     'Activity type',        'text',     false, 3),
  ('augusta_rule',      'rental_date',       'Rental date',          'date',     true,  1),
  ('augusta_rule',      'daily_rate',        'Daily rate',           'number',   true,  2),
  ('augusta_rule',      'business_purpose',  'Business purpose',     'text',     true,  3),
  ('s_corp',            'salary',            'Salary',               'number',   true,  1),
  ('s_corp',            'distributions',     'Distributions',        'number',   false, 2),
  ('business_travel',   'destination',       'Destination',          'text',     true,  1),
  ('business_travel',   'departure_date',    'Departure date',       'date',     true,  2),
  ('business_travel',   'return_date',       'Return date',          'date',     true,  3),
  ('business_travel',   'business_purpose',  'Business purpose',     'text',     true,  4),
  ('home_office',       'square_feet',       'Square feet',          'number',   true,  1),
  ('home_office',       'total_home_sqft',   'Total home sqft',      'number',   true,  2),
  ('family_management', 'employee_name',     'Employee name',        'text',     true,  1),
  ('family_management', 'role',              'Role',                 'text',     true,  2),
  ('family_management', 'compensation',      'Compensation',         'number',   true,  3),
  ('vehicle',           'vehicle_make',      'Vehicle make/model',   'text',     true,  1),
  ('vehicle',           'business_use_pct',  'Business use %',       'number',   true,  2)
on conflict (strategy_name, field_key) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- Seed irc_references
-- ═══════════════════════════════════════════════════════════════════════════

insert into public.irc_references (strategy_name, irc_section, citation, display_label) values
  ('real_estate',       'IRC §469',     '26 U.S.C. § 469 (Passive activity losses and credits limited)',
    'Real estate professional status'),
  ('augusta_rule',      'IRC §280A(g)', '26 U.S.C. § 280A(g) (14-day rental exclusion)',
    'Augusta Rule'),
  ('s_corp',            'IRC §3121',    '26 U.S.C. § 3121 (Definitions — wages and FICA)',
    'S-Corp reasonable compensation'),
  ('business_travel',   'IRC §162',     '26 U.S.C. § 162 (Trade or business expenses)',
    'Business travel — ordinary and necessary'),
  ('business_travel',   'IRC §274',     '26 U.S.C. § 274 (Disallowance of certain entertainment expenses)',
    'Business travel — substantiation and allocation'),
  ('home_office',       'IRC §280A',    '26 U.S.C. § 280A (Disallowance of certain expenses in connection with business use of home)',
    'Home office deduction'),
  ('family_management', 'IRC §162',     '26 U.S.C. § 162 (Trade or business expenses — wages)',
    'Family management company wages')
on conflict (strategy_name, irc_section) do nothing;
