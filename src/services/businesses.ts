// CRUD helpers for the businesses table plus logo upload.

import { File } from 'expo-file-system';
import { decode as decodeBase64 } from 'base64-arraybuffer';
import { supabase, requireUserId, type BusinessRow, type EntityType } from './supabase';

const LOGO_BUCKET = 'business-logos';

// A bare Supabase PostgrestError is a plain object, not an Error instance — so
// callers that do `err instanceof Error ? err.message : String(err)` end up
// printing "[object Object]". Wrap it in a real Error with the readable parts
// (message/code/hint/details) and log the full object for debugging.
function toReadableError(error: unknown, fallback: string): Error {
  const e = (error ?? {}) as {
    message?: string;
    code?: string;
    hint?: string;
    details?: string;
  };
  console.error(`[businesses] ${fallback}`, error);
  const parts = [
    e.message,
    e.code ? `(code ${e.code})` : null,
    e.hint ? `Hint: ${e.hint}` : null,
    e.details ? `Details: ${e.details}` : null,
  ].filter(Boolean);
  return new Error(parts.length > 0 ? parts.join(' — ') : fallback);
}

export const ENTITY_TYPES: EntityType[] = [
  'LLC',
  'S-Corp',
  'C-Corp',
  'Sole Proprietor',
  'Trust',
];

export interface BusinessFormInput {
  business_name: string;
  entity_type: EntityType | null;
  ein: string | null;
  address: string | null;
  logo_url: string | null;
}

export async function uploadLogoFromUri(localUri: string): Promise<string> {
  const userId = await requireUserId();
  const file = new File(localUri);
  const base64 = await file.base64();
  const bytes = decodeBase64(base64);
  const ext = (localUri.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `${userId}/${Date.now()}.${ext}`;
  const contentType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
  const { error } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function createBusiness(input: BusinessFormInput): Promise<BusinessRow> {
  const userId = await requireUserId();
  // First business becomes the default automatically.
  const { count } = await supabase
    .from('businesses')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  const isFirst = (count ?? 0) === 0;

  const { data, error } = await supabase
    .from('businesses')
    .insert({
      user_id: userId,
      business_name: input.business_name.trim(),
      entity_type: input.entity_type,
      ein: input.ein?.trim() || null,
      address: input.address?.trim() || null,
      logo_url: input.logo_url,
      is_default: isFirst,
    })
    .select('*')
    .single();
  if (error || !data) throw toReadableError(error, 'Could not create business');
  return data as BusinessRow;
}

export async function updateBusiness(id: string, input: BusinessFormInput): Promise<BusinessRow> {
  const { data, error } = await supabase
    .from('businesses')
    .update({
      business_name: input.business_name.trim(),
      entity_type: input.entity_type,
      ein: input.ein?.trim() || null,
      address: input.address?.trim() || null,
      logo_url: input.logo_url,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error || !data) throw toReadableError(error, 'Could not update business');
  return data as BusinessRow;
}

export async function deleteBusiness(id: string): Promise<void> {
  const { error } = await supabase.from('businesses').delete().eq('id', id);
  if (error) throw error;
}

// Atomically swap the default flag: clear all, set one.
export async function setDefaultBusiness(id: string): Promise<void> {
  const userId = await requireUserId();
  // Clear the existing default first to avoid violating the unique index.
  const { error: clearErr } = await supabase
    .from('businesses')
    .update({ is_default: false })
    .eq('user_id', userId)
    .eq('is_default', true)
    .neq('id', id);
  if (clearErr) throw clearErr;
  const { error: setErr } = await supabase
    .from('businesses')
    .update({ is_default: true })
    .eq('id', id);
  if (setErr) throw setErr;
}
