import React, { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AcceptanceScreen } from './AcceptanceScreen';
import { supabase } from '../../services/supabase';
import { fetchActiveLegalDoc, LEGAL_FALLBACK, type LegalDocContent } from '../../services/legalDocuments';
import { useAuth } from '../../auth/AuthContext';
import type { OnboardingStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'Privacy'>;

export const PrivacyScreen: React.FC = () => {
  const nav = useNavigation<Nav>();
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  // Seed with the shipped fallback so the screen never renders empty; replaced
  // by the active DB version once the fetch resolves. On fetch failure the
  // service returns the fallback, so onboarding never breaks.
  const [doc, setDoc] = useState<LegalDocContent>(LEGAL_FALLBACK.privacy);

  useEffect(() => {
    let mounted = true;
    fetchActiveLegalDoc('privacy').then((d) => {
      if (mounted) {
        setDoc(d);
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const onAccept = async () => {
    if (!session?.user.id) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from('privacy_acceptances')
        .insert({ user_id: session.user.id, policy_version: doc.version });
      if (error) throw error;
      nav.replace('ChoosePlan');
    } catch (err) {
      Alert.alert('Could not save acceptance', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AcceptanceScreen
      title="Privacy Policy"
      effectiveDate={doc.effectiveDate}
      body={doc.content}
      checkboxLabel="I have read and acknowledge the Privacy Policy"
      busy={busy}
      loading={loading}
      onAccept={onAccept}
    />
  );
};
