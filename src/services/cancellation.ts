// Cancellation flow helpers: document counts, bulk download, signature uploads,
// cancellation record insert, and the hand-off to the store's own subscription
// management UI.
//
// BILLING vs RETENTION — these are two separate things and this module only
// owns one of them:
//   • RETENTION (ours): the signed cancellations row and its 30-day deletion
//     clock. Recorded here, exactly as before.
//   • BILLING (the store's): only Apple/Google can stop charging someone. There
//     is no API that lets an app cancel an IAP subscription on the user's
//     behalf, so the actual cancellation is the user acting in the store's own
//     sheet, which we open for them.
//
// This module deliberately does NOT write users.subscription_tier /
// subscription_status. It used to, which revoked access the instant someone
// cancelled — wrong for IAP, where Apple and Google keep a subscription usable
// until the paid period ends. The RevenueCat webhook owns those columns and
// already models this correctly (markCancelledKeepAccess on CANCELLATION,
// revoke on EXPIRATION).

import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { decode as decodeBase64 } from 'base64-arraybuffer';
import { supabase, requireUserId, type DocumentRow } from './supabase';
import { renderHtmlToPdfUri } from './pdfDocuments';
import { hasRenewingSubscription, openManageSubscriptions } from './revenueCat';

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
  // Optional: the double-signature flow supplies both; the simple-confirmation
  // flow (feature flag `cancellation_signature` off) supplies neither.
  signature1DataUrl?: string;
  signature2DataUrl?: string;
  documentCount: number;
}

// Sentinel written to the NOT NULL signature columns when the account is
// cancelled via the simple confirmation dialog rather than hand signatures.
const NO_SIGNATURE_MARKER = 'simple-confirmation';

export interface CancellationResult {
  cancellationId: string;
  deletionScheduledFor: string;
  // The store's subscription-management UI was successfully presented. False
  // means we couldn't open it and the user must be told to go there themselves.
  manageOpened: boolean;
  // ADVISORY: the store still reported a renewing subscription after the
  // hand-off, so the user may have dismissed the sheet without cancelling.
  // null when unknowable (Android, SDK unconfigured, probe failed). Never
  // treated as proof — see hasRenewingSubscription().
  stillRenewing: boolean | null;
  emailSent: boolean;
}

export async function completeCancellation(
  input: CompleteCancellationInput,
): Promise<CancellationResult> {
  const userId = await requireUserId();

  // Upload signatures only when the signature flow supplied them; otherwise
  // record the simple-confirmation sentinel in the NOT NULL columns.
  const [sig1Path, sig2Path] =
    input.signature1DataUrl && input.signature2DataUrl
      ? await Promise.all([
          uploadSignature(userId, 1, input.signature1DataUrl),
          uploadSignature(userId, 2, input.signature2DataUrl),
        ])
      : [NO_SIGNATURE_MARKER, NO_SIGNATURE_MARKER];

  const deletionScheduledFor = deletionDateFromNow().toISOString();

  // The retention record. Written FIRST and unconditionally: it captures the
  // signatures and the document count, which are true regardless of what
  // happens next in the store's sheet. If the user backs out without actually
  // cancelling, the purge-time guard in the process-deletions function refuses
  // to delete and voids this row — deferring the insert instead would throw the
  // signatures away, which is the one thing this flow exists to capture.
  //
  // cancellations.stripe_subscription_id is intentionally left null: it was
  // only ever populated by the never-deployed Stripe webhook, and nothing reads
  // it now that the Stripe cancel call is gone.
  const { data: inserted, error: insertErr } = await supabase
    .from('cancellations')
    .insert({
      user_id: userId,
      deletion_scheduled_for: deletionScheduledFor,
      signature_1_url: sig1Path,
      signature_2_url: sig2Path,
      document_count_at_cancellation: input.documentCount,
    })
    .select('id')
    .single();
  if (insertErr || !inserted) {
    throw insertErr ?? new Error('Failed to record cancellation');
  }
  const cancellationId = (inserted as { id: string }).id;

  // Courtesy confirmation of the request. Sent before the hand-off so the store
  // sheet isn't interrupted by an in-flight network call, and never fatal.
  let emailSent = false;
  try {
    const { error: emailErr } = await supabase.functions.invoke('send-cancellation-email', {
      body: { cancellation_id: cancellationId },
    });
    emailSent = !emailErr;
  } catch {
    emailSent = false;
  }

  // The actual cancellation: hand the user to Apple's / Google's own
  // subscription management. Nothing else can stop the billing.
  const manageResult = await openManageSubscriptions();
  const manageOpened = manageResult === 'opened';

  // Advisory probe. Only meaningful on iOS, where showManageSubscriptions()
  // resolves after the sheet is dismissed. On Android the deep link resolves
  // immediately with the app backgrounded, so anything we read here predates
  // the user acting — don't ask.
  let stillRenewing: boolean | null = null;
  if (manageOpened && Platform.OS === 'ios') {
    stillRenewing = await hasRenewingSubscription();
  }

  return { cancellationId, deletionScheduledFor, manageOpened, stillRenewing, emailSent };
}
