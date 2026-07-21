// Registry of the required-document slots that each strategy's compliance
// screen exposes. The screens themselves still own the title/description
// copy used for rendering; this file is the lightweight lookup the rest of
// the app uses to ask "what documents does <strategy> require?" without
// pulling in the full screen modules.

export interface ComplianceSlotMeta {
  key: string;
  label: string;
}

export const STRATEGY_COMPLIANCE_SLOTS: Record<string, ComplianceSlotMeta[]> = {
  s_corp: [
    { key: 'reasonable_compensation', label: 'Reasonable Compensation Documentation' },
    { key: 'annual_board_minutes', label: 'Annual Board Meeting Minutes' },
    { key: 'board_of_directors', label: 'Board of Directors Documentation' },
    { key: 'accountable_plan', label: 'Accountable Plan Adoption Document' },
    { key: 'articles_of_incorporation', label: 'Articles of Incorporation' },
    { key: 's_election_acceptance', label: 'IRS S-Election Acceptance Letter' },
    { key: 'operating_agreement', label: 'Operating Agreement' },
    { key: 'form_2553', label: 'IRS Form 2553 — S-Election Filing' },
  ],
  home_office: [
    { key: 'square_footage', label: 'Square Footage Documentation' },
    { key: 'utilities', label: 'Utility Records' },
    { key: 'closing_disclosure', label: 'Closing Disclosure or Lease Agreement' },
    { key: 'renovation_receipt', label: 'Renovation Receipts' },
  ],
  family_management: [
    { key: 'articles_of_organization', label: 'Articles of Organization or Incorporation' },
    { key: 'operating_agreement', label: 'Operating Agreement' },
    { key: 'ein_ss4', label: 'EIN Confirmation — IRS Form SS-4' },
    { key: 'state_license', label: 'State Business License or Registration' },
    { key: 'bank_account', label: 'Bank Account Establishment Record' },
    { key: 'management_agreement', label: 'Management Agreement' },
  ],
};

// Strategy keys → the RootStack screen name for that strategy's compliance
// hub. Used by callers (Dashboard, Docs) to route to the right screen.
export const STRATEGY_COMPLIANCE_ROUTE: Record<string, string> = {
  s_corp: 'SCorpCompliance',
  home_office: 'HomeOfficeCompliance',
  family_management: 'FamilyMgmtCompliance',
};

// ── Single source of truth for compliance completion ──────────────────────
//
// The Home Office screen, the Dashboard compliance cards, and the Documents
// tab all score completion through the two functions below so they can never
// disagree. A slot is "satisfied" only when an uploaded row exists for its
// document_key WITH a non-null file_url — a metadata-only row (file_url null)
// does not count. `strategyKey` is matched too, so callers can pass rows for
// every strategy without pre-filtering.

// The minimal shape these helpers need from a strategy_documents row. Any
// StrategyDocumentRow satisfies this structurally.
export interface CompletionRow {
  strategy_key: string;
  document_key: string;
  file_url: string | null;
}

export interface StrategyCompletion {
  satisfied: Set<string>;
  completed: number;
  total: number;
  isComplete: boolean;
}

// Which of a strategy's slots are satisfied by the given uploaded rows. The
// Home Office residence slot is satisfied by either a closing disclosure or a
// lease agreement — encoded here so every caller agrees.
export function satisfiedSlotKeys(
  strategyKey: string,
  rows: CompletionRow[],
): Set<string> {
  const satisfied = new Set(
    rows
      .filter((r) => r.strategy_key === strategyKey && r.file_url)
      .map((r) => r.document_key),
  );
  if (strategyKey === 'home_office' && satisfied.has('lease_agreement')) {
    satisfied.add('closing_disclosure');
  }
  return satisfied;
}

// Full completion snapshot for a strategy: the satisfied slot set, the
// completed/total counts, and whether every required slot is satisfied.
export function computeStrategyCompletion(
  strategyKey: string,
  rows: CompletionRow[],
): StrategyCompletion {
  const slots = STRATEGY_COMPLIANCE_SLOTS[strategyKey] ?? [];
  const satisfied = satisfiedSlotKeys(strategyKey, rows);
  const completed = slots.reduce((n, s) => n + (satisfied.has(s.key) ? 1 : 0), 0);
  const total = slots.length;
  return { satisfied, completed, total, isComplete: total > 0 && completed === total };
}
