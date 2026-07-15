// Editable onboarding + marketing copy lives in the Supabase `app_content` table
// so headlines, strategy descriptions, stat cards, and feature lists can be
// edited from the Admin panel without shipping a new build. This mirrors the
// pattern used by pricing_plans / email_templates.
//
// The APP_CONTENT_SEED array below is the SINGLE SOURCE OF TRUTH for:
//   1. The shipped fallback (APP_CONTENT_FALLBACK) — the exact text the app
//      renders if the table read ever fails (offline, RLS, cold start). Every
//      copy surface stays identical to the last shipped build.
//   2. The seed SQL (seed_app_content.sql) — the same rows are inserted into the
//      table so, once seeded, edits flow from the DB.
//
// Keep the seed values here byte-for-byte identical to what the screens used to
// hardcode; the fallback path depends on it.
//
// NOTE: legal text (legal_documents), pricing (pricing_plans), compliance rule
// text (compliance_rules), and email templates (email_templates) are managed by
// their own tables/editors and MUST NOT be moved here. This table is marketing
// and descriptive onboarding copy only.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

// Screen groupings (stored in the `content_type` column). The Admin editor
// groups rows by this value and renders the label from GROUP_LABELS.
export type AppContentGroup =
  | 'strategy_desc'
  | 'upgrade_strategy_desc'
  | 'upsell'
  | 'bt_intro'
  | 'mileage_intro';

export const GROUP_LABELS: Record<AppContentGroup, string> = {
  strategy_desc: 'Strategy Descriptions',
  upgrade_strategy_desc: 'Upgrade Strategy Picker',
  upsell: 'Upsell / Upgrade Teaser',
  bt_intro: 'Business Travel Intro',
  mileage_intro: 'Mileage Intro',
};

// Display order of groups in the Admin editor.
export const GROUP_ORDER: AppContentGroup[] = [
  'strategy_desc',
  'upgrade_strategy_desc',
  'upsell',
  'bt_intro',
  'mileage_intro',
];

export interface AppContentSeedRow {
  content_key: string;
  content_value: string;
  content_type: AppContentGroup;
  description: string;
}

