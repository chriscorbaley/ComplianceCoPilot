import React, { useState } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AcceptanceScreen } from './AcceptanceScreen';
import { supabase } from '../../services/supabase';
import { useAuth } from '../../auth/AuthContext';
import type { OnboardingStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<OnboardingStackParamList, 'Privacy'>;

const POLICY_VERSION = '1.0';
const EFFECTIVE_DATE = 'Effective Date: May 23, 2026';

const BODY = `COMPLIANCE CO-PILOT
Privacy Policy
Effective Date: May 23, 2026

1. Information We Collect
Compliance Co-Pilot collects personal information including your name, email address, billing information, account login credentials, documents you upload, voice recordings you create, and activity you generate within the platform.

2. How Information Is Stored
Your information is stored on secure cloud servers using Supabase, a SOC 2 compliant database and storage provider. All data is encrypted in transit using TLS and encrypted at rest. Document files are stored in private storage buckets accessible only to your account. No other user, including the Compliance Co-Pilot firm administrator, can access your documents.

3. How Information Is Used
Your information is used to provide and maintain the service, process payments, generate compliance documents, improve platform functionality, communicate with you about your account, and provide customer support.

4. AI Model Training
Compliance Co-Pilot does not use your data, uploaded documents, voice recordings, or any user information to train artificial intelligence models. Your data belongs to you.

5. Payment Processing
Payments are processed by Stripe. Compliance Co-Pilot does not store your full payment card information on its servers. All payment processing is handled directly by Stripe in accordance with PCI DSS standards.

6. Sharing of Information
Compliance Co-Pilot does not sell your personal information. Information may be shared only with service providers that help operate the platform, including Stripe for payment processing, Supabase for data storage, and OpenAI for voice transcription and document generation. OpenAI processes your voice input and text prompts but does not retain your data for model training under our API agreement.

7. User Rights and Deletion Requests
You may request access to or deletion of your personal information at any time by contacting us at privacy@compliancecopilot.com. Deletion requests will be processed within 30 days. Upon cancellation of your subscription your documents will be permanently deleted 30 days after your subscription ends.

8. California Privacy Rights (CCPA)
California residents have the following rights under the California Consumer Privacy Act:
- Right to know what personal information is collected
- Right to know whether personal information is sold or disclosed and to whom
- Right to opt out of the sale of personal information
- Right to request deletion of personal information
- Right to non-discrimination for exercising these rights
To exercise these rights contact us at privacy@compliancecopilot.com.

9. Data Retention
Compliance Co-Pilot retains your personal information only as long as necessary to provide services, comply with legal obligations, resolve disputes, and enforce agreements. Document data is deleted 30 days after subscription cancellation.

10. Changes to This Privacy Policy
Compliance Co-Pilot may update this Privacy Policy from time to time. Continued use of the platform after updates means you accept the revised policy.`;

export const PrivacyScreen: React.FC = () => {
  const nav = useNavigation<Nav>();
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);

  const onAccept = async () => {
    if (!session?.user.id) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from('privacy_acceptances')
        .insert({ user_id: session.user.id, policy_version: POLICY_VERSION });
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
      effectiveDate={EFFECTIVE_DATE}
      body={BODY}
      checkboxLabel="I have read and acknowledge the Privacy Policy"
      busy={busy}
      onAccept={onAccept}
    />
  );
};
