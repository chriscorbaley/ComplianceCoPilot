-- ═══════════════════════════════════════════════════════════════════════════
-- Document Templates feature: S-Corp signed documents (Accountable Plan, Board
-- Resolution) and Augusta Rule rentals (lease, invoice, rate comparables).
--
-- Run this against an existing schema.sql database. Everything here is additive
-- and idempotent (create table if not exists / on conflict do nothing), so it is
-- safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── scorp_signatures ──────────────────────────────────────────────────────
-- One row per finger-signed S-Corp document (accountable plan, board
-- resolution). The PNG itself lives in the scorp-signatures storage bucket;
-- signature_url is the storage path.
create table if not exists public.scorp_signatures (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  document_type text not null,            -- 'accountable_plan' | 'board_resolution'
  signature_url text,                     -- storage path in scorp-signatures bucket
  signer_name text,
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists scorp_signatures_user_idx
  on public.scorp_signatures(user_id, created_at desc);

-- ─── augusta_rentals ───────────────────────────────────────────────────────
-- One row per Augusta Rule rental event for which a lease and/or invoice was
-- generated. The meeting minutes still live in meeting_minutes/documents; this
-- table is the home for the generated lease + invoice and the paid status.
create table if not exists public.augusta_rentals (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  property_name text,                     -- the rented property/location
  business_entity_name text,
  rental_date date,
  duration_hours numeric,
  rental_rate numeric,
  total_amount numeric,
  meeting_purpose text,
  invoice_number text,
  lease_url text,                         -- documents.id of the generated lease
  invoice_url text,                       -- documents.id of the generated invoice
  invoice_paid boolean not null default false,
  invoice_paid_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists augusta_rentals_user_idx
  on public.augusta_rentals(user_id, rental_date desc);
create index if not exists augusta_rentals_business_idx
  on public.augusta_rentals(business_id);

-- ─── augusta_comparables ───────────────────────────────────────────────────
-- One row per property per tax year: the three comparable-rate screenshots that
-- justify the rate used for that property's Augusta rentals that year.
create table if not exists public.augusta_comparables (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  business_id uuid references public.businesses(id) on delete set null,
  property_name text,
  tax_year integer,
  comparable_1_url text,
  comparable_2_url text,
  comparable_3_url text,
  rental_rate_justified numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists augusta_comparables_user_idx
  on public.augusta_comparables(user_id, tax_year desc);
-- One comparable set per (business, property, year).
create unique index if not exists augusta_comparables_unique_idx
  on public.augusta_comparables(user_id, business_id, property_name, tax_year);

-- ─── Row Level Security ────────────────────────────────────────────────────
-- Same per-user policy pattern used by businesses/documents/etc in schema.sql.
do $$
declare
  t text;
begin
  foreach t in array array['scorp_signatures', 'augusta_rentals', 'augusta_comparables']
  loop
    execute format('alter table public.%I enable row level security;', t);
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

-- ═══════════════════════════════════════════════════════════════════════════
-- Storage buckets
-- ═══════════════════════════════════════════════════════════════════════════

-- Private bucket for captured signature PNGs.
-- Path convention: scorp-signatures/<user_id>/<document_type>_<date>.png
insert into storage.buckets (id, name, public)
values ('scorp-signatures', 'scorp-signatures', false)
on conflict (id) do nothing;

-- Private bucket for Augusta rate-comparable screenshots/PDFs.
-- Path convention: augusta-comparables/<user_id>/<property>/<year>/<slot>.<ext>
insert into storage.buckets (id, name, public)
values ('augusta-comparables', 'augusta-comparables', false)
on conflict (id) do nothing;

-- Per-bucket owner-folder policies (first path segment must equal the uid),
-- mirroring the strategy-documents bucket policies.
do $$
declare
  b text;
begin
  foreach b in array array['scorp-signatures', 'augusta-comparables']
  loop
    execute format($f$drop policy if exists %I_insert_own on storage.objects;$f$, replace(b, '-', '_'));
    execute format($f$create policy %I_insert_own on storage.objects for insert to authenticated with check (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text);$f$, replace(b, '-', '_'), b);
    execute format($f$drop policy if exists %I_select_own on storage.objects;$f$, replace(b, '-', '_'));
    execute format($f$create policy %I_select_own on storage.objects for select to authenticated using (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text);$f$, replace(b, '-', '_'), b);
    execute format($f$drop policy if exists %I_update_own on storage.objects;$f$, replace(b, '-', '_'));
    execute format($f$create policy %I_update_own on storage.objects for update to authenticated using (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text);$f$, replace(b, '-', '_'), b);
    execute format($f$drop policy if exists %I_delete_own on storage.objects;$f$, replace(b, '-', '_'));
    execute format($f$create policy %I_delete_own on storage.objects for delete to authenticated using (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text);$f$, replace(b, '-', '_'), b);
  end loop;
end $$;
