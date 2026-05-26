import React, { useState } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AcceptanceScreen } from './AcceptanceScreen';
import { supabase } from '../../services/supabase';
import { useAuth } from '../../auth/AuthContext';
import type { OnboardingStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'Terms'>;

const TOS_VERSION = '1.0';
const EFFECTIVE_DATE = 'Effective Date: May 23, 2026';

const BODY = `COMPLIANCE CO-PILOT
Terms of Service
Effective Date: May 23, 2026

1. Acceptance of Terms
By creating an account or using Compliance Co-Pilot, you agree to these Terms of Service. You must check the acceptance box below before using the platform.

2. Purpose of the Software
Compliance Co-Pilot is an organizational and documentation tool designed to help users organize records, documents, and related compliance information.

3. No Tax Advice
Compliance Co-Pilot does not provide tax advice, legal advice, accounting advice, or financial advice. Any information or documents generated through the platform are for informational and organizational purposes only.

4. No Guaranteed Results
Compliance Co-Pilot does not guarantee any specific result in an IRS audit, tax dispute, examination, or any other tax-related proceeding.

5. Limitation of Liability
Compliance Co-Pilot and its owners, employees, contractors, and affiliates are not responsible for any tax penalties, interest, audit results, losses, damages, or other outcomes related to the use of the platform. Users accept full responsibility for how they use the software and any information generated through it.

6. User Responsibility
Users are responsible for reviewing and verifying all documents, records, and generated content with a qualified tax professional before relying on any information.

7. Billing and Subscription Terms
Subscriptions are billed monthly through Stripe. Payments for a billing cycle are non-refundable once charged. If a user cancels a subscription, access will remain active until the end of the current billing cycle and will automatically deactivate at the start of the next cycle.

8. Account Security
Users are responsible for maintaining the confidentiality of their login credentials and for all activity under their account.

9. Changes to the Service
Compliance Co-Pilot may update, modify, suspend, or discontinue parts of the service at any time.

10. Changes to These Terms
Compliance Co-Pilot may update these Terms of Service from time to time. Continued use of the platform after updates means the user accepts the revised terms.

11. Governing Law
These Terms of Service are governed by the laws of the State of Arizona.`;

export const TermsScreen: React.FC = () => {
  const nav = useNavigation<Nav>();
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);

  const onAccept = async () => {
    if (!session?.user.id) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from('tos_acceptances')
        .insert({ user_id: session.user.id, tos_version: TOS_VERSION });
      if (error) throw error;
      nav.replace('Privacy');
    } catch (err) {
      Alert.alert('Could not save acceptance', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AcceptanceScreen
      title="Terms of Service"
      effectiveDate={EFFECTIVE_DATE}
      body={BODY}
      checkboxLabel="I have read and agree to the Terms of Service"
      busy={busy}
      onAccept={onAccept}
    />
  );
};
