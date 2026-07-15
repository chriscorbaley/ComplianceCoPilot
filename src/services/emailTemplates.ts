// Transactional email templates live in the Supabase `email_templates` table so
// the subject line and HTML body of every system email (welcome, verification,
// deletion warning, cancellation confirm) can be edited from the Admin panel
// without shipping a new build.
//
// The email PROVIDER (Resend/SendGrid) is not wired up yet in the client — this
// module is the fetch + render layer that the eventual send call plugs into.
// `renderTemplate` substitutes {placeholder} tokens with real values and returns
// the final subject + HTML ready to hand to the provider.
//
// The hardcoded FALLBACK_TEMPLATES below are the SHIPPED safety net: if the
// table read ever fails (offline, RLS, cold start, template not seeded) callers
// still get sane last-known-good text instead of an empty email.

import { supabase } from './supabase';
import type { EmailTemplateKey, EmailTemplateRow } from './supabase';

export interface EmailTemplate {
  template_key: EmailTemplateKey;
  subject: string;
  body_html: string;
  available_variables: string[];
}

export interface RenderedEmail {
  subject: string;
  bodyHtml: string;
}

// ── Fallback templates (shipped in the binary) ──────────────────────────────
// Mirror the previously-hardcoded email bodies. Kept intentionally simple; the
// live table rows can be far richer. Used only when the table read fails.
export const FALLBACK_TEMPLATES: Record<EmailTemplateKey, EmailTemplate> = {
  welcome: {
    template_key: 'welcome',
    subject: 'Welcome to Compliance Co-Pilot — your account is ready',
    body_html: `<!doctype html><html><body style="font-family:-apple-system,system-ui,sans-serif;color:#1a1a2e;max-width:560px;margin:0 auto;padding:24px;">
  <h1 style="color:#042C53;margin-bottom:8px;">Welcome to Compliance Co-Pilot</h1>
  <p>Hi {user_name},</p>
  <p>Your account is ready. Your {trial_days}-day free trial of <strong>{plan_name}</strong> has begun.</p>
  <div style="background:#F5F7FA;border-left:4px solid #185FA5;padding:16px;border-radius:8px;margin:24px 0;">
    <p style="margin:0;"><strong>Plan:</strong> {plan_name}</p>
    <p style="margin:6px 0 0;"><strong>Price:</strong> {plan_price}/month after trial</p>
    <p style="margin:6px 0 0;"><strong>Next billing date:</strong> {next_billing_date}</p>
  </div>
  <p><a href="{app_link}" style="display:inline-block;background:#042C53;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">Open Compliance Co-Pilot</a></p>
  <p style="color:#6b7280;font-size:12px;margin-top:32px;">Compliance Co-Pilot</p>
</body></html>`,
    available_variables: [
      'user_name',
      'plan_name',
      'plan_price',
      'trial_days',
      'next_billing_date',
      'app_link',
    ],
  },
  verification: {
    template_key: 'verification',
    subject: 'Verify your Compliance Co-Pilot email',
    body_html: `<!doctype html><html><body style="font-family:-apple-system,system-ui,sans-serif;color:#1a1a2e;max-width:560px;margin:0 auto;padding:24px;">
  <h1 style="color:#042C53;margin-bottom:8px;">Confirm your email</h1>
  <p>Hi {user_name},</p>
  <p>Tap the button below to verify your email address and finish setting up your account.</p>
  <p><a href="{verification_link}" style="display:inline-block;background:#042C53;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">Verify email</a></p>
  <p style="color:#6b7280;font-size:12px;margin-top:32px;">Compliance Co-Pilot</p>
</body></html>`,
    available_variables: ['user_name', 'verification_link'],
  },
  deletion_warning: {
    template_key: 'deletion_warning',
    subject: 'Your Compliance Co-Pilot documents will be deleted soon',
    body_html: `<!doctype html><html><body style="font-family:-apple-system,system-ui,sans-serif;color:#1a1a2e;max-width:560px;margin:0 auto;padding:24px;">
  <h1 style="color:#A32D2D;margin-bottom:8px;">Documents scheduled for deletion</h1>
  <p>Hi {user_name},</p>
  <div style="background:#FCEBEB;border-left:4px solid #A32D2D;padding:16px;border-radius:8px;margin:24px 0;">
    <p style="margin:0;"><strong>Your {document_count} compliance document(s) will be permanently deleted on {deletion_date}.</strong></p>
    <p style="margin:8px 0 0;">After that date, the documents cannot be recovered.</p>
  </div>
  <p>If you want to keep your data, reactivate your subscription before then.</p>
  <p style="color:#6b7280;font-size:12px;margin-top:32px;">Compliance Co-Pilot</p>
</body></html>`,
    available_variables: ['user_name', 'deletion_date', 'document_count'],
  },
  cancellation_confirm: {
    template_key: 'cancellation_confirm',
    subject: 'Your Compliance Co-Pilot subscription has been cancelled',
    body_html: `<!doctype html><html><body style="font-family:-apple-system,system-ui,sans-serif;color:#1a1a2e;max-width:560px;margin:0 auto;padding:24px;">
  <h1 style="color:#A32D2D;margin-bottom:8px;">Subscription Cancelled</h1>
  <p>Hi {user_name},</p>
  <p>This email confirms that your Compliance Co-Pilot subscription has been cancelled.</p>
  <div style="background:#FCEBEB;border-left:4px solid #A32D2D;padding:16px;border-radius:8px;margin:24px 0;">
    <p style="margin:0;"><strong>Your {document_count} compliance document(s) will be permanently deleted on {deletion_date}.</strong></p>
    <p style="margin:8px 0 0;">After that date, the documents cannot be recovered.</p>
  </div>
  <p>If this was a mistake or you have questions, reply to this email and we will help right away.</p>
  <p style="color:#6b7280;font-size:12px;margin-top:32px;">Compliance Co-Pilot</p>
</body></html>`,
    available_variables: ['user_name', 'deletion_date', 'document_count'],
  },
};

