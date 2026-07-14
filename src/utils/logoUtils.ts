// Resolve the user's business logo as a base64 data URI for embedding in PDFs.
//
// Why base64: expo-print renders HTML → PDF WITHOUT a network stack, so an
// <img> pointing at a remote URL (even a valid signed URL) resolves to a broken
// image in the exported PDF — even though the same URL renders fine in an
// in-app <Image>. That mismatch is exactly the "logo shows in the app but not on
// the PDF" bug. On top of that the 'business-logos' bucket is PRIVATE, so
// businesses.logo_url holds only a bare storage path, not a fetchable URL.
//
// The fix: mint a short-lived signed URL, download the bytes to the cache, and
// inline them as a `data:` URI so the PDF needs no network at render time.

import { File, Paths } from 'expo-file-system';
import { supabase, getCurrentUserId } from '../services/supabase';
import { getSignedLogoUrl } from '../services/businesses';

// Convert a single stored logo_url (a bare private-bucket storage path, or a
// legacy full URL) to a base64 data URI. Returns null on any failure. Use this
// when you already hold a specific business's logo_url (e.g. the ACTIVE business
// on a screen) and want that exact logo rather than the default one.
export async function logoUrlToBase64(
  logoUrl: string | null | undefined,
): Promise<string | null> {
  if (!logoUrl) return null;
  try {
    // logo_url is a private-bucket storage PATH — mint a signed URL to fetch it.
    const signedUrl = await getSignedLogoUrl(logoUrl);
    if (!signedUrl) return null;

    // Download to a unique cache file, then base64-encode. A unique name avoids
    // colliding with a concurrent export's temp file.
    const target = new File(Paths.cache, `logo_pdf_${Date.now()}.img`);
    const downloaded = await File.downloadFileAsync(signedUrl, target);
    const base64 = await downloaded.base64();

    // Uploaded logos are always JPEG (see uploadLogoFromUri); legacy rows may be
    // PNG. Infer the mime from the stored path so strict renderers accept it.
    const mime = logoUrl.toLowerCase().endsWith('.png')
      ? 'image/png'
      : 'image/jpeg';
    return `data:${mime};base64,${base64}`;
  } catch (err) {
    console.error('[Logo] base64 failed:', err);
    return null;
  }
}

// Returns the given user's DEFAULT business logo as a base64 data URI, or null
// when no default logo is set or the download fails. Never throws — callers fall
// back to a text/brand mark rather than a broken image.
export async function getLogoAsBase64(userId: string): Promise<string | null> {
  try {
    const { data: business, error } = await supabase
      .from('businesses')
      .select('logo_url')
      .eq('user_id', userId)
      .eq('is_default', true)
      .maybeSingle();
    if (error || !business?.logo_url) return null;
    return await logoUrlToBase64(business.logo_url);
  } catch (err) {
    console.error('[Logo] base64 failed:', err);
    return null;
  }
}

// Convenience wrapper: resolve the current authenticated user's id, then their
// business logo as base64. Used by the shared PDF pipeline (hydrateLogo) and by
// pure services that don't already have a userId in scope.
export async function getCurrentUserLogoBase64(): Promise<string | null> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return null;
    return await getLogoAsBase64(userId);
  } catch {
    return null;
  }
}
