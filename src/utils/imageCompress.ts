// Shared image-compression helper (Fix 3). Every image uploaded to Supabase
// (business logo, Augusta rate comparables) is first resized and re-encoded as a
// JPEG so the payload stays small. Large raw photos were producing multi-MB
// base64 uploads that could stall the network request — leaving the upload
// spinner spinning forever — so downscaling before upload keeps uploads fast and
// reliable.

import * as ImageManipulator from 'expo-image-manipulator';

// Only images can be compressed. PDFs (which comparables may also be) are left
// untouched — this guard lets callers pass any picked URI safely.
const isImageUri = (uri: string): boolean =>
  /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(uri) ||
  // Picker URIs sometimes omit an extension (e.g. ph:// or content://); treat
  // those as images too since our pickers only ever return images.
  !/\.[a-z0-9]+$/i.test(uri);

// Resize to a max width of 800px (preserving aspect ratio) and re-encode as a
// 70%-quality JPEG. Returns the compressed local URI, or the original URI
// unchanged when the input isn't an image or compression fails (so a manipulator
// hiccup never blocks an upload).
export async function compressImageForUpload(uri: string): Promise<string> {
  if (!isImageUri(uri)) return uri;
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 800 } }],
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
    );
    return result.uri;
  } catch (err) {
    console.warn('[imageCompress] compression failed, using original', err);
    return uri;
  }
}
