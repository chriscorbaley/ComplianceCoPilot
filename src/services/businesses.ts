// CRUD helpers for the businesses table plus logo upload.

import { File } from 'expo-file-system';
import { decode as decodeBase64 } from 'base64-arraybuffer';
import { supabase, requireUserId, type BusinessRow, type EntityType } from './supabase';
import { compressImageForUpload } from '../utils/imageCompress';

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

// Upload the logo and return the STORAGE PATH (e.g. <userId>/<businessId>/logo.jpg),
// NOT a public URL. The 'business-logos' bucket is private, so a public URL renders
// a white box — instead we persist the path and mint a short-lived signed URL on
// demand at display time (see getSignedLogoUrl).
//
// The businessId is REQUIRED and forms the second path segment so every business
// gets its own logo file. Without it, all of a user's businesses would share one
// path and each upload would overwrite the previous business's logo.
export async function uploadLogoFromUri(localUri: string, businessId: string): Promise<string> {
  const userId = await requireUserId();
  // Downscale + re-encode as JPEG before upload so a large photo can't stall the
  // request (which would leave the upload spinner hanging). Result is always a
  // JPEG, so the stored file is <userId>/<businessId>/logo.jpg (image/jpeg).
  const compressedUri = await compressImageForUpload(localUri);
  const file = new File(compressedUri);
  const base64 = await file.base64();
  const bytes = decodeBase64(base64);
  // Path MUST start with the user's UUID as the first folder segment — the
  // 'business-logos' bucket RLS policy allows uploads only where
  // (storage.foldername(name))[1] = auth.uid(). The businessId is the second
  // segment so each business has its own file, e.g. <userId>/<businessId>/logo.jpg.
  const path = `${userId}/${businessId}/logo.jpg`;
  const contentType = 'image/jpeg';
  const { error } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (error) {
    console.error('[Business Logo] upload failed:', JSON.stringify(error));
    throw toReadableError(error, 'Logo upload failed');
  }
  return path;
}

// Normalize whatever is stored in businesses.logo_url into a bucket-relative
// storage path. New rows store the bare path (<uuid>/logo.jpg); legacy rows may
// still hold a full public URL, so strip everything up to and including the
// bucket segment.
function toStoragePath(logoUrl: string): string {
  if (logoUrl.includes(`${LOGO_BUCKET}/`)) {
    return logoUrl.split(`${LOGO_BUCKET}/`).pop() ?? logoUrl;
  }
  return logoUrl;
}

// Mint a short-lived signed URL for a private-bucket logo so <Image> can render
// it. Accepts either a bare storage path or a legacy full URL. Returns null on
// failure so callers can fall back to a placeholder instead of a white box.
export async function getSignedLogoUrl(
  logoUrl: string | null | undefined,
  expiresInSeconds = 3600,
): Promise<string | null> {
  if (!logoUrl) return null;
  const path = toStoragePath(logoUrl);
  const { data, error } = await supabase.storage
    .from(LOGO_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) {
    console.error('[Business Logo] signed URL error:', JSON.stringify(error));
    return null;
  }
  return data.signedUrl;
}

// Persist a freshly-uploaded logo to the businesses row immediately, without
// waiting for the user to tap Save. Storage upload alone is not "success": if
// this DB write fails (or is skipped by navigating away), the logo is lost.
// Surfaces the DB error so the caller can tell the user the save failed rather
// than showing a false success from the storage upload.
export async function updateBusinessLogo(businessId: string, logoUrl: string): Promise<void> {
  const { error } = await supabase
    .from('businesses')
    .update({ logo_url: logoUrl })
    .eq('id', businessId);
  if (error) {
    console.error('[Business Logo] DB save failed:', JSON.stringify(error));
    throw toReadableError(error, 'Logo uploaded but could not save to profile');
  }
  console.log('[Business Logo] saved:', logoUrl);
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

  // Backfill: properties added during onboarding (before any business existed)
  // are saved with a null business_id. Attach those orphans to this first
  // business so they appear in the Material Participation and Properties screens,
  // which filter by the active business. Best-effort — a failure here must not
  // block business creation.
  if (isFirst) {
    const { error: backfillErr } = await supabase
      .from('properties')
      .update({ business_id: data.id })
      .eq('user_id', userId)
      .is('business_id', null);
    if (backfillErr) {
      console.error('[createBusiness] property backfill failed:', backfillErr);
    }
  }

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
