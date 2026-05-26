// CRUD helpers for the properties table plus material-participation status
// math. The hours threshold is always read from compliance_rules — never
// hardcoded — so admin updates flow through to every screen.

import {
  supabase,
  requireUserId,
  type PropertyRow,
  type PropertyType,
  type HoursLogRow,
} from './supabase';

export const PROPERTY_TYPES: PropertyType[] = [
  'residential',
  'commercial',
  'STR',
  'land',
];

export const PROPERTY_TYPE_LABEL: Record<PropertyType, string> = {
  residential: 'Residential',
  commercial: 'Commercial',
  STR: 'Short-term rental',
  land: 'Land',
};

export interface PropertyFormInput {
  business_id: string | null;
  property_name: string;
  property_type: PropertyType | null;
  address: string | null;
  has_grouping_election: boolean;
  grouping_group_name: string | null;
}

export async function listProperties(businessId: string | null): Promise<PropertyRow[]> {
  const userId = await requireUserId();
  let q = supabase
    .from('properties')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (businessId) q = q.eq('business_id', businessId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as PropertyRow[];
}

export async function createProperty(input: PropertyFormInput): Promise<PropertyRow> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('properties')
    .insert({
      user_id: userId,
      business_id: input.business_id,
      property_name: input.property_name.trim(),
      property_type: input.property_type,
      address: input.address?.trim() || null,
      has_grouping_election: input.has_grouping_election,
      grouping_group_name: input.has_grouping_election
        ? input.grouping_group_name?.trim() || null
        : null,
    })
    .select('*')
    .single();
  if (error || !data) throw error ?? new Error('Could not create property');
  return data as PropertyRow;
}

export async function updateProperty(
  id: string,
  input: PropertyFormInput,
): Promise<PropertyRow> {
  const { data, error } = await supabase
    .from('properties')
    .update({
      business_id: input.business_id,
      property_name: input.property_name.trim(),
      property_type: input.property_type,
      address: input.address?.trim() || null,
      has_grouping_election: input.has_grouping_election,
      grouping_group_name: input.has_grouping_election
        ? input.grouping_group_name?.trim() || null
        : null,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error || !data) throw error ?? new Error('Could not update property');
  return data as PropertyRow;
}

export async function deleteProperty(id: string): Promise<void> {
  const { error } = await supabase.from('properties').delete().eq('id', id);
  if (error) throw error;
}

// Toggle grouping election in-place. Uses a default group name when turning
// on so the UI never shows an empty group.
export async function setGroupingElection(
  id: string,
  enabled: boolean,
  groupName: string | null,
): Promise<PropertyRow> {
  const { data, error } = await supabase
    .from('properties')
    .update({
      has_grouping_election: enabled,
      grouping_group_name: enabled ? (groupName?.trim() || 'Rental Portfolio Group 1') : null,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error || !data) throw error ?? new Error('Could not update grouping election');
  return data as PropertyRow;
}

// ── Material participation status ───────────────────────────────────────

export type ParticipationStatus = 'Met' | 'On Track' | 'At Risk' | 'Not Met';

export interface ParticipationResult {
  status: ParticipationStatus;
  hours: number;
  threshold: number;
  // Statement of which IDs were combined. For ungrouped properties this is
  // just [propertyId]; for grouped, it is every property sharing the same
  // grouping_group_name (with election on).
  combinedPropertyIds: string[];
  groupName: string | null;
}

// Year-fraction elapsed (0..1). Leap years use 366 to stay consistent.
function yearFractionElapsed(now: Date = new Date()): number {
  const year = now.getFullYear();
  const start = new Date(year, 0, 1).getTime();
  const end = new Date(year + 1, 0, 1).getTime();
  return Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
}

function classify(hours: number, threshold: number, now: Date = new Date()): ParticipationStatus {
  if (hours >= threshold) return 'Met';
  const elapsed = yearFractionElapsed(now);
  if (elapsed <= 0) return 'On Track';
  const expected = threshold * elapsed;
  if (hours >= expected) return 'On Track';
  if (hours >= expected * 0.75) return 'At Risk';
  return 'Not Met';
}

// Sum hours_log rows belonging to a set of property IDs. Caller pre-filters
// to current year.
function sumHoursForIds(rows: HoursLogRow[], ids: Set<string>): number {
  let s = 0;
  for (const r of rows) {
    if (!r.hours || !r.property_id) continue;
    if (!ids.has(r.property_id)) continue;
    s += Number(r.hours) || 0;
  }
  return s;
}

// Returns the participation context for a property. Grouped properties share
// a result keyed by grouping_group_name — the same combined hours, status,
// and combinedPropertyIds — so the UI can show the group total under each.
export function computeParticipation(
  property: PropertyRow,
  allProperties: PropertyRow[],
  yearHours: HoursLogRow[],
  threshold: number,
  now: Date = new Date(),
): ParticipationResult {
  if (property.has_grouping_election && property.grouping_group_name) {
    const groupName = property.grouping_group_name;
    const members = allProperties.filter(
      (p) => p.has_grouping_election && p.grouping_group_name === groupName,
    );
    const ids = new Set(members.map((p) => p.id));
    const hours = sumHoursForIds(yearHours, ids);
    return {
      status: classify(hours, threshold, now),
      hours,
      threshold,
      combinedPropertyIds: members.map((m) => m.id),
      groupName,
    };
  }

  const ids = new Set([property.id]);
  const hours = sumHoursForIds(yearHours, ids);
  return {
    status: classify(hours, threshold, now),
    hours,
    threshold,
    combinedPropertyIds: [property.id],
    groupName: null,
  };
}

// Dashboard helper: list properties that fail material participation on their
// own (i.e. ungrouped or, if grouped, the group total still falls short). The
// alert text in DashboardScreen reads from this.
export interface PropertyShortfall {
  property: PropertyRow;
  hours: number;
  threshold: number;
  status: ParticipationStatus;
  groupName: string | null;
}

export function findShortfalls(
  properties: PropertyRow[],
  yearHours: HoursLogRow[],
  threshold: number,
  now: Date = new Date(),
): PropertyShortfall[] {
  // Skip duplicate group entries: report each group once.
  const seenGroups = new Set<string>();
  const out: PropertyShortfall[] = [];
  for (const p of properties) {
    if (p.has_grouping_election && p.grouping_group_name) {
      if (seenGroups.has(p.grouping_group_name)) continue;
      seenGroups.add(p.grouping_group_name);
    }
    const r = computeParticipation(p, properties, yearHours, threshold, now);
    if (r.status === 'At Risk' || r.status === 'Not Met') {
      out.push({
        property: p,
        hours: r.hours,
        threshold: r.threshold,
        status: r.status,
        groupName: r.groupName,
      });
    }
  }
  return out;
}
