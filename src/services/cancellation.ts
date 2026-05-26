// Cancellation flow helpers: document counts, bulk download, signature uploads,
// cancellation record insert, and edge-function calls (Stripe + email).

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { decode as decodeBase64 } from 'base64-arraybuffer';
import { supabase, requireUserId, type DocumentRow } from './supabase';

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

// Download each document to the device's cache directory and invoke the system
// share sheet so the user can save them (Files app, email, drive, etc).
// Documents without a file_url are silently skipped.
export async function downloadAllDocuments(docs: DocumentSnapshot[]): Promise<{ downloaded: number; skipped: number }> {
  let downloaded = 0;
  let skipped = 0;
  const sharingAvailable = await Sharing.isAvailableAsync();
  for (const doc of docs) {
    if (!doc.fileUrl) {
      skipped += 1;
      continue;
    }
    try {
      const safeName = doc.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const ext = doc.fileType && !safeName.includes('.') ? `.${doc.fileType}` : '';
      const targetFile = new File(Paths.cache, `${safeName}${ext}`);
      const downloaded_file = await File.downloadFileAsync(doc.fileUrl, targetFile);
      if (sharingAvailable) {
        await Sharing.shareAsync(downloaded_file.uri, { dialogTitle: doc.name });
      }
      downloaded += 1;
    } catch {
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

export function formatDeletionDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
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