// ── Normalization ───────────────────────────────────────────────────────────

// The `available_variables` column may arrive as a Postgres text[] (string[]),
// a jsonb array, or null. Coerce to a clean string[] of variable names.
export function normalizeVariables(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => (typeof v === 'string' ? v : ''))
    .map((s) => s.trim().replace(/^\{|\}$/g, '')) // tolerate '{user_name}' entries
    .filter((s) => s.length > 0);
}

function normalizeTemplate(row: Record<string, unknown>): EmailTemplate | null {
  const key = row.template_key;
  if (
    key !== 'welcome' &&
    key !== 'verification' &&
    key !== 'deletion_warning' &&
    key !== 'cancellation_confirm'
  ) {
    return null;
  }
  const fallback = FALLBACK_TEMPLATES[key];
  return {
    template_key: key,
    subject:
      typeof row.subject === 'string' && row.subject.trim()
        ? row.subject
        : fallback.subject,
    body_html:
      typeof row.body_html === 'string' && row.body_html.trim()
        ? row.body_html
        : fallback.body_html,
    available_variables:
      normalizeVariables(row.available_variables).length > 0
        ? normalizeVariables(row.available_variables)
        : fallback.available_variables,
  };
}

// ── Rendering ─────────────────────────────────────────────────────────────

// Replace every {placeholder} token in the subject and body with the matching
// value from `variables`. Keys present in `variables` are substituted (coerced
// to string); tokens with no matching key are left intact so a missing value is
// visible rather than silently blanked. Works for {user_name}, {tax_year},
// {deletion_date}, {document_count}, and any other token in the template.
export function renderTemplate(
  template: Pick<EmailTemplate, 'subject' | 'body_html'>,
  variables: Record<string, string | number | null | undefined>,
): RenderedEmail {
  const apply = (input: string): string =>
    input.replace(/\{(\w+)\}/g, (match, key: string) => {
      if (!Object.prototype.hasOwnProperty.call(variables, key)) return match;
      const value = variables[key];
      return value === null || value === undefined ? '' : String(value);
    });
  return {
    subject: apply(template.subject),
    bodyHtml: apply(template.body_html),
  };
}

