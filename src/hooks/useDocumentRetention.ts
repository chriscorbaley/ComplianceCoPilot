import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { type DocumentRow } from '../services/supabase';
import {
  getRetentionWarning,
  listExpiringDocuments,
  retentionNotificationText,
  type RetentionWarning,
} from '../services/documentRetention';
import { scheduleRetentionReminder } from '../services/notifications';
import { escapeHtml, hydrateLogo } from '../services/pdfDocuments';

const HTML_DOC_TYPES = new Set(['signed_document', 'invoice']);
const TEXT_DOC_TYPES = new Set(['minutes', 'activity_log', 'augusta_meeting']);

// Renders a plain-text document (minutes / activity logs) to simple HTML.
function textToHtml(name: string, text: string): string {
  const body = text
    .split(/\r?\n/)
    .map((raw) => {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) return '<div style="height:8px"></div>';
      const heading = /^(#{1,3})\s+(.*)$/.exec(line);
      if (heading) {
        return `<h${heading[1].length}>${escapeHtml(
          heading[2].replace(/\*\*/g, ''),
        )}</h${heading[1].length}>`;
      }
      const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
      if (bullet) return `<li>${escapeHtml(bullet[1].replace(/\*\*/g, ''))}</li>`;
      return `<p>${escapeHtml(line.replace(/\*\*/g, ''))}</p>`;
    })
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8" />
<style>
  @page { margin: 48px; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1A1A2E; font-size: 12pt; line-height: 1.5; }
  h1 { color: #042C53; font-size: 18pt; border-bottom: 2px solid #042C53; padding-bottom: 8px; }
  h2 { color: #042C53; font-size: 14pt; } h3 { color: #1A1A2E; font-size: 12pt; }
  p { margin: 4px 0 8px 0; } li { margin: 2px 0; }
</style></head><body><h1>${escapeHtml(name)}</h1>${body}</body></html>`;
}

// Shares a single document row via the system share sheet, rendering generated
// text/HTML documents to a PDF first.
async function shareDocumentRow(d: DocumentRow): Promise<void> {
  const ft = d.file_type ?? '';
  const name = d.name ?? 'Document';
  if (HTML_DOC_TYPES.has(ft) && d.file_url) {
    const html = await hydrateLogo(d.file_url);
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: name,
    });
    return;
  }
  if (TEXT_DOC_TYPES.has(ft) && d.file_url) {
    const { uri } = await Print.printToFileAsync({
      html: textToHtml(name, d.file_url),
      base64: false,
    });
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: name,
    });
    return;
  }
  if (d.file_url) {
    await Sharing.shareAsync(d.file_url);
  }
}

export interface DocumentRetentionState {
  warning: RetentionWarning | null;
  progress: { current: number; total: number } | null;
  dismiss: () => void;
  downloadAll: () => Promise<void>;
  refresh: () => Promise<void>;
}

// Loads the active retention warning for the current business, schedules the
// weekly push reminder when one is active, and exposes a sequential
// "download all" action for the affected year's documents.
export function useDocumentRetention(
  businessId: string | null,
): DocumentRetentionState {
  const [warning, setWarning] = useState<RetentionWarning | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  const refresh = useCallback(async () => {
    const w = await getRetentionWarning(businessId).catch(() => null);
    setWarning(w);
    if (w) {
      const { title, body } = retentionNotificationText(w);
      // Best-effort — no-ops without permission.
      void scheduleRetentionReminder(title, body);
    }
  }, [businessId]);

  useEffect(() => {
    setDismissed(false);
    void refresh();
  }, [refresh]);

  const downloadAll = useCallback(async () => {
    if (!warning) return;
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert('Sharing not available', 'This device cannot share files.');
        return;
      }
      const docs = await listExpiringDocuments(businessId, warning.docYear);
      if (docs.length === 0) {
        Alert.alert('Nothing to download', 'No documents were found for this period.');
        return;
      }
      for (let i = 0; i < docs.length; i += 1) {
        setProgress({ current: i + 1, total: docs.length });
        try {
          await shareDocumentRow(docs[i]);
        } catch {
          // Skip a document that fails to share; continue with the rest.
        }
      }
    } catch (e) {
      Alert.alert('Download failed', e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  }, [warning, businessId]);

  const dismiss = useCallback(() => setDismissed(true), []);

  return {
    warning: dismissed ? null : warning,
    progress,
    dismiss,
    downloadAll,
    refresh,
  };
}