// ── Seed / fallback (shipped in the binary) ─────────────────────────────────
// These values are the exact copy the app previously hardcoded.
export const APP_CONTENT_SEED: AppContentSeedRow[] = [
  // ── Strategy Descriptions (onboarding StrategySelectionScreen) ────────────
  {
    content_key: 'strategy_desc_real_estate',
    content_type: 'strategy_desc',
    content_value:
      "Material Participation hours for short-term rental tracking, and or Real Estate Professional status.",
    description:
      "Strategy selection (onboarding): description under the 'Real Estate / REPS' card.",
  },
  {
    content_key: 'strategy_desc_augusta_rule',
    content_type: 'strategy_desc',
    content_value:
      "14-day tax-free rental of your home to your business (IRC §280A(g)).",
    description:
      "Strategy selection (onboarding): description under the 'Augusta Rule' card.",
  },
  {
    content_key: 'strategy_desc_s_corp',
    content_type: 'strategy_desc',
    content_value:
      "Your S-Corp compliance, organized and export-ready. Templates, records, and documents — all in one place when your CPA needs them.",
    description:
      "Strategy selection (onboarding): description under the 'S-Corp' card.",
  },
  {
    content_key: 'strategy_desc_home_office',
    content_type: 'strategy_desc',
    content_value:
      "Exclusive-use attestation and home-office deduction tracking (IRC §280A).",
    description:
      "Strategy selection (onboarding): description under the 'Home Office' card.",
  },
  {
    content_key: 'strategy_desc_family_management',
    content_type: 'strategy_desc',
    content_value:
      "Turn your family into a tax-efficient team. Track the documents and activity that keep your family management company strategy working.",
    description:
      "Strategy selection (onboarding): description under the 'Family Management Company' card.",
  },

  // ── Upgrade Strategy Picker (in-app UpgradeStrategySelectScreen) ──────────
  // Separate from the onboarding strategy descriptions above: this in-app
  // upgrade picker ships its own (slightly different) blurbs for S-Corp and
  // Family Management, so it gets its own keys to preserve that text.
  {
    content_key: 'upgrade_strategy_desc_real_estate',
    content_type: 'upgrade_strategy_desc',
    content_value:
      "Material Participation hours for short-term rental tracking, and or Real Estate Professional status.",
    description:
      "Upgrade picker (in-app): description under the 'Real Estate / REPS' card.",
  },
  {
    content_key: 'upgrade_strategy_desc_augusta_rule',
    content_type: 'upgrade_strategy_desc',
    content_value:
      "14-day tax-free rental of your home to your business (IRC §280A(g)).",
    description:
      "Upgrade picker (in-app): description under the 'Augusta Rule' card.",
  },
  {
    content_key: 'upgrade_strategy_desc_s_corp',
    content_type: 'upgrade_strategy_desc',
    content_value:
      "Your S-Corp compliance, organized and export-ready — templates, records, and documents in one place.",
    description:
      "Upgrade picker (in-app): description under the 'S-Corp' card.",
  },
  {
    content_key: 'upgrade_strategy_desc_home_office',
    content_type: 'upgrade_strategy_desc',
    content_value:
      "Exclusive-use attestation and home-office deduction tracking (IRC §280A).",
    description:
      "Upgrade picker (in-app): description under the 'Home Office' card.",
  },
  {
    content_key: 'upgrade_strategy_desc_family_management',
    content_type: 'upgrade_strategy_desc',
    content_value:
      "Track the documents and activity that keep your family management company strategy working.",
    description:
      "Upgrade picker (in-app): description under the 'Family Management Company' card.",
  },

  // ── Upsell / Upgrade Teaser (UpgradeTeaserScreen) ─────────────────────────
  {
    content_key: 'upsell_headline',
    content_type: 'upsell',
    content_value: "You're one step away from better compliance coverage",
    description: 'Upgrade teaser: main headline (shown to both Basic and Core).',
  },
  {
    content_key: 'upsell_body_starter',
    content_type: 'upsell',
    content_value: 'Core members track 3 strategies and never miss a deadline',
    description:
      'Upgrade teaser: subheading shown to Basic subscribers (upsell to Core).',
  },
  {
    content_key: 'upsell_body_core',
    content_type: 'upsell',
    content_value: 'Pro members track every strategy with the full audit trail',
    description:
      'Upgrade teaser: subheading shown to Core subscribers (upsell to Pro).',
  },
  {
    content_key: 'upsell_starter_feature1',
    content_type: 'upsell',
    content_value: 'Additional strategies',
    description: 'Upgrade teaser (Basic view): locked feature bullet 1.',
  },
  {
    content_key: 'upsell_starter_feature2',
    content_type: 'upsell',
    content_value: 'Strategy progress dashboard',
    description: 'Upgrade teaser (Basic view): locked feature bullet 2.',
  },
  {
    content_key: 'upsell_starter_feature3',
    content_type: 'upsell',
    content_value: 'Priority support',
    description: 'Upgrade teaser (Basic view): locked feature bullet 3.',
  },
  {
    content_key: 'upsell_core_feature1',
    content_type: 'upsell',
    content_value: 'All tax strategies',
    description: 'Upgrade teaser (Core view): locked feature bullet 1.',
  },
  {
    content_key: 'upsell_core_feature2',
    content_type: 'upsell',
    content_value: 'AI voice meeting minutes',
    description: 'Upgrade teaser (Core view): locked feature bullet 2.',
  },
  {
    content_key: 'upsell_core_feature3',
    content_type: 'upsell',
    content_value: 'Complete audit trail',
    description: 'Upgrade teaser (Core view): locked feature bullet 3.',
  },

  // ── Business Travel Intro (BusinessTravelIntroScreen) ─────────────────────
  {
    content_key: 'bt_intro_title',
    content_type: 'bt_intro',
    content_value: "Don't Leave Money on the Table",
    description: 'Business Travel intro: hero headline.',
  },
  {
    content_key: 'bt_intro_subtitle',
    content_type: 'bt_intro',
    content_value:
      'Business travel is one of the most overlooked tax deductions for business owners',
    description: 'Business Travel intro: hero subheading.',
  },
  {
    content_key: 'bt_intro_stat1_value',
    content_type: 'bt_intro',
    content_value: '$3,500+',
    description: 'Business Travel intro: stat card 1 — value.',
  },
  {
    content_key: 'bt_intro_stat1_label',
    content_type: 'bt_intro',
    content_value: 'Average tax savings per business trip',
    description: 'Business Travel intro: stat card 1 — label.',
  },
  {
    content_key: 'bt_intro_stat2_value',
    content_type: 'bt_intro',
    content_value: '100%',
    description: 'Business Travel intro: stat card 2 — value.',
  },
  {
    content_key: 'bt_intro_stat2_label',
    content_type: 'bt_intro',
    content_value: 'Of airfare may be deductible on qualifying trips',
    description: 'Business Travel intro: stat card 2 — label.',
  },
  {
    content_key: 'bt_intro_stat3_value',
    content_type: 'bt_intro',
    content_value: '2 IRS Rule Sets',
    description: 'Business Travel intro: stat card 3 — value.',
  },
  {
    content_key: 'bt_intro_stat3_label',
    content_type: 'bt_intro',
    content_value: 'Domestic and international compliance handled automatically',
    description: 'Business Travel intro: stat card 3 — label.',
  },
  {
    content_key: 'bt_intro_card_title',
    content_type: 'bt_intro',
    content_value: 'What Core and Pro members get',
    description: 'Business Travel intro: feature-list card heading.',
  },
  {
    content_key: 'bt_intro_feature1_title',
    content_type: 'bt_intro',
    content_value: 'AI Itinerary Analyzer',
    description: 'Business Travel intro: feature 1 — title.',
  },
  {
    content_key: 'bt_intro_feature1_sub',
    content_type: 'bt_intro',
    content_value:
      'Speak your trip — get an instant deductibility verdict before you even book',
    description: 'Business Travel intro: feature 1 — description.',
  },
  {
    content_key: 'bt_intro_feature2_title',
    content_type: 'bt_intro',
    content_value: 'Domestic Travel (IRC §162)',
    description: 'Business Travel intro: feature 2 — title.',
  },
  {
    content_key: 'bt_intro_feature2_sub',
    content_type: 'bt_intro',
    content_value:
      'Primary purpose test applied automatically — know your deduction before you travel',
    description: 'Business Travel intro: feature 2 — description.',
  },
  {
    content_key: 'bt_intro_feature3_title',
    content_type: 'bt_intro',
    content_value: 'International Travel (IRC §274(c))',
    description: 'Business Travel intro: feature 3 — title.',
  },
  {
    content_key: 'bt_intro_feature3_sub',
    content_type: 'bt_intro',
    content_value:
      '7-day rule, 25% personal threshold, and allocation formula calculated for you',
    description: 'Business Travel intro: feature 3 — description.',
  },
  {
    content_key: 'bt_intro_feature4_title',
    content_type: 'bt_intro',
    content_value: 'Log This Trip',
    description: 'Business Travel intro: feature 4 — title.',
  },
  {
    content_key: 'bt_intro_feature4_sub',
    content_type: 'bt_intro',
    content_value:
      'AI analysis results pre-fill your trip log — one tap to save a compliant record',
    description: 'Business Travel intro: feature 4 — description.',
  },
  {
    content_key: 'bt_intro_feature5_title',
    content_type: 'bt_intro',
    content_value: 'Draft Future Trips',
    description: 'Business Travel intro: feature 5 — title.',
  },
  {
    content_key: 'bt_intro_feature5_sub',
    content_type: 'bt_intro',
    content_value: 'Plan upcoming travel and finalize records after you return',
    description: 'Business Travel intro: feature 5 — description.',
  },
  {
    content_key: 'bt_intro_feature6_title',
    content_type: 'bt_intro',
    content_value: 'Exportable Reports',
    description: 'Business Travel intro: feature 6 — title.',
  },
  {
    content_key: 'bt_intro_feature6_sub',
    content_type: 'bt_intro',
    content_value:
      'Send a complete trip compliance report to your tax advisor in seconds',
    description: 'Business Travel intro: feature 6 — description.',
  },

  // ── Mileage Intro (MileageIntroScreen) ────────────────────────────────────
  {
    content_key: 'mileage_intro_title',
    content_type: 'mileage_intro',
    content_value: 'Track Every Mile, Maximize Every Deduction',
    description: 'Mileage intro: hero headline.',
  },
  {
    content_key: 'mileage_intro_subtitle',
    content_type: 'mileage_intro',
    content_value:
      'The IRS allows substantial deductions for business and medical miles driven. Most business owners leave this money on the table.',
    description: 'Mileage intro: hero subheading.',
  },
  {
    content_key: 'mileage_intro_card_title',
    content_type: 'mileage_intro',
    content_value: 'What Pro members get',
    description: 'Mileage intro: feature-list card heading.',
  },
  {
    content_key: 'mileage_intro_stat1_value',
    content_type: 'mileage_intro',
    content_value: '$0.70',
    description: 'Mileage intro: stat card 1 — value.',
  },
  {
    content_key: 'mileage_intro_stat1_label',
    content_type: 'mileage_intro',
    content_value: 'Per business mile deductible (2025 IRS rate)',
    description: 'Mileage intro: stat card 1 — label.',
  },
  {
    content_key: 'mileage_intro_stat2_value',
    content_type: 'mileage_intro',
    content_value: '2 Categories',
    description: 'Mileage intro: stat card 2 — value.',
  },
  {
    content_key: 'mileage_intro_stat2_label',
    content_type: 'mileage_intro',
    content_value:
      'Business and medical miles tracked separately with correct IRS rates',
    description: 'Mileage intro: stat card 2 — label.',
  },
  {
    content_key: 'mileage_intro_stat3_value',
    content_type: 'mileage_intro',
    content_value: 'Pro Only',
    description: 'Mileage intro: stat card 3 — value.',
  },
  {
    content_key: 'mileage_intro_stat3_label',
    content_type: 'mileage_intro',
    content_value: 'Full mileage tracking with exportable IRS-ready reports',
    description: 'Mileage intro: stat card 3 — label.',
  },
  {
    content_key: 'mileage_intro_feature1_title',
    content_type: 'mileage_intro',
    content_value: 'Multi-Vehicle Fleet Tracking',
    description: 'Mileage intro: feature 1 — title.',
  },
  {
    content_key: 'mileage_intro_feature1_sub',
    content_type: 'mileage_intro',
    content_value:
      'Track miles across multiple vehicles separately for accurate records',
    description: 'Mileage intro: feature 1 — description.',
  },
  {
    content_key: 'mileage_intro_feature2_title',
    content_type: 'mileage_intro',
    content_value: 'Business & Medical Categories',
    description: 'Mileage intro: feature 2 — title.',
  },
  {
    content_key: 'mileage_intro_feature2_sub',
    content_type: 'mileage_intro',
    content_value:
      'Separate IRS rates applied automatically — $0.70 for business, $0.21 for medical (2025 rates)',
    description: 'Mileage intro: feature 2 — description.',
  },
  {
    content_key: 'mileage_intro_feature3_title',
    content_type: 'mileage_intro',
    content_value: 'Odometer or Direct Entry',
    description: 'Mileage intro: feature 3 — title.',
  },
  {
    content_key: 'mileage_intro_feature3_sub',
    content_type: 'mileage_intro',
    content_value:
      'Log starting and ending odometer or enter total miles directly — flexible for every situation',
    description: 'Mileage intro: feature 3 — description.',
  },
  {
    content_key: 'mileage_intro_feature4_title',
    content_type: 'mileage_intro',
    content_value: 'Instant Deduction Calculator',
    description: 'Mileage intro: feature 4 — title.',
  },
  {
    content_key: 'mileage_intro_feature4_sub',
    content_type: 'mileage_intro',
    content_value: 'See your estimated deduction as you log each trip',
    description: 'Mileage intro: feature 4 — description.',
  },
  {
    content_key: 'mileage_intro_feature5_title',
    content_type: 'mileage_intro',
    content_value: 'IRS-Ready PDF Reports',
    description: 'Mileage intro: feature 5 — title.',
  },
  {
    content_key: 'mileage_intro_feature5_sub',
    content_type: 'mileage_intro',
    content_value:
      'Export a complete mileage log formatted for your tax professional or IRS examination',
    description: 'Mileage intro: feature 5 — description.',
  },
  {
    content_key: 'mileage_intro_feature6_title',
    content_type: 'mileage_intro',
    content_value: 'Prior Year Access',
    description: 'Mileage intro: feature 6 — title.',
  },
  {
    content_key: 'mileage_intro_feature6_sub',
    content_type: 'mileage_intro',
    content_value: 'Log and edit entries for prior tax years — never miss a deduction',
    description: 'Mileage intro: feature 6 — description.',
  },
];

