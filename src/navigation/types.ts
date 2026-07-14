import type { NavigatorScreenParams } from '@react-navigation/native';
import type { Strategy } from '../components/StrategyCard';
import type { StatusVariant } from '../components/StatusPill';
import type {
  SubscriptionTier,
  MpTestKey,
  PropertyType,
} from '../services/supabase';

// Portfolio shape captured on the first real-estate onboarding screen.
export type RePropertyTypeKey = 'long_term' | 'short_term' | 'both';

// Params shared by every screen in the real-estate onboarding flow after the
// portfolio-type question. propertyTypes is the expanded PropertyType[] form of
// portfolioType ('both' → ['long_term','short_term']).
interface RealEstateFlowBase {
  selectedStrategies: string[];
  portfolioType: RePropertyTypeKey;
  defaultMpTest: MpTestKey;
  propertyTypes: PropertyType[];
}

export type OnboardingStackParamList = {
  EmailVerify: undefined;
  Terms: undefined;
  NotificationsPermission: undefined;
  Privacy: undefined;
  ChoosePlan: { highlight?: SubscriptionTier } | undefined;
  UpgradeTeaser: undefined;
  BusinessTravelIntro: undefined;
  // Core-only upsell screen shown between Business Travel intro and Payment.
  MileageIntro: undefined;
  Payment: undefined;
  StrategySelection: undefined;
  // Real estate v2 onboarding flow.
  RealEstateType: { selectedStrategies: string[] };
  RealEstateMpTest: { selectedStrategies: string[]; portfolioType: RePropertyTypeKey };
  RealEstateReps: RealEstateFlowBase;
  RealEstateProperties: RealEstateFlowBase & {
    repsPursuit: boolean | null;
    totalWorkHours: number | null;
  };
  RealEstateGrouping: RealEstateFlowBase & {
    repsPursuit: boolean | null;
    totalWorkHours: number | null;
    propertyCount: number;
  };
  RealEstateComplete: RealEstateFlowBase & {
    repsPursuit: boolean | null;
    totalWorkHours: number | null;
    grouping: boolean | null;
  };
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList>;
  // The onboarding plan-selection screen, also reachable post-onboarding so
  // clients can upgrade from inside the app at any time.
  ChoosePlan: { highlight?: SubscriptionTier } | undefined;
  // Post-onboarding upgrade flow: confirm → process → pick additional
  // strategies → dashboard (with a welcome banner).
  UpgradeConfirm: { tier: 'core' | 'pro' };
  UpgradeStrategySelect: { tier: 'core' | 'pro' };
  // Real-estate onboarding flow, also mounted here so it can be entered after an
  // in-app upgrade when Real Estate is newly added to active_strategies. Same
  // screens/params as the onboarding stack; the completion screen routes to the
  // Dashboard instead of relying on the onboarding Gate.
  RealEstateType: { selectedStrategies: string[] };
  RealEstateMpTest: { selectedStrategies: string[]; portfolioType: RePropertyTypeKey };
  RealEstateReps: RealEstateFlowBase;
  RealEstateProperties: RealEstateFlowBase & {
    repsPursuit: boolean | null;
    totalWorkHours: number | null;
  };
  RealEstateGrouping: RealEstateFlowBase & {
    repsPursuit: boolean | null;
    totalWorkHours: number | null;
    propertyCount: number;
  };
  RealEstateComplete: RealEstateFlowBase & {
    repsPursuit: boolean | null;
    totalWorkHours: number | null;
    grouping: boolean | null;
  };
  DocumentDetail: {
    title: string;
    meta: string;
    strategy?: string;
    status?: string;
    statusVariant?: StatusVariant;
    // When present, the detail screen renders this raw text (e.g. an
    // activity-log document's formatted body) instead of the generic blurb.
    body?: string;
  };
  StrategyDetail: {
    strategy: Strategy;
  };
  RealEstateActivityLog: undefined;
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
  CancelSuccess: {
    // Pre-formatted "Month DD, YYYY" deletion date shown to the user.
    deletionDate: string;
    // false when the confirmation email could not be sent.
    emailSent?: boolean;
  };
  Businesses: undefined;
  BusinessEdit: { businessId?: string } | undefined;
  // Post-onboarding business profile setup, shown once when the user has no
  // business record yet (Fix 6).
  BusinessSetup: undefined;
  Properties: undefined;
  PropertyEdit: { propertyId?: string } | undefined;
  SCorpCompliance: undefined;
  AugustaCompliance: undefined;
  HomeOfficeCompliance: undefined;
  FamilyMgmtCompliance: undefined;
};

export type TabParamList = {
  // upgradedTo triggers the post-upgrade welcome banner + fresh gating refetch.
  Dashboard: { upgradedTo?: SubscriptionTier } | undefined;
  Hours: undefined;
  Trips: undefined;
  Mileage: undefined;
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
