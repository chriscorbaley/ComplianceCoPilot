// Per-user checklist state for ongoing strategy compliance. One row per
// (user, strategy_key, item_key) — enforced by a unique constraint on the
// table so upserts are conflict-safe.

import { supabase, requireUserId } from './supabase';

export interface ComplianceChecklistRow {
  id: string;
  user_id: string;
  strategy_key: string;
  item_key: string;
  item_label: string | null;
  is_checked: boolean;
  last_confirmed_at: string | null;
  created_at: string;
}

export async function listChecklistItems(
  strategyKey: string,
): Promise<ComplianceChecklistRow[]> {
  const { data, error } = await supabase
    .from('compliance_checklist_items')
    .select('*')
    .eq('strategy_key', strategyKey);
  if (error) throw error;
  return (data ?? []) as ComplianceChecklistRow[];
}

// Toggle a single item and stamp last_confirmed_at when checking. Unchecking
// leaves last_confirmed_at as-is so the user can still see when they last
// reviewed the item even if it's now stale.
export async function setChecklistItem(
  strategyKey: string,
  itemKey: string,
  itemLabel: string,
  isChecked: boolean,
): Promise<ComplianceChecklistRow> {
  const userId = await requireUserId();
  const payload: Record<string, unknown> = {
    user_id: userId,
    strategy_key: strategyKey,
    item_key: itemKey,
    item_label: itemLabel,
    is_checked: isChecked,
  };
  if (isChecked) payload.last_confirmed_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('compliance_checklist_items')
    .upsert(payload, { onConflict: 'user_id,strategy_key,item_key' })
    .select('*')
    .single();
  if (error || !data) throw error ?? new Error('Could not save checklist item');
  return data as ComplianceChecklistRow;
}
