-- ═══════════════════════════════════════════════════════════════════════════
-- Seed: app_content — editable onboarding & marketing copy
-- ═══════════════════════════════════════════════════════════════════════════
-- Seeds the (already-created, empty) public.app_content table with the EXACT
-- copy the app currently hardcodes, so nothing changes visually after wiring
-- the screens to read from this table. Once seeded, this copy is editable from
-- Admin Panel → Content without shipping a new build.
--
-- Columns used: content_key, content_value, content_type, description.
-- content_type groups rows by screen for the Admin editor:
--   strategy_desc         → Strategy Descriptions (onboarding StrategySelectionScreen)
--   upgrade_strategy_desc → Upgrade Strategy Picker (in-app UpgradeStrategySelectScreen)
--   upsell                → Upsell / Upgrade Teaser (UpgradeTeaserScreen)
--   bt_intro              → Business Travel Intro (BusinessTravelIntroScreen)
--   mileage_intro         → Mileage Intro (MileageIntroScreen) + in-app Mileage locked screen
--
-- Does NOT touch legal_documents, pricing_plans, compliance_rules, or
-- email_templates — those have their own tables/editors.
--
-- Idempotent: only inserts keys that don't already exist, so it's safe to
-- re-run and never overwrites an admin's edits. Values use $$dollar-quoting$$
-- so apostrophes / em-dashes / § need no escaping.
--
-- Run in Supabase → SQL Editor.