// Flat key → value fallback map derived from the seed. Used as the shipped
// safety net so every copy surface renders even if the table read fails.
export const APP_CONTENT_FALLBACK: Record<string, string> = Object.fromEntries(
  APP_CONTENT_SEED.map((r) => [r.content_key, r.content_value]),
);

// ── Reads (app runtime) ──────────────────────────────────────────────────────

export interface AppContentState {
  // Look up a content value by key. Returns the live DB value when loaded,
  // otherwise the explicit `fallback`, otherwise the shipped seed value, so
  // callers can render unconditionally on first paint (never blocked on fetch).
  get: (key: string, fallback?: string) => string;
  loading: boolean;
  error: string | null;
}

// Hook for any screen that renders editable copy. Starts with the shipped
// fallback map (first paint is never empty) then swaps in the live values once
// the fetch resolves. Existing content is shown immediately.
export function useAppContent(): AppContentState {
  const [map, setMap] = useState<Record<string, string>>(APP_CONTENT_FALLBACK);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error: e } = await supabase
          .from('app_content')
          .select('content_key, content_value');
        if (cancelled) return;
        if (e || !data) {
          setError(e?.message ?? null);
        } else {
          // Merge DB rows over the fallback so any key missing from the table
          // still resolves to its shipped value.
          const next = { ...APP_CONTENT_FALLBACK };
          for (const row of data as { content_key: string; content_value: unknown }[]) {
            if (
              typeof row.content_key === 'string' &&
              typeof row.content_value === 'string' &&
              row.content_value.length > 0
            ) {
              next[row.content_key] = row.content_value;
            }
          }
          setMap(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const get = useCallback(
    (key: string, fallback?: string): string => {
      const v = map[key];
      if (typeof v === 'string' && v.length > 0) return v;
      if (fallback !== undefined) return fallback;
      return APP_CONTENT_FALLBACK[key] ?? '';
    },
    [map],
  );

  return { get, loading, error };
}

// ── Admin reads / writes ─────────────────────────────────────────────────────

export interface AppContentRow {
  content_key: string;
  content_value: string;
  content_type: AppContentGroup;
  description: string | null;
  updated_at: string | null;
}

// Fetch every row for the Admin editor, ordered by content_type then key.
export async function fetchAllAppContent(): Promise<AppContentRow[]> {
  const { data, error } = await supabase
    .from('app_content')
    .select('content_key, content_value, content_type, description, updated_at')
    .order('content_type', { ascending: true })
    .order('content_key', { ascending: true });
  if (error) throw error;
  return ((data as Record<string, unknown>[]) ?? []).map((r) => ({
    content_key: String(r.content_key),
    content_value: typeof r.content_value === 'string' ? r.content_value : '',
    content_type: r.content_type as AppContentGroup,
    description: typeof r.description === 'string' ? r.description : null,
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : null,
  }));
}

// Persist an edit to a single content row and best-effort append an entry to
// admin_audit_log. The audit insert is wrapped so a missing admin_audit_log
// table never blocks the content update itself.
export async function updateAppContent(
  contentKey: string,
  contentValue: string,
  adminUserId: string | null,
): Promise<void> {
  // Snapshot the current value for the audit "before" record.
  let before: string | null = null;
  try {
    const { data } = await supabase
      .from('app_content')
      .select('content_value')
      .eq('content_key', contentKey)
      .maybeSingle();
    before =
      data && typeof (data as { content_value?: unknown }).content_value === 'string'
        ? (data as { content_value: string }).content_value
        : null;
  } catch {
    before = null;
  }

  const { error } = await supabase
    .from('app_content')
    .update({ content_value: contentValue, updated_at: new Date().toISOString() })
    .eq('content_key', contentKey);
  if (error) throw error;

  try {
    await supabase.from('admin_audit_log').insert({
      admin_id: adminUserId,
      action: 'update_app_content',
      table_name: 'app_content',
      record_key: contentKey,
      details: { before, after: contentValue },
    });
  } catch {
    /* admin_audit_log may not exist — content update already succeeded */
  }
}
