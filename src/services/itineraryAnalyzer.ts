// Demo itinerary fixture used by the AI Analyzer's "Try demo itinerary" button.
// The live parser now lives in services/openai.ts → analyzeItinerary().

import type { ParsedItinerary } from './deductibilityEngine';

const DEMO_ITINERARY: ParsedItinerary = {
  destination: 'Frankfurt, Germany',
  trip_type: 'international',
  total_days: 10,
  business_days: 6,
  personal_days: 2,
  travel_days: 2,
  purpose: 'Quarterly partner meetings and supplier audits',
  countries: ['Germany'],
  days: [
    { date: 'Day 1', kind: 'travel', label: 'Fly SFO → FRA' },
    { date: 'Day 2', kind: 'business', label: 'Partner meetings — Frankfurt' },
    { date: 'Day 3', kind: 'business', label: 'Supplier audit — Mainz' },
    { date: 'Day 4', kind: 'business', label: 'Partner workshops' },
    { date: 'Day 5', kind: 'personal', label: 'Day trip — Heidelberg' },
    { date: 'Day 6', kind: 'personal', label: 'Sightseeing — Frankfurt' },
    { date: 'Day 7', kind: 'business', label: 'Investor breakfast + audits' },
    { date: 'Day 8', kind: 'business', label: 'Contract negotiations' },
    { date: 'Day 9', kind: 'business', label: 'Site walkthroughs' },
    { date: 'Day 10', kind: 'travel', label: 'Fly FRA → SFO' },
  ],
};

export const DEMO_TRANSCRIPT =
  'I flew from San Francisco to Frankfurt for our quarterly partner meetings ' +
  'and supplier audits. The trip was ten days total. I spent the first day ' +
  'flying out and the last day flying back. I had six full business days of ' +
  'partner meetings, supplier audits in Mainz, investor breakfasts, contract ' +
  'negotiations, and site walkthroughs. I took two personal days in the ' +
  'middle to visit Heidelberg and explore Frankfurt.';

export function getDemoItinerary(): ParsedItinerary {
  return JSON.parse(JSON.stringify(DEMO_ITINERARY));
}
