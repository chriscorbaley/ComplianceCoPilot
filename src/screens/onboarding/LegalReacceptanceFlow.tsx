import React, { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { AcceptanceScreen } from './AcceptanceScreen';
import { supabase, type LegalDocumentType } from '../../services/supabase';
import { fetchActiveLegalDoc, LEGAL_FALLBACK, type LegalDocContent } from '../../services/legalDocuments';
import { useAuth } from '../../auth/AuthContext';

interface LegalReacceptanceFlowProps {
  // The documents that changed and must be re-accepted, in display order.
  needed: LegalDocumentType[];
  // Called once every needed document has been re-accepted.
  onComplete: () => void;
}

const META: Record<LegalDocumentType, { title: string; checkboxLabel: string }> = {
  tos: {
    title: 'Updated Terms of Service',
    checkboxLabel: 'I have read and agree to the Terms of Service',
  },
  privacy: {
    title: 'Updated Privacy Policy',
    checkboxLabel: 'I have read and acknowledge the Privacy Policy',
  },
};

/**
 * Shown at launch when a user's accepted ToS/Privacy version no longer matches
 * the active version. Walks the changed documents one at a time, records a new
 * acceptance row for each, then hands control back to the Gate (which re-checks
 * and drops the user into the main app).
 */
export const LegalReacceptanceFlow: React.FC<LegalReacceptanceFlowProps> = ({
  needed,
  onComplete,
}) => {
  const { session } = useAuth();
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const current = needed[index];
  const [doc, setDoc] = useState<LegalDocContent>(
    current ? LEGAL_FALLBACK[current] : LEGAL_FALLBACK.tos,
  );

  useEffect(() => {
    if (!current) {
      onComplete();
      return;
    }
    let mounted = true;
    setLoading(true);
    fetchActiveLegalDoc(current).then((d) => {
      if (mounted) {
        setDoc(d);
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, [current, onComplete]);

  const onAccept = async () => {
    if (!session?.user.id || !current) return;
    setBusy(true);
    try {
      const insert =
        current === 'tos'
          ? supabase
              .from('tos_acceptances')
              .insert({ user_id: session.user.id, tos_version: doc.version })
          : supabase
              .from('privacy_acceptances')
              .insert({ user_id: session.user.id, policy_version: doc.version });
      const { error } = await insert;
      if (error) throw error;
      if (index + 1 < needed.length) {
        setIndex(index + 1);
      } else {
        onComplete();
      }
    } catch (err) {
      Alert.alert('Could not save acceptance', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!current) return null;

  return (
    <AcceptanceScreen
      title={META[current].title}
      effectiveDate={doc.effectiveDate}
      body={doc.content}
      checkboxLabel={META[current].checkboxLabel}
      busy={busy}
      loading={loading}
      onAccept={onAccept}
    />
  );
};
