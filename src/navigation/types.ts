import type { Strategy } from '../components/StrategyCard';
import type { StatusVariant } from '../components/StatusPill';
import type { SubscriptionTier } from '../services/supabase';

export type OnboardingStackParamList = {
  EmailVerify: undefined;
  Terms: undefined;
  Privacy: undefined;
  ChoosePlan: { highlight?: SubscriptionTier } | undefined;
  UpgradeTeaser: undefined;
  Payment: undefined;
  StrategySelection: undefined;
};

export type RootStackParamList = {
  Tabs: undefined;
  DocumentDetail: {
    title: string;
    meta: string;
    strategy?: string;
    status?: string;
    statusVariant?: StatusVariant;
  };
  StrategyDetail: {
    strategy: Strategy;
  };
  AdminPanel: { initialTab?: AdminTabName; prefillRuleKeys?: string[]; prefillValues?: Record<string, string> } | undefined;
  Settings: undefined;
  MinutesDocument: {
    document: string;
    meetingType: string;
    meetingDate: string;
    location: string;
  };
  CancelWarning1: undefined;
  CancelWarning2: {
    signature1: string;
    documentCount: number;
  };
  Businesses: undefined;
  BusinessEdit: { businessId?: string } | undefined;
  Properties: undefined;
  PropertyEdit: { propertyId?: string } | undefined;
  SCorpCompliance: undefined;
  HomeOfficeCompliance: undefined;
  FamilyMgmtCompliance: undefined;
};

export type TabParamList = {
  Dashboard: undefined;
  Hours: undefined;
  Trips: undefined;
  Minutes: undefined;
  Docs: undefined;
};

export type AdminTabName =
  | 'Rules'
  | 'Templates'
  | 'Fields'
  | 'IRC'
  | 'Strategies'
  | 'Announce'
  | 'Inbox';