// Build a representative sample-variable map for a template so the Admin preview
// shows realistic values in every placeholder. Falls back to a humanized token
// name for any variable we don't have a canned sample for.
const SAMPLE_VALUES: Record<string, string> = {
  user_name: 'Jordan Smith',
  plan_name: 'Pro',
  plan_price: '$199',
  trial_days: '3',
  tax_year: '2026',
  next_billing_date: 'July 18, 2026',
  deletion_date: 'August 14, 2026',
  document_count: '12',
  app_link: 'https://compliancecopilot.com',
  verification_link: 'https://compliancecopilot.com/verify?token=sample',
};

export function sampleVariables(variables: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of variables) {
    out[v] =
      SAMPLE_VALUES[v] ??
      v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return out;
}

// ── Reads ───────────────────────────────────────────────────────────────────

// Fetch a single template by key. Returns the shipped fallback on any error or
// if the row is missing, so send paths can render unconditionally.
export async function fetchEmailTemplate(
  templateKey: EmailTemplateKey,
): Promise<EmailTemplate> {
  try {
    const { data, error } = await supabase
      .from('email_templates')
      .select('template_key, subject, body_html, available_variables')
      .eq('template_key', templateKey)
      .maybeSingle();
    if (error || !data) return FALLBACK_TEMPLATES[templateKey];
    return normalizeTemplate(data as Record<string, unknown>) ?? FALLBACK_TEMPLATES[templateKey];
  } catch {
    return FALLBACK_TEMPLATES[templateKey];
  }
}

// Fetch ALL templates for the Admin editor. Throws on error so the editor can
// surface a load failure (unlike the fallback-on-error send path above).
export async function fetchAllEmailTemplates(): Promise<EmailTemplate[]> {
  const { data, error } = await supabase
    .from('email_templates')
    .select('*')
    .order('template_key', { ascending: true });
  if (error) throw error;
  return ((data as Record<string, unknown>[]) ?? [])
    .map(normalizeTemplate)
    .filter((t): t is EmailTemplate => t !== null);
}

// ── Admin writes ─────────────────────────────────────────────────────────────

// Persist an edit to a template's subject + body and best-effort append an entry
// to admin_audit_log. The audit insert is wrapped so a missing admin_audit_log
// table (or RLS/offline failure) never blocks the template update itself.
export async function updateEmailTemplate(
  templateKey: EmailTemplateKey,
  subject: string,
  bodyHtml: string,
  adminUserId: string | null = null,
): Promise<void> {
  // Snapshot current values for the audit "before" record.
  let before: Record<string, unknown> | null = null;
  try {
    const { data } = await supabase
      .from('email_templates')
      .select('subject, body_html')
      .eq('template_key', templateKey)
      .maybeSingle();
    before = (data as Record<string, unknown> | null) ?? null;
  } catch {
    before = null;
  }

  const { error } = await supabase
    .from('email_templates')
    .update({ subject, body_html: bodyHtml })
    .eq('template_key', templateKey);
  if (error) throw error;

  // Best-effort audit log. Ignore any failure (table absent, RLS, offline) so
  // it never blocks the template change itself.
  try {
    await supabase.from('admin_audit_log').insert({
      admin_id: adminUserId,
      action: 'update_email_template',
      table_name: 'email_templates',
      record_key: templateKey,
      details: { before, after: { subject, body_html: bodyHtml } },
    });
  } catch {
    /* admin_audit_log may not exist — template update already succeeded */
  }
}

// Re-export the row type for callers that read raw rows.
export type { EmailTemplateRow };
