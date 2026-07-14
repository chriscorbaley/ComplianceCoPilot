// Cancellation flow helpers: document counts, bulk download, signature uploads,
// cancellation record insert, and edge-function calls (Stripe + email).

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { decode as decodeBase64 } from 'base64-arraybuffer';
import { supabase, requireUserId, type DocumentRow } from './supabase';
import { renderHtmlToPdfUri } from './pdfDocuments';

// Escape user text for safe embedding in the generated PDF's <pre> block.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Generated documents (minutes, signed docs, invoices) store their content
// directly in file_url rather than a storage URL. Some are already full HTML;
// plain-text ones (e.g. meeting minutes) need to be wrapped before printing.
function contentToPdfHtml(content: string): string {
  const looksLikeHtml = /<(!doctype|html|body|div|table|section|p)\b/i.test(content);
  if (looksLikeHtml) return content;
  return `<html><head><meta charset="utf-8" /></head><body><pre style="white-space:pre-wrap;word-wrap:break-word;font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#1A1A1A;padding:24px;">${escapeHtml(
    content,
  )}</pre></body></html>`;
}

const SIGNATURE_BUCKET = 'cancellations';
const RETENTION_DAYS = 30;

export interface DocumentSnapshot {
  id: string;
  name: string;
  fileUrl: string | null;
  fileType: string | null;
}

export async function fetchUserDocuments(userId: string): Promise<DocumentSnapshot[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('id, name, file_url, file_type')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as Pick<DocumentRow, 'id' | 'name' | 'file_url' | 'file_type'>[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name ?? 'Untitled document',
    fileUrl: r.file_url,
    fileType: r.file_type,
  }));
}

export async function fetchDocumentCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) throw error;
  return count ?? 0;
}

// Download / export every document and invoke the system share sheet so the
// user can save them (Files app, email, drive, etc). Handles ALL document
// types, not just real storage files:
//   • file_url is a real storage URL (starts with http) → download the file
//     and share it.
//   • file_url holds document content (meeting minutes text, generated HTML) →
//     render it to a PDF with expo-print and share that.
// Only documents with no file_url at all are skipped. onProgress fires before
// each document is processed so the UI can show "Downloading document X of Y…".
export async function downloadAllDocuments(
  docs: DocumentSnapshot[],
  onProgress?: (current: number, total: number) => void,
): Promise<{ downloaded: number; skipped: number }> {
  let downloaded = 0;
  let skipped = 0;
  const sharingAvailable = await Sharing.isAvailableAsync();
  for (let i = 0; i < docs.length; i += 1) {
    onProgress?.(i + 1, docs.length);
    const doc = docs[i];
    console.log(
      '[Download] attempting:',
      doc.name,
      'type:',
      doc.fileType,
      'url starts with:',
      doc.fileUrl?.substring(0, 20),
    );
    if (!doc.fileUrl) {
      console.log('[Download] skipped (no file_url):', doc.name);
      skipped += 1;
      continue;
    }
    try {
      if (doc.fileUrl.startsWith('http')) {
        // Real file in storage — download it, then share.
        const safeName = doc.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const ext = doc.fileType && !safeName.includes('.') ? `.${doc.fileType}` : '';
        const targetFile = new File(Paths.cache, `${safeName}${ext}`);
        const downloadedFile = await File.downloadFileAsync(doc.fileUrl, targetFile);
        if (sharingAvailable) {
          await Sharing.shareAsync(downloadedFile.uri, { dialogTitle: doc.name });
        }
      } else {
        // Text / HTML content stored inline (minutes, generated docs) — render
        // to a PDF and share it.
        const uri = await renderHtmlToPdfUri(contentToPdfHtml(doc.fileUrl));
        if (sharingAvailable) {
          await Sharing.shareAsync(uri, {
            mimeType: 'application/pdf',
            dialogTitle: doc.name,
            UTI: 'com.adobe.pdf',
          });
        }
      }
      downloaded += 1;
    } catch (err) {
      console.error('[Download] failed for', doc.name, JSON.stringify(err));
      skipped += 1;
    }
  }
  return { downloaded, skipped };
}

// react-native-signature-canvas returns "data:image/png;base64,iVBOR..." —
// strip the prefix, decode to bytes, upload to private storage.
export async function uploadSignature(
  userId: string,
  slot: 1 | 2,
  signatureDataUrl: string,
): Promise<string> {
  const base64 = signatureDataUrl.replace(/^data:image\/\w+;base64,/, '');
  const bytes = decodeBase64(base64);
  const path = `${userId}/signature_${slot}.png`;
  const { error } = await supabase.storage
    .from(SIGNATURE_BUCKET)
    .upload(path, bytes, { contentType: 'image/png', upsert: true });
  if (error) throw error;
  return path;
}

export function deletionDateFromNow(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + RETENTION_DAYS);
  return d;
}

// Spec format: "Month DD, YYYY" (no weekday), e.g. "August 12, 2026".
export function formatDeletionDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export interface CompleteCancellationInput {
  signature1DataUrl: string;
  signature2DataUrl: string;
  documentCount: number;
}

export interface CancellationResult {
  cancellationId: string;
  deletionScheduledFor: string;
  stripeCancelled: boolean;
  emailSent: boolean;
}

export async function completeCancellation(
  input: CompleteCancellationInput,
): Promise<CancellationResult> {
  const userId = await requireUserId();

  const [sig1Path, sig2Path] = await Promise.all([
    uploadSignature(userId, 1, input.signature1DataUrl),
    uploadSignature(userId, 2, input.signature2DataUrl),
  ]);

  const deletionScheduledFor = deletionDateFromNow().toISOString();

  const { data: userRow } = await supabase
    .from('users')
    .select('stripe_subscription_id')
    .eq('id', userId)
    .maybeSingle();
  const stripeSubscriptionId =
    (userRow as { stripe_subscription_id?: string | null } | null)?.stripe_subscription_id ?? null;

  const { data: inserted, error: insertErr } = await supabase
    .from('cancellations')
    .insert({
      user_id: userId,
      deletion_scheduled_for: deletionScheduledFor,
      signature_1_url: sig1Path,
      signature_2_url: sig2Path,
      document_count_at_cancellation: input.documentCount,
      stripe_subscription_id: stripeSubscriptionId,
    })
    .select('id')
    .single();
  if (insertErr || !inserted) {
    throw insertErr ?? new Error('Failed to record cancellation');
  }
  const cancellationId = (inserted as { id: string }).id;

  // Downgrade the account immediately: mark cancelled and drop to the free
  // ("starter") tier. Documents stay readable until the scheduled purge date;
  // gating (useStrategyAccess) re-locks paid strategies on the next render.
  const { error: userUpdateErr } = await supabase
    .from('users')
    .update({ subscription_status: 'cancelled', subscription_tier: 'starter' })
    .eq('id', userId);
  if (userUpdateErr) throw userUpdateErr;

  let stripeCancelled = false;
  try {
    const { error: cancelErr } = await supabase.functions.invoke('cancel-subscription', {
      body: { cancellation_id: cancellationId },
    });
    stripeCancelled = !cancelErr;
  } catch {
    stripeCancelled = false;
  }

  let emailSent = false;
  try {
    const { error: emailErr } = await supabase.functions.invoke('send-cancellation-email', {
      body: { cancellation_id: cancellationId },
    });
    emailSent = !emailErr;
  } catch {
    emailSent = false;
  }

  return { cancellationId, deletionScheduledFor, stripeCancelled, emailSent };
}
