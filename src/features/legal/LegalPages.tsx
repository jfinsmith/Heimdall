/**
 * Terms of Service + Privacy Policy — public, unauthenticated pages required
 * before general-population self-signup. Linked from the marketing footer and
 * the registration form. Plain static content; update EFFECTIVE_DATE when the
 * text materially changes.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { WordmarkHorizontal } from '../../brand/Logo';

const EFFECTIVE_DATE = 'November 9, 2026';
const CONTACT = 'support@heimdallscheduling.com';
/** The support address as a clickable mailto link. */
const CONTACT_LINK = (
  <a href={`mailto:${CONTACT}`} className="underline hover:text-watch-900">
    {CONTACT}
  </a>
);

function LegalShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-watch-50">
      <header className="bg-watch-950 px-5 py-4">
        <Link to="/" aria-label="HEIMDALL home" className="inline-block text-watch-50 [&_svg]:text-bifrost-400">
          <WordmarkHorizontal size={24} />
        </Link>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="font-display text-3xl font-bold text-watch-900">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">Effective {EFFECTIVE_DATE}</p>
        <div className="prose-sm mt-6 space-y-5 text-[15px] leading-relaxed text-slate-700 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-watch-900 [&_li]:ml-5 [&_li]:list-disc">
          {children}
        </div>
        <footer className="mt-12 border-t border-watch-100 pt-4 text-xs text-slate-400">
          HEIMDALL Scheduling · <Link to="/terms" className="hover:underline">Terms of Service</Link> ·{' '}
          <Link to="/privacy" className="hover:underline">Privacy Policy</Link> · Questions: {CONTACT_LINK}
        </footer>
      </main>
    </div>
  );
}

export function TermsPage() {
  return (
    <LegalShell title="Terms of Service">
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern access to and use of HEIMDALL Scheduling
        (&ldquo;HEIMDALL,&rdquo; &ldquo;the Service,&rdquo; &ldquo;we&rdquo;) at heimdallscheduling.com. By creating
        an account or using the Service you agree to these Terms. If you use the Service on behalf of an
        organization, you represent that you are authorized to bind that organization.
      </p>

      <h2>1. The Service</h2>
      <p>
        HEIMDALL is scheduling, roster, gradebook, and records software for training academies. Features include
        class scheduling, instructor sign-ups, attendance and academic record-keeping, document generation, and
        related notifications. The Service is provided on a subscription basis to organizations
        (&ldquo;Organizations&rdquo;); individual accounts belong to and are administered within an Organization.
      </p>

      <h2>2. Accounts</h2>
      <ul>
        <li>You must provide accurate information and keep your credentials confidential. You are responsible for activity under your account.</li>
        <li>Accounts not linked to an Organization within 30 days of creation are automatically deleted.</li>
        <li>Organization administrators control membership, roles, and access within their Organization, including suspending or removing accounts.</li>
        <li>We may suspend or terminate accounts that violate these Terms or threaten the security or integrity of the Service.</li>
      </ul>

      <h2>3. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>access another Organization&apos;s data or attempt to bypass access controls;</li>
        <li>use the Service to store data you are not authorized to store, or upload unlawful, infringing, or malicious content;</li>
        <li>probe, disrupt, overload, or reverse-engineer the Service;</li>
        <li>resell or sublicense the Service without our written agreement.</li>
      </ul>

      <h2>4. Your data</h2>
      <p>
        Organizations own the records they enter (schedules, rosters, grades, documents). We process that data
        solely to provide the Service, as described in the{' '}
        <Link to="/privacy" className="text-bifrost-700 underline">Privacy Policy</Link>. Each Organization&apos;s
        records are logically isolated from every other Organization&apos;s. Organization administrators are
        responsible for the accuracy of the records they keep and for their own regulatory obligations (including
        records-retention rules that apply to training academies). An Organization whose administrator accepts the
        Data Processing Agreement presented in the Service (Admin → Compliance &amp; Data) is also covered by that
        agreement for the handling of its records.
      </p>

      <h2>5. Subscriptions &amp; billing</h2>
      <ul>
        <li>Paid plans are billed per Organization at the flat monthly rate published at heimdallscheduling.com/pricing, via our payment processor (Stripe). Taxes may apply.</li>
        <li>Organizations we have designated in writing as complimentary are not billed and are not subject to payment-related restrictions.</li>
        <li>Subscriptions renew monthly until cancelled. Cancellation stops future charges; access continues through the paid period.</li>
        <li>Missed payments may restrict creation of new classes after a grace period. Existing records remain accessible for export.</li>
      </ul>

      <h2>6. Availability &amp; changes</h2>
      <p>
        We aim for high availability but the Service is provided <strong>&ldquo;as is&rdquo; and &ldquo;as
        available,&rdquo;</strong> without warranties of any kind, express or implied. We may modify features with
        reasonable notice for material changes. Scheduled output (calendars, printouts, notifications) supports —
        but does not replace — an Organization&apos;s own official processes and judgment.
      </p>

      <h2>7. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, HEIMDALL and its operators are not liable for indirect, incidental,
        special, consequential, or punitive damages, or for lost profits, data, or goodwill. Our total liability for
        any claim relating to the Service is limited to the amounts paid by your Organization for the Service in the
        three (3) months preceding the claim.
      </p>

      <h2>8. Termination</h2>
      <p>
        Organizations may cancel at any time. Upon termination we will, on request within 30 days, provide an export
        of the Organization&apos;s records in a common format, after which data may be deleted from production
        systems.
      </p>

      <h2>9. General</h2>
      <p>
        These Terms are governed by the laws of the State of Florida, without regard to conflict-of-laws rules. If a
        provision is unenforceable, the remainder stays in effect. We may update these Terms; material changes will
        be announced in the Service, and continued use after the effective date constitutes acceptance. Questions:{' '}
        {CONTACT_LINK}.
      </p>
    </LegalShell>
  );
}

