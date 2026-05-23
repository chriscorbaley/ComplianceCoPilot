import type { Strategy } from '../components/StrategyCard';
import type { StatusVariant } from '../components/StatusPill';

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
