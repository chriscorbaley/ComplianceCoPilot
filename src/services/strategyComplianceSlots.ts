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