export function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy">
      <p>
        This Privacy Policy explains what HEIMDALL Scheduling (&ldquo;HEIMDALL,&rdquo; &ldquo;we&rdquo;) collects,
        how it is used, and the choices you have. HEIMDALL is used by training-academy Organizations; much of the
        data in the Service is entered and controlled by your Organization, which acts as the data controller for
        its records. HEIMDALL processes those records on the Organization&apos;s behalf.
      </p>

      <h2>1. What we collect</h2>
      <ul>
        <li><strong>Account information:</strong> name, email address, date of birth (your academy uses it to verify training credentials against state records), phone (optional), rank and agency, sign-in provider identifiers, the instructor qualifications you claim and their expiration dates, an optional separate address for notifications, and — if you claim a First Aid / CPR qualification — a photo of your certification card.</li>
        <li><strong>Organization records:</strong> schedules and room reservations; instructor sign-ups and assignments; cadet rosters (name, date of birth, contact details, emergency contact, and an optional student or training-record number); attendance, grades, and disciplinary notes; return-to-training tracking, which can include injury dates, follow-up dates, and work restrictions entered by staff; and documents your Organization&apos;s staff generate or file.</li>
        <li><strong>Usage &amp; technical data:</strong> information needed to operate and secure the Service — authentication events, error information, and the page context and any screenshots you attach to a problem report.</li>
        <li><strong>Browser storage:</strong> the Service keeps your sign-in state and a few display preferences in your browser. We do not use advertising cookies or third-party analytics trackers.</li>
        <li><strong>We do not collect Social Security Numbers.</strong> The Service is designed so SSNs are never stored. Payment-card details are handled by our payment processor and never reach HEIMDALL.</li>
      </ul>

      <h2>2. How we use it</h2>
      <ul>
        <li>To provide the Service: scheduling, rosters, records, printouts, and the notifications you or your Organization enable, which are sent by email and shown in the Service.</li>
        <li>To secure the Service: authentication, abuse prevention, and audit logging of administrative actions.</li>
        <li>To support you: responding to problem reports and requests you submit.</li>
        <li>We do <strong>not</strong> sell personal information, and we do not use Organization records for advertising.</li>
      </ul>

      <h2>3. Who can see your data</h2>
      <ul>
        <li>Members of your Organization, according to their role (for example, staff can see rosters; instructors see published schedules and their own assignments).</li>
        <li>Each Organization&apos;s records are logically isolated — one Organization cannot access another&apos;s data.</li>
        <li>HEIMDALL&apos;s operator may access an Organization&apos;s data only as needed to provide support the Organization requests, to maintain and secure the Service, or to comply with law.</li>
        <li>Optional public class links, if a coordinator creates one, show that class&apos;s schedule (including any session notes staff entered) to anyone with the link and its access code. If the coordinator also sets a separate password, the link additionally shows a read-only gradebook and discipline tally listed by cadet name. Public links never show contact information, dates of birth, or identification numbers, and a coordinator can disable or regenerate a link at any time.</li>
        <li>A personal calendar-feed link, if you create one, shows your own teaching assignments to anyone who has that link. Treat it like a password.</li>
      </ul>

      <h2>4. Service providers</h2>
      <p>
        We use the following processors to run the Service, and each receives only what it needs to perform its
        function: Google Cloud / Firebase (hosting, database, authentication, file storage, and server functions),
        Resend (email delivery), Stripe (subscription billing), and Cloudflare (domain name service, and routing of
        email sent to our support address to a Google-hosted mailbox). If you choose to sign in with Google or Microsoft, that provider
        authenticates you and shares your name and email address with us.
      </p>

      <h2>5. Where data lives &amp; how long</h2>
      <ul>
        <li>Data is hosted in the United States, in Google Cloud&apos;s <em>us-east1</em> region.</li>
        <li>Accounts never linked to an Organization are deleted automatically after 30 days; we email a warning about a week beforehand.</li>
        <li>Copies of the email the Service sends are deleted after 30 days.</li>
        <li>Organization records are kept for as long as the Organization uses the Service, or until its staff delete them. When an Organization leaves, its records are exportable on request for 30 days and are then deleted from production systems.</li>
        <li>An Organization&apos;s top administrator may ask us in writing to delete all of the Organization&apos;s data; we complete that within 30 days.</li>
      </ul>

      <h2>6. Security</h2>
      <p>
        Data is encrypted in transit and at rest by the underlying cloud platform. Access is controlled by
        per-Organization isolation enforced at the database layer, role-based permissions, server-validated
        administrative actions, and audit logging. No system is perfectly secure; report suspected issues to{' '}
        {CONTACT_LINK} and we will investigate promptly. If we confirm a security breach affecting an
        Organization&apos;s data, we notify that Organization&apos;s administrators without undue delay and no later
        than 72 hours after confirming it.
      </p>

      <h2>7. Your choices</h2>
      <ul>
        <li>You can edit your profile information and notification preferences in the Service.</li>
        <li>You can turn off non-essential email categories in your profile. Time-critical messages — such as schedule changes, reservation requests, and account notices — cannot be turned off individually.</li>
        <li>For access, correction, or deletion of records your Organization controls — including your account within that Organization — contact your Organization&apos;s administrators. For anything else, contact {CONTACT_LINK}.</li>
      </ul>

      <h2>8. Children</h2>
      <p>
        The Service is for academy staff, instructors, and adult recruits. It is not directed to children under 13,
        and we do not knowingly collect their information.
      </p>

      <h2>9. Changes &amp; contact</h2>
      <p>
        We will announce material changes to this policy in the Service and update the effective date above.
        Questions or requests: {CONTACT_LINK}.
      </p>
    </LegalShell>
  );
}
