// Legal documents (Terms of Service + Privacy Policy) live in the Supabase
// `legal_documents` table so the text can be edited from the Admin panel and
// versioned over time. The hardcoded bodies below are the SHIPPED fallback:
// if the table read ever fails (offline, RLS, cold start) the onboarding flow
// still renders the last-known-good text and never breaks.
//
// When publishing a new version from the Admin panel a fresh row is inserted
// with is_active=true and the previous active row is flipped to is_active=false
// (rows are never deleted — full history is preserved). Acceptance screens read
// the active row's `version`, and the app compares a user's accepted version
// against the active version on launch to force re-acceptance when it changes.

import { supabase } from './supabase';
import type { LegalDocumentType } from './supabase';

export interface LegalDocContent {
  version: string;
  content: string;
  // Display-ready line, e.g. "Effective Date: May 23, 2026".
  effectiveDate: string;
}

// ── Fallback bodies (shipped in the binary) ─────────────────────────────────

const TOS_BODY = `COMPLIANCE CO-PILOT
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
Subscriptions are billed through the app store on your device (Apple App Store or Google Play) and managed in your store account settings. Payments for a billing cycle are non-refundable once charged. If a user cancels a subscription, access will remain active until the end of the current billing cycle and will automatically deactivate at the start of the next cycle.

8. Account Security
Users are responsible for maintaining the confidentiality of their login credentials and for all activity under their account.

9. Changes to the Service
Compliance Co-Pilot may update, modify, suspend, or discontinue parts of the service at any time.

10. Changes to These Terms
Compliance Co-Pilot may update these Terms of Service from time to time. Continued use of the platform after updates means the user accepts the revised terms.

11. Governing Law
These Terms of Service are governed by the laws of the State of Arizona.`;

const PRIVACY_BODY = `COMPLIANCE CO-PILOT
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

export const LEGAL_FALLBACK: Record<LegalDocumentType, LegalDocContent> = {
  tos: {
    version: '1.0',
    content: TOS_BODY,
    effectiveDate: 'Effective Date: May 23, 2026',
  },
  privacy: {
    version: '1.0',
    content: PRIVACY_BODY,
    effectiveDate: 'Effective Date: May 23, 2026',
  },
};

// ── Formatting ──────────────────────────────────────────────────────────────

// Format a Postgres date ('2026-05-23') into the display line the acceptance
// screens show. Parse the parts explicitly so the value isn't shifted by the
// device timezone (a bare `new Date('2026-05-23')` is treated as UTC midnight).
export function formatEffectiveDate(isoDate: string | null): string {
  if (!isoDate) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return `Effective Date: ${isoDate}`;
  const [, year, month, day] = m;
  const d = new Date(Number(year), Number(month) - 1, Number(day));
  const formatted = d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return `Effective Date: ${formatted}`;
}

// ── Reads ─────────────────────────────────────────────────────────────────

// Fetch the active version of a legal document. Falls back to the shipped
// hardcoded text on any error or if no active row exists, so callers can render
// unconditionally without their own try/catch.
export async function fetchActiveLegalDoc(
  type: LegalDocumentType,
): Promise<LegalDocContent> {
  try {
    const { data, error } = await supabase
      .from('legal_documents')
      .select('version, content, effective_date')
      .eq('document_type', type)
      .eq('is_active', true)
      .order('effective_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return LEGAL_FALLBACK[type];
    const row = data as { version: string; content: string; effective_date: string | null };
    if (!row.content) return LEGAL_FALLBACK[type];
    return {
      version: row.version,
      content: row.content,
      effectiveDate: formatEffectiveDate(row.effective_date),
    };
  } catch {
    return LEGAL_FALLBACK[type];
  }
}

// Return the active version string for each document type. Used by the launch
// re-acceptance check. Falls back to the shipped fallback versions on error so
// we never spuriously force re-acceptance because of a transient read failure.
async function fetchActiveVersions(): Promise<Record<LegalDocumentType, string>> {
  try {
    const { data, error } = await supabase
      .from('legal_documents')
      .select('document_type, version, effective_date')
      .eq('is_active', true);
    if (error || !data) throw error ?? new Error('no data');
    const rows = data as Array<{ document_type: LegalDocumentType; version: string }>;
    const versions: Record<LegalDocumentType, string> = {
      tos: LEGAL_FALLBACK.tos.version,
      privacy: LEGAL_FALLBACK.privacy.version,
    };
    for (const r of rows) {
      if (r.document_type === 'tos' || r.document_type === 'privacy') {
        versions[r.document_type] = r.version;
      }
    }
    return versions;
  } catch {
    return {
      tos: LEGAL_FALLBACK.tos.version,
      privacy: LEGAL_FALLBACK.privacy.version,
    };
  }
}

// Determine which legal documents a user must re-accept: the active version of
// a document differs from the version they last accepted. Returns [] on any
// error so a transient failure never traps a user in the re-acceptance flow.
export async function fetchLegalReacceptanceNeeded(
  userId: string,
): Promise<LegalDocumentType[]> {
  try {
    const active = await fetchActiveVersions();

    const [tosRes, privacyRes] = await Promise.all([
      supabase
        .from('tos_acceptances')
        .select('tos_version')
        .eq('user_id', userId)
        .order('accepted_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('privacy_acceptances')
        .select('policy_version')
        .eq('user_id', userId)
        .order('accepted_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    // A read error (not merely "no row") means we can't trust the comparison —
    // skip re-acceptance rather than force it on bad data.
    if (tosRes.error || privacyRes.error) return [];

    const acceptedTos = (tosRes.data as { tos_version: string } | null)?.tos_version ?? null;
    const acceptedPrivacy =
      (privacyRes.data as { policy_version: string } | null)?.policy_version ?? null;

    const needed: LegalDocumentType[] = [];
    // Only force re-acceptance for a user who has accepted before but whose
    // accepted version no longer matches the active one. A user who has never
    // accepted (null) is handled by the normal onboarding flow, not here.
    if (acceptedTos !== null && acceptedTos !== active.tos) needed.push('tos');
    if (acceptedPrivacy !== null && acceptedPrivacy !== active.privacy) {
      needed.push('privacy');
    }
    return needed;
  } catch {
    return [];
  }
}
