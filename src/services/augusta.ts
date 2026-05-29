// Augusta Rule (IRC §280A(g)) meeting logging. The Log Activity form runs the
// captured fields through the SAME GPT-4 minutes pipeline as the Meeting
// Minutes screen (services/openai.generateMinutesDocument) and then saves the
// result to the meeting_minutes and documents tables exactly like that screen
// — so the document format and the Dashboard/strategy trackers stay consistent
// regardless of which path was used to log the meeting.

import { supabase, requireUserId } from './supabase';
import { generateMinutesDocument } from './openai';

export const AUGUSTA_MEETING_TYPES = [
  'Board meeting',
  'Strategy session',
  'Annual review',
  'Property review',
  'Other business meeting',
] as const;

export type AugustaMeetingType = (typeof AUGUSTA_MEETING_TYPES)[number];

export interface AugustaActivityInput {
  businessId: string | null;
  meetingDate: string; // 'YYYY-MM-DD'
  location: string;
  meetingType: string;
  attendees: string;
  durationHours: number | null;
  rentalRate: number | null;
  meetingPurpose: string;
}

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// "MMM DD YYYY" from a plain 'YYYY-MM-DD' (parsed by parts to avoid a TZ shift).
export function formatMeetingDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) {
    const monthIdx = Number(m[2]) - 1;
    if (monthIdx >= 0 && monthIdx < 12) {
      return `${MONTH_SHORT[monthIdx]} ${m[3]} ${m[1]}`;
    }
  }
  return iso;
}

// The fixed AUGUSTA RULE MEETING RECORD layout shown in the Documents detail.
export function buildAugustaMeetingRecord(input: AugustaActivityInput): string {
  const rate =
    input.rentalRate != null && Number.isFinite(input.rentalRate)
      ? `$${input.rentalRate}`
      : '$—';
  const duration =
    input.durationHours != null && Number.isFinite(input.durationHours)
      ? `${input.durationHours} hours`
      : '—';
  return [
    'AUGUSTA RULE MEETING RECORD',
    `Date: ${formatMeetingDate(input.meetingDate)}`,
    `Location: ${input.location || '—'}`,
    `Type: ${input.meetingType || '—'}`,
    `Attendees: ${input.attendees || '—'}`,
    `Duration: ${duration}`,
    `Rental Rate: ${rate}`,
    `Purpose: ${input.meetingPurpose || '—'}`,
  ].join('\n');
}

// Counts named attendees in the free-text attendees field ("Sarah Chen, Mark
// Chen" → 2). Splits on commas, semicolons, ampersands, the word "and", and
// newlines. Returns null when nothing usable was entered.
export function countAttendees(text: string): number | null {
  if (!text) return null;
  const parts = text
    .split(/,|;|&|\n|\band\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.length : null;
}

// Saves the meeting through the shared minutes pipeline:
//   1. Generate the formatted minutes via the same GPT-4 function the Meeting
//      Minutes screen uses (meeting_type 'augusta_rule' selects the Augusta
//      prompt on the proxy).
//   2. Save to meeting_minutes (so the Dashboard/strategy Augusta-day trackers
//      count it identically to a meeting logged on the Minutes screen).
//   3. Save to documents (file_type 'minutes') so it appears in the vault and
//      opens in the standard minutes viewer.
// Returns the generated minutes document for an immediate confirmation preview.
export async function saveAugustaActivity(
  input: AugustaActivityInput,
): Promise<{ document: string }> {
  const userId = await requireUserId();

  // Formatted form data — stored as the meeting_minutes.transcript (the input
  // the document was generated from).
  const transcript = buildAugustaMeetingRecord(input);
  const attendeeCount = countAttendees(input.attendees);

  // 1) Run the form data through the exact GPT-4 minutes generator.
  const document = await generateMinutesDocument({
    transcript,
    meeting_type: 'augusta_rule',
    meeting_date: input.meetingDate,
    location: input.location,
    attendee_count: attendeeCount,
    rental_rate: input.rentalRate,
    duration_hours: input.durationHours,
    attendees: input.attendees,
    meeting_purpose: input.meetingPurpose,
    augusta_meeting_type: input.meetingType,
  });

  // 2) meeting_minutes — same shape the Minutes screen writes (created_at
  //    defaults to now() in the table).
  const { error: minutesError } = await supabase.from('meeting_minutes').insert({
    user_id: userId,
    business_id: input.businessId,
    meeting_type: 'augusta_rule',
    location: input.location || null,
    meeting_date: input.meetingDate,
    transcript,
    minutes_document: document,
    attendee_count: attendeeCount,
    status: 'complete',
  });
  if (minutesError) throw new Error(minutesError.message);

  // 3) documents — mirror into the vault exactly like the Minutes screen.
  const name = `Augusta Rule Meeting Minutes — ${formatMeetingDate(input.meetingDate)}`;
  const { error: docError } = await supabase.from('documents').insert({
    user_id: userId,
    business_id: input.businessId,
    name,
    strategy_category: 'augusta_rule',
    file_type: 'minutes',
    file_url: document,
  });
  if (docError) throw new Error(docError.message);

  return { document };
}