insert into public.app_content (content_key, content_value, content_type, description)
select v.content_key, v.content_value, v.content_type, v.description
from (values
  -- ── Strategy Descriptions ──────────────────────────────────────────────
  ('strategy_desc_real_estate', $$Material Participation hours for short-term rental tracking, and or Real Estate Professional status.$$, 'strategy_desc', $$Strategy selection (onboarding): description under the 'Real Estate / REPS' card.$$),
  ('strategy_desc_augusta_rule', $$14-day tax-free rental of your home to your business (IRC §280A(g)).$$, 'strategy_desc', $$Strategy selection (onboarding): description under the 'Augusta Rule' card.$$),
  ('strategy_desc_s_corp', $$Your S-Corp compliance, organized and export-ready. Templates, records, and documents — all in one place when your CPA needs them.$$, 'strategy_desc', $$Strategy selection (onboarding): description under the 'S-Corp' card.$$),
  ('strategy_desc_home_office', $$Exclusive-use attestation and home-office deduction tracking (IRC §280A).$$, 'strategy_desc', $$Strategy selection (onboarding): description under the 'Home Office' card.$$),
  ('strategy_desc_family_management', $$Turn your family into a tax-efficient team. Track the documents and activity that keep your family management company strategy working.$$, 'strategy_desc', $$Strategy selection (onboarding): description under the 'Family Management Company' card.$$),

  -- ── Upgrade Strategy Picker (in-app UpgradeStrategySelectScreen) ─────────
  -- Independent from the onboarding descriptions above; S-Corp and Family
  -- Management blurbs differ, so this screen keeps its own editable set.
  ('upgrade_strategy_desc_real_estate', $$Material Participation hours for short-term rental tracking, and or Real Estate Professional status.$$, 'upgrade_strategy_desc', $$Upgrade picker (in-app): description under the 'Real Estate / REPS' card.$$),
  ('upgrade_strategy_desc_augusta_rule', $$14-day tax-free rental of your home to your business (IRC §280A(g)).$$, 'upgrade_strategy_desc', $$Upgrade picker (in-app): description under the 'Augusta Rule' card.$$),
  ('upgrade_strategy_desc_s_corp', $$Your S-Corp compliance, organized and export-ready — templates, records, and documents in one place.$$, 'upgrade_strategy_desc', $$Upgrade picker (in-app): description under the 'S-Corp' card.$$),
  ('upgrade_strategy_desc_home_office', $$Exclusive-use attestation and home-office deduction tracking (IRC §280A).$$, 'upgrade_strategy_desc', $$Upgrade picker (in-app): description under the 'Home Office' card.$$),
  ('upgrade_strategy_desc_family_management', $$Track the documents and activity that keep your family management company strategy working.$$, 'upgrade_strategy_desc', $$Upgrade picker (in-app): description under the 'Family Management Company' card.$$),

  -- ── Upsell / Upgrade Teaser ─────────────────────────────────────────────
  ('upsell_headline', $$You're one step away from better compliance coverage$$, 'upsell', $$Upgrade teaser: main headline (shown to both Basic and Core).$$),
  ('upsell_body_starter', $$Core members track 3 strategies and never miss a deadline$$, 'upsell', $$Upgrade teaser: subheading shown to Basic subscribers (upsell to Core).$$),
  ('upsell_body_core', $$Pro members track every strategy with the full audit trail$$, 'upsell', $$Upgrade teaser: subheading shown to Core subscribers (upsell to Pro).$$),
  ('upsell_starter_feature1', $$Additional strategies$$, 'upsell', $$Upgrade teaser (Basic view): locked feature bullet 1.$$),
  ('upsell_starter_feature2', $$Strategy progress dashboard$$, 'upsell', $$Upgrade teaser (Basic view): locked feature bullet 2.$$),
  ('upsell_starter_feature3', $$Priority support$$, 'upsell', $$Upgrade teaser (Basic view): locked feature bullet 3.$$),
  ('upsell_core_feature1', $$All tax strategies$$, 'upsell', $$Upgrade teaser (Core view): locked feature bullet 1.$$),
  ('upsell_core_feature2', $$AI voice meeting minutes$$, 'upsell', $$Upgrade teaser (Core view): locked feature bullet 2.$$),
  ('upsell_core_feature3', $$Complete audit trail$$, 'upsell', $$Upgrade teaser (Core view): locked feature bullet 3.$$),

  -- ── Business Travel Intro ───────────────────────────────────────────────
  ('bt_intro_title', $$Don't Leave Money on the Table$$, 'bt_intro', $$Business Travel intro: hero headline.$$),
  ('bt_intro_subtitle', $$Business travel is one of the most overlooked tax deductions for business owners$$, 'bt_intro', $$Business Travel intro: hero subheading.$$),
  ('bt_intro_stat1_value', $$$3,500+$$, 'bt_intro', $$Business Travel intro: stat card 1 — value.$$),
  ('bt_intro_stat1_label', $$Average tax savings per business trip$$, 'bt_intro', $$Business Travel intro: stat card 1 — label.$$),
  ('bt_intro_stat2_value', $$100%$$, 'bt_intro', $$Business Travel intro: stat card 2 — value.$$),
  ('bt_intro_stat2_label', $$Of airfare may be deductible on qualifying trips$$, 'bt_intro', $$Business Travel intro: stat card 2 — label.$$),
  ('bt_intro_stat3_value', $$2 IRS Rule Sets$$, 'bt_intro', $$Business Travel intro: stat card 3 — value.$$),
  ('bt_intro_stat3_label', $$Domestic and international compliance handled automatically$$, 'bt_intro', $$Business Travel intro: stat card 3 — label.$$),
  ('bt_intro_card_title', $$What Core and Pro members get$$, 'bt_intro', $$Business Travel intro: feature-list card heading.$$),
  ('bt_intro_feature1_title', $$AI Itinerary Analyzer$$, 'bt_intro', $$Business Travel intro: feature 1 — title.$$),
  ('bt_intro_feature1_sub', $$Speak your trip — get an instant deductibility verdict before you even book$$, 'bt_intro', $$Business Travel intro: feature 1 — description.$$),
  ('bt_intro_feature2_title', $$Domestic Travel (IRC §162)$$, 'bt_intro', $$Business Travel intro: feature 2 — title.$$),
  ('bt_intro_feature2_sub', $$Primary purpose test applied automatically — know your deduction before you travel$$, 'bt_intro', $$Business Travel intro: feature 2 — description.$$),
  ('bt_intro_feature3_title', $$International Travel (IRC §274(c))$$, 'bt_intro', $$Business Travel intro: feature 3 — title.$$),
  ('bt_intro_feature3_sub', $$7-day rule, 25% personal threshold, and allocation formula calculated for you$$, 'bt_intro', $$Business Travel intro: feature 3 — description.$$),
  ('bt_intro_feature4_title', $$Log This Trip$$, 'bt_intro', $$Business Travel intro: feature 4 — title.$$),
  ('bt_intro_feature4_sub', $$AI analysis results pre-fill your trip log — one tap to save a compliant record$$, 'bt_intro', $$Business Travel intro: feature 4 — description.$$),
  ('bt_intro_feature5_title', $$Draft Future Trips$$, 'bt_intro', $$Business Travel intro: feature 5 — title.$$),
  ('bt_intro_feature5_sub', $$Plan upcoming travel and finalize records after you return$$, 'bt_intro', $$Business Travel intro: feature 5 — description.$$),
  ('bt_intro_feature6_title', $$Exportable Reports$$, 'bt_intro', $$Business Travel intro: feature 6 — title.$$),
  ('bt_intro_feature6_sub', $$Send a complete trip compliance report to your tax advisor in seconds$$, 'bt_intro', $$Business Travel intro: feature 6 — description.$$),

  -- ── Mileage Intro ───────────────────────────────────────────────────────
  ('mileage_intro_title', $$Track Every Mile, Maximize Every Deduction$$, 'mileage_intro', $$Mileage intro: hero headline.$$),
  ('mileage_intro_subtitle', $$The IRS allows substantial deductions for business and medical miles driven. Most business owners leave this money on the table.$$, 'mileage_intro', $$Mileage intro: hero subheading.$$),
  ('mileage_intro_card_title', $$What Pro members get$$, 'mileage_intro', $$Mileage intro: feature-list card heading.$$),
  ('mileage_intro_stat1_value', $$$0.70$$, 'mileage_intro', $$Mileage intro: stat card 1 — value.$$),
  ('mileage_intro_stat1_label', $$Per business mile deductible (2025 IRS rate)$$, 'mileage_intro', $$Mileage intro: stat card 1 — label.$$),
  ('mileage_intro_stat2_value', $$2 Categories$$, 'mileage_intro', $$Mileage intro: stat card 2 — value.$$),
  ('mileage_intro_stat2_label', $$Business and medical miles tracked separately with correct IRS rates$$, 'mileage_intro', $$Mileage intro: stat card 2 — label.$$),
  ('mileage_intro_stat3_value', $$Pro Only$$, 'mileage_intro', $$Mileage intro: stat card 3 — value.$$),
  ('mileage_intro_stat3_label', $$Full mileage tracking with exportable IRS-ready reports$$, 'mileage_intro', $$Mileage intro: stat card 3 — label.$$),
  ('mileage_intro_feature1_title', $$Multi-Vehicle Fleet Tracking$$, 'mileage_intro', $$Mileage intro: feature 1 — title.$$),
  ('mileage_intro_feature1_sub', $$Track miles across multiple vehicles separately for accurate records$$, 'mileage_intro', $$Mileage intro: feature 1 — description.$$),
  ('mileage_intro_feature2_title', $$Business & Medical Categories$$, 'mileage_intro', $$Mileage intro: feature 2 — title.$$),
  ('mileage_intro_feature2_sub', $$Separate IRS rates applied automatically — $0.70 for business, $0.21 for medical (2025 rates)$$, 'mileage_intro', $$Mileage intro: feature 2 — description.$$),
  ('mileage_intro_feature3_title', $$Odometer or Direct Entry$$, 'mileage_intro', $$Mileage intro: feature 3 — title.$$),
  ('mileage_intro_feature3_sub', $$Log starting and ending odometer or enter total miles directly — flexible for every situation$$, 'mileage_intro', $$Mileage intro: feature 3 — description.$$),
  ('mileage_intro_feature4_title', $$Instant Deduction Calculator$$, 'mileage_intro', $$Mileage intro: feature 4 — title.$$),
  ('mileage_intro_feature4_sub', $$See your estimated deduction as you log each trip$$, 'mileage_intro', $$Mileage intro: feature 4 — description.$$),
  ('mileage_intro_feature5_title', $$IRS-Ready PDF Reports$$, 'mileage_intro', $$Mileage intro: feature 5 — title.$$),
  ('mileage_intro_feature5_sub', $$Export a complete mileage log formatted for your tax professional or IRS examination$$, 'mileage_intro', $$Mileage intro: feature 5 — description.$$),
  ('mileage_intro_feature6_title', $$Prior Year Access$$, 'mileage_intro', $$Mileage intro: feature 6 — title.$$),
  ('mileage_intro_feature6_sub', $$Log and edit entries for prior tax years — never miss a deduction$$, 'mileage_intro', $$Mileage intro: feature 6 — description.$$)
) as v(content_key, content_value, content_type, description)
where not exists (
  select 1 from public.app_content ac where ac.content_key = v.content_key
);

-- Confirm: should print 5 group rows totalling 61 keys (strategy_desc 5,
-- upgrade_strategy_desc 5, upsell 9, bt_intro 21, mileage_intro 21).
select content_type, count(*) as rows
from public.app_content
group by content_type
order by content_type;
