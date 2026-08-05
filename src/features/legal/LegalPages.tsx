/**
 * Terms of Service + Privacy Policy — public, unauthenticated pages required
 * before general-population self-signup. Linked from the marketing footer and
 * the registration form. Plain static content; update EFFECTIVE_DATE when the
 * text materially changes.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { WordmarkHorizontal } from '../../brand/Logo';

const EFFECTIVE_DATE = 'August 5, 2026';
const CONTACT = 'support@heimdallscheduling.com';

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
          <Link to="/privacy" className="hover:underline">Privacy Policy</Link> · Questions: {CONTACT}
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
        records-retention rules that apply to training academies).
      </p>

      <h2>5. Subscriptions &amp; billing</h2>
      <ul>
        <li>Paid plans are billed per Organization at the published flat monthly rate, via our payment processor (Stripe). Taxes may apply.</li>
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
        {CONTACT}.
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
        its records.
      </p>

      <h2>1. What we collect</h2>
      <ul>
        <li><strong>Account information:</strong> name, email address, phone (optional), rank/agency, sign-in provider identifiers, and qualification claims you make.</li>
        <li><strong>Organization records:</strong> schedules, sign-ups, rosters, attendance, grades, disciplinary notes, and documents entered by your Organization&apos;s staff.</li>
        <li><strong>Usage &amp; technical data:</strong> log and device information needed to operate and secure the Service (e.g. authentication events, error reports, and page context attached to bug reports you submit).</li>
        <li><strong>We do not collect Social Security Numbers.</strong> The Service is designed so SSNs are never stored.</li>
      </ul>

      <h2>2. How we use it</h2>
      <ul>
        <li>To provide the Service: scheduling, rosters, records, printouts, and the notifications you or your Organization enable (email today; optional SMS reminders if offered and opted into).</li>
        <li>To secure the Service: authentication, abuse prevention, audit logging of administrative actions.</li>
        <li>To support you: responding to bug reports and requests you submit.</li>
        <li>We do <strong>not</strong> sell personal information, and we do not use Organization records for advertising.</li>
      </ul>

      <h2>3. Who can see your data</h2>
      <ul>
        <li>Members of your Organization, according to their role (e.g. staff can see rosters; instructors see schedules and their own assignments).</li>
        <li>Each Organization&apos;s records are logically isolated — one Organization can never access another&apos;s data.</li>
        <li>Optional public class links, if a coordinator creates one, expose a limited, sanitized schedule (and, behind a separate password, a read-only gradebook) — never contact information, dates of birth, or identification numbers.</li>
      </ul>

      <h2>4. Service providers</h2>
      <p>
        We use vetted processors to run the Service: Google Firebase (hosting, database, authentication), Stripe
        (billing), Resend (email delivery), and — if SMS is enabled — Twilio (text messages). Each receives only
        what it needs to perform its function.
      </p>

      <h2>5. Where data lives &amp; how long</h2>
      <ul>
        <li>Data is hosted in the United States.</li>
        <li>Accounts never linked to an Organization are deleted automatically after 30 days.</li>
        <li>Organization records are retained while the Organization subscribes; on termination, records are exportable on request and then deleted from production systems.</li>
      </ul>

      <h2>6. Security</h2>
      <p>
        Access is controlled by per-Organization isolation enforced at the database layer, role-based permissions,
        server-validated administrative actions, and audit logging. No system is perfectly secure; report suspected
        issues to {CONTACT} and we will investigate promptly.
      </p>

      <h2>7. Your choices</h2>
      <ul>
        <li>You can edit your profile information and notification preferences in the Service.</li>
        <li>You can unsubscribe from non-essential email categories; essential account and security messages are always delivered.</li>
        <li>For access, correction, or deletion of records your Organization controls, contact your Organization&apos;s administrators; for account-level requests, contact {CONTACT}.</li>
      </ul>

      <h2>8. Changes &amp; contact</h2>
      <p>
        We will announce material changes to this policy in the Service. Questions or requests: {CONTACT}.
      </p>
    </LegalShell>
  );
}
