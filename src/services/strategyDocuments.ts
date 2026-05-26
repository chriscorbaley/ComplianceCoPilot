// CRUD + file uploads for the strategy_documents table.
//
// Row model: one row per uploaded file for a (strategy_key, document_key)
// slot. Most slots have at most one row per user (the "Replace" flow updates
// in place by id), but a few slots — Home Office renovation receipts — allow
// many rows under the same document_key. Callers handle that distinction.
//
// Files live in the private `strategy-documents` storage bucket under the
// path convention `<user_id>/<strategy_key>/<document_key>/<timestamp>.<ext>`.
// RLS lets a user read/write only their own folder.

import { File } from 'expo-file-system';
import { decode as decodeBase64 } from 'base64-arraybuffer';
import { supabase, requireUserId } from './supabase';

export const STRATEGY_DOCUMENTS_BUCKET = 'strategy-documents';

export interface StrategyDocumentRow {
  id: string;
  user_id: string;
  business_id: string | null;
  strategy_key: string;
  document_key: string;
  document_name: string | null;
  file_url: string | null;
  file_type: string | null;
  metadata: Record<string, unknown>;
  uploaded_at: string;
  created_at: string;
}

export interface UploadInput {
  strategyKey: string;
  documentKey: string;
  businessId?: string | null;
  localUri: string;
  fileName: string;
  mimeType?: string | null;
  metadata?: Record<string, unknown>;
}

// Upload a single file and insert a new row. Returns the inserted row.
export async function uploadStrategyDocument(input: UploadInput): Promise<StrategyDocumentRow> {
  const userId = await requireUserId();

  const file = new File(input.localUri);
  const base64 = await file.base64();
  const bytes = decodeBase64(base64);

  const ext = (input.fileName.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const path = `${userId}/${input.strategyKey}/${input.documentKey}/${Date.now()}.${ext}`;
  const contentType = input.mimeType ?? 'application/octet-stream';

  const { error: uploadErr } = await supabase.storage
    .from(STRATEGY_DOCUMENTS_BUCKET)
    .upload(path, bytes, { contentType, upsert: false });
  if (uploadErr) throw uploadErr;

  const { data, error } = await supabase
    .from('strategy_documents')
    .insert({
      user_id: userId,
      business_id: input.businessId ?? null,
      strategy_key: input.strategyKey,
      document_key: input.documentKey,
      document_name: input.fileName,
      file_url: path,
      file_type: input.mimeType ?? null,
      metadata: input.metadata ?? {},
      uploaded_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (error || !data) throw error ?? new Error('Could not save document');
  return data as StrategyDocumentRow;
}

// "Replace" semantics: delete the existing row's storage object + DB row, then
// upload as a fresh row. Simpler than mutating in place and keeps file_url
// authoritative.
export async function replaceStrategyDocument(
  existingId: string,
  input: UploadInput,
): Promise<StrategyDocumentRow> {
  await deleteStrategyDocument(existingId);
  return uploadStrategyDocument(input);
}

export async function deleteStrategyDocument(id: string): Promise<void> {
  // Pull the row first so we know which storage path to remove.
  const { data: existing, error: fetchErr } = await supabase
    .from('strategy_documents')
    .select('file_url')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) throw fetchErr;

  if (existing?.file_url) {
    // Ignore storage delete failures — the DB row going away is what matters
    // for UI state. Orphan files (if any) are bounded by the user's own folder.
    await supabase.storage
      .from(STRATEGY_DOCUMENTS_BUCKET)
      .remove([existing.file_url as string])
      .catch(() => undefined);
  }

  const { error } = await supabase.from('strategy_documents').delete().eq('id', id);
  if (error) throw error;
}

// Save metadata only (no file change). Used by the Home Office calculator to
// persist the percentage even when no file has been uploaded yet — we
// upsert a placeholder row with file_url = null in that case.
export async function updateStrategyDocumentMetadata(
  id: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from('strategy_documents')
    .update({ metadata })
    .eq('id', id);
  if (error) throw error;
}

export async function listStrategyDocuments(
  strategyKey: string,
  businessId?: string | null,
): Promise<StrategyDocumentRow[]> {
  let query = supabase
    .from('strategy_documents')
    .select('*')
    .eq('strategy_key', strategyKey)
    .order('uploaded_at', { ascending: false });
  if (businessId) query = query.eq('business_id', businessId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as StrategyDocumentRow[];
}

// All compliance docs across every strategy, scoped to the active business if
// passed. Used by the main Documents screen to surface compliance uploads
// alongside the regular `documents` table.
export async function listAllStrategyDocuments(
  businessId?: string | null,
): Promise<StrategyDocumentRow[]> {
  let query = supabase
    .from('strategy_documents')
    .select('*')
    .order('uploaded_at', { ascending: false });
  if (businessId) query = query.eq('business_id', businessId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as StrategyDocumentRow[];
}

// Return a short-lived signed URL for viewing the file. Bucket is private so
// we cannot use getPublicUrl.
export async function getStrategyDocumentSignedUrl(
  storagePath: string,
  expiresInSeconds = 60 * 10,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(STRATEGY_DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data?.signedUrl) throw error ?? new Error('Could not sign document URL');
  return data.signedUrl;
}
