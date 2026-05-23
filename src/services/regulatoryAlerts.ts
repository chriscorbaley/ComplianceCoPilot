// Realtime feed for public.regulatory_alerts. Admin-only table — non-admins
// will never see rows because RLS blocks the SELECT. This module exposes the
// count of pending-review alerts for an Admin badge (UI is out of scope for
// now), and pushes updates as soon as Supabase delivers a change event.

import { useEffect, useState } from 'react';
import { supabase, type RegulatoryAlertRow } from './supabase';

let pendingCount = 0;
let started = false;
const listeners = new Set<(n: number) => void>();

async function refreshCount(): Promise<void> {
  const { count, error } = await supabase
    .from('regulatory_alerts')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending_review');
  if (error) return;
  pendingCount = count ?? 0;
  listeners.forEach((fn) => fn(pendingCount));
}

function ensureStarted(): void {
  if (started) return;
  started = true;
  void refreshCount();
  supabase
    .channel('regulatory_alerts-stream')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'regulatory_alerts' },
      () => {
        void refreshCount();
      },
    )
    .subscribe();
}

export function getPendingAlertCount(): number {
  return pendingCount;
}

export function usePendingAlertCount(): number {
  const [n, setN] = useState(pendingCount);
  useEffect(() => {
    listeners.add(setN);
    ensureStarted();
    return () => {
      listeners.delete(setN);
    };
  }, []);
  return n;
}

export async function listPendingAlerts(): Promise<RegulatoryAlertRow[]> {
  const { data, error } = await supabase
    .from('regulatory_alerts')
    .select('*')
    .eq('status', 'pending_review')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as RegulatoryAlertRow[];
}
