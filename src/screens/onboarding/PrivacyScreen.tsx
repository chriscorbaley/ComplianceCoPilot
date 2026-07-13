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
Compliance Co-Pilot LLC | Catalina Foothills, Arizona

1. Introduction
Thank you for choosing Compliance Co-Pilot. Compliance Co-Pilot LLC ("Compliance Co-Pilot," "we," "us," or "our") is committed to protecting your privacy and handling your personal information with transparency and care.

This Privacy Policy describes how we collect, use, store, share, and protect information when you use our mobile application (iOS and Android), web application (Progressive Web App), and related services (collectively, the "Services"). It also describes your rights regarding your information and how to exercise them.

By using the Services, you agree to the practices described in this Privacy Policy. If you do not agree, please discontinue use of the Services immediately.

This Policy applies to all users of Compliance Co-Pilot, including business owners and tax professionals using the platform to track compliance activities.

2. Information We Collect

2.1 Information You Provide Directly
We collect information you provide when you create an account, use the Services, or communicate with us, including:
- Account information: full name, email address, business name, and password
- Voice recordings: audio recordings made through the voice logging feature, which are transcribed and processed by our AI service providers
- Compliance activity data: hours logged, business trip details, meeting notes, real estate activities, expense records, and strategy-related documentation
- Documents: PDFs, images, and other files you upload to the Services
- Meeting minutes: spoken and typed transcripts of business meetings including Augusta Rule, S-Corp board, family management company, and investment strategy reviews
- Business travel records: trip type, destination, dates, day-by-day itineraries, business purpose, expense breakdowns, and AI-calculated deductibility results
- Payment information: processed by our third-party payment processor; we do not store full payment card numbers
- Communications: messages, support inquiries, and feedback you send to us

2.2 Information We Collect Automatically
When you access or use the Services, we and our service providers automatically collect certain technical information:
- Device identifiers: device type, model, operating system version, unique device ID
- Log data: IP address, browser type, access times, and crash reports
- Usage data: screens viewed, features used, session duration, navigation paths
- Authentication tokens: session identifiers for authentication
- Location data: general location inferred from IP address only; the app does not collect precise GPS location

2.3 Information From Third-Party Services
The Services integrate with third-party platforms for authentication, payment processing, voice transcription, and AI analysis.

3. How We Use Your Information

3.1 Providing and Operating the Services
- Authenticating your account and maintaining secure sessions
- Storing and displaying your compliance records, documents, meeting minutes, hours logs, and business trip data
- Processing voice recordings through AI transcription services to generate text
- Classifying compliance activities and generating deductibility analyses using AI language processing
- Applying IRS deductibility rules to your trip and activity data
- Generating and storing meeting minutes documents based on your recordings
- Processing subscription payments through our third-party payment processor

3.2 Improving the Services
- Analyzing usage patterns to improve features and user experience
- Diagnosing and resolving technical issues

3.3 Communications
- Sending transactional messages about your account, subscription, and compliance alerts
- Delivering in-app announcements
- Responding to your support inquiries
- Sending promotional communications with your consent where required by law

3.4 Legal and Security
- Detecting and preventing fraud and unauthorized access
- Complying with applicable laws and legal process
- Enforcing our Terms of Service

4. Third-Party Services and Data Sharing

We share your information with third parties only as described below. We do not sell your personal information.

4.1 Service Providers
We share data with service providers that help us operate the Services, including:
- Cloud database and authentication provider that hosts all compliance records and handles secure authentication
- AI voice transcription service that receives audio for conversion to text
- AI language processing service that receives text for compliance classification and document generation
- Payment processor that handles subscription billing
- Mobile app distribution platforms for app distribution and billing

4.2 Administrators at Your Tax Firm
If your account is administered by a tax firm, designated administrators may access your compliance records and documents through the admin panel.

4.3 Legal Disclosures
We may disclose your information to comply with applicable law, court orders, or government requests.

4.4 Business Transfers
If Compliance Co-Pilot is involved in a merger or sale of assets, your information may be transferred as part of that transaction.

4.5 Aggregated or De-Identified Data
We may share aggregated or de-identified information for analytics or business purposes.

5. Data Storage and Security
Your data is stored on managed cloud database infrastructure in the United States. All data transmitted between your device and our servers is encrypted in transit using TLS. Data at rest is encrypted using industry-standard encryption.

We enforce data isolation controls ensuring your data is accessible only to your authenticated account and authorized administrators.

Despite our security measures, no internet-based system is completely secure. If you become aware of a security breach, please contact us immediately.

6. Voice Recording and AI Processing
When you tap the microphone button:
- Your device records audio using the device microphone
- The audio file is transmitted securely to a third-party AI transcription service
- The resulting text is sent to a third-party AI language model for compliance classification
- The classification result is stored in your account record
- Audio files are not permanently stored after transcription is complete

AI-generated compliance classifications, deductibility verdicts, and meeting minutes are informational tools only and do not constitute legal or tax advice.

7. Data Retention
We retain your personal information for as long as your account is active or as needed to provide the Services:
- Account data and compliance records are retained for the duration of your subscription
- Uploaded documents are retained until you delete them or your account closes
- Voice recordings are not retained after transcription
- Billing records are retained as required by applicable law

8. Children's Privacy
The Services are not directed to children under the age of 13. We do not knowingly collect personal information from children under 13.

9. Your Rights and Choices

9.1 California Residents (CCPA/CPRA)
California residents have the following rights:
- Right to Know: request disclosure of personal information we have collected
- Right to Delete: request deletion of personal information
- Right to Correct: request correction of inaccurate personal information
- Right to Opt-Out: we do not sell your personal information
- Right to Non-Discrimination: we will not discriminate for exercising rights

To exercise these rights contact us at theccpapp@gmail.com. We will respond within 45 days.

9.2 Other U.S. State Privacy Laws
Residents of Colorado, Connecticut, Virginia, Texas, and other states with applicable privacy laws may have similar rights. Contact us at the address in Section 13 to exercise these rights.

9.3 All Users
- You may access your compliance data at any time through the app
- You may delete individual uploaded documents within the app
- To delete your account contact us at theccpapp@gmail.com
- You may opt out of promotional emails via the unsubscribe link
- You may update your account information through app settings

10. Cookies and Tracking Technologies
The web-based version uses cookies to maintain authentication sessions and analyze usage. The mobile app uses secure device storage rather than browser cookies.

We do not use third-party advertising cookies or cross-site tracking for advertising purposes.

11. International Users
The Services are operated in the United States. By using the Services, you consent to transfer and processing of your information in the United States.

12. Changes to This Privacy Policy
We reserve the right to update this Privacy Policy. We will notify you of material changes by updating the effective date and, where appropriate, by in-app notification or email.

13. Contact Us
Compliance Co-Pilot LLC
Tax Strategy Lab
Catalina Foothills, Arizona
Email: theccpapp@gmail.com

For California residents: include "California Privacy Rights Request" in the subject line with your name, email, and description of your request.

DISCLAIMER
Nothing in this Privacy Policy or in the Compliance Co-Pilot application constitutes legal or tax advice. AI-generated compliance classifications, deductibility verdicts, and document templates are informational tools only and do not substitute for the advice of a qualified tax or legal professional. Compliance Co-Pilot LLC is not responsible for tax decisions made in reliance on app outputs.

Compliance Co-Pilot LLC | Privacy Policy
Effective May 23, 2026
Catalina Foothills, Arizona`;

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
