-- ═══════════════════════════════════════════════════════════════════════════
-- Email templates: transactional email subject + body, admin-editable
-- ═══════════════════════════════════════════════════════════════════════════
-- Moves the subject line and HTML body of every system email out of the app /
-- Edge Function code and into the database so they can be edited from the Admin
-- panel without shipping a new build. Rendered at send time by substituting
-- {placeholder} tokens (see src/services/emailTemplates.ts renderTemplate).
--
-- The four templates are seeded once; the Admin editor updates subject +
-- body_html in place (there is no versioning — unlike legal_documents).
--
-- NOTE: In production this table already exists and is seeded. This file
-- documents the schema and is idempotent (safe to re-run): the create is
-- guarded and the seed uses ON CONFLICT DO NOTHING so it never overwrites
-- admin edits.
--
-- Run in Supabase → SQL Editor.

create table if not exists public.email_templates (
  id uuid primary key default uuid_generate_v4(),
  template_key text not null unique
    check (template_key in ('welcome', 'verification', 'deletion_warning', 'cancellation_confirm')),
  subject text not null,
  body_html text not null,
  -- Variable names (without braces) this template supports, e.g.
  -- ["user_name", "tax_year"]. Drives the Admin editor's insertable chips.
  available_variables jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Row level security ──────────────────────────────────────────────────────
-- Read: authenticated users (send paths / admin editor). Write: admins only.
-- No delete policy is defined, so RLS denies deletes for everyone.

alter table public.email_templates enable row level security;

drop policy if exists email_templates_read on public.email_templates;
create policy email_templates_read on public.email_templates
  for select to authenticated using (true);

drop policy if exists email_templates_admin_insert on public.email_templates;
create policy email_templates_admin_insert on public.email_templates
  for insert to authenticated with check (public.is_admin());

drop policy if exists email_templates_admin_update on public.email_templates;
create policy email_templates_admin_update on public.email_templates
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── Seed (idempotent — never overwrites existing/edited rows) ────────────────

insert into public.email_templates (template_key, subject, body_html, available_variables)
values
  (
    'welcome',
    'Welcome to Compliance Co-Pilot — your account is ready',
    '<!doctype html><html><body style="font-family:-apple-system,system-ui,sans-serif;color:#1a1a2e;max-width:560px;margin:0 auto;padding:24px;"><h1 style="color:#042C53;">Welcome to Compliance Co-Pilot</h1><p>Hi {user_name},</p><p>Your account is ready. Your {trial_days}-day free trial of <strong>{plan_name}</strong> has begun.</p><p><strong>Price:</strong> {plan_price}/month after trial. <strong>Next billing:</strong> {next_billing_date}.</p><p><a href="{app_link}">Open Compliance Co-Pilot</a></p></body></html>',
    '["user_name","plan_name","plan_price","trial_days","next_billing_date","app_link"]'::jsonb
  ),
  (
    'verification',
    'Verify your Compliance Co-Pilot email',
    '<!doctype html><html><body style="font-family:-apple-system,system-ui,sans-serif;color:#1a1a2e;max-width:560px;margin:0 auto;padding:24px;"><h1 style="color:#042C53;">Confirm your email</h1><p>Hi {user_name},</p><p>Tap below to verify your email address.</p><p><a href="{verification_link}">Verify email</a></p></body></html>',
    '["user_name","verification_link"]'::jsonb
  ),
  (
    'deletion_warning',
    'Your Compliance Co-Pilot documents will be deleted soon',
    '<!doctype html><html><body style="font-family:-apple-system,system-ui,sans-serif;color:#1a1a2e;max-width:560px;margin:0 auto;padding:24px;"><h1 style="color:#A32D2D;">Documents scheduled for deletion</h1><p>Hi {user_name},</p><p><strong>Your {document_count} compliance document(s) will be permanently deleted on {deletion_date}.</strong> After that date they cannot be recovered.</p></body></html>',
    '["user_name","deletion_date","document_count"]'::jsonb
  ),
  (
    'cancellation_confirm',
    'Your Compliance Co-Pilot subscription has been cancelled',
    '<!doctype html><html><body style="font-family:-apple-system,system-ui,sans-serif;color:#1a1a2e;max-width:560px;margin:0 auto;padding:24px;"><h1 style="color:#A32D2D;">Subscription Cancelled</h1><p>Hi {user_name},</p><p>This confirms your subscription has been cancelled.</p><p><strong>Your {document_count} compliance document(s) will be permanently deleted on {deletion_date}.</strong></p></body></html>',
    '["user_name","deletion_date","document_count"]'::jsonb
  )
on conflict (template_key) do nothing;

-- Confirm: should print the four templates.
select template_key, subject, jsonb_array_length(available_variables) as var_count
from public.email_templates
order by template_key;
