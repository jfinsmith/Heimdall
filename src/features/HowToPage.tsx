/**
 * How To — the in-app user guide. One comprehensive page, organized by role and
 * workflow, with an anchor-linked table of contents. Content documents the REAL
 * product flows (kept in sync as features ship) — when a feature changes, update
 * its section here in the same change.
 */
import React from 'react';
import { PageHeader } from '../components/ui';

/** Grouped table of contents — ids must match the Section ids below. */
const TOC: { group: string; items: { id: string; title: string }[] }[] = [
  {
    group: 'Getting started',
    items: [
      { id: 'account', title: 'Your account & first sign-in' },
      { id: 'profile', title: 'Profile, qualifications & availability' },
    ],
  },
  {
    group: 'For instructors',
    items: [
      { id: 'signups', title: 'Finding & signing up for sessions' },
      { id: 'my-schedule', title: 'My Schedule, reminders & calendar feed' },
    ],
  },
  {
    group: 'Building & staffing a class',
    items: [
      { id: 'academies', title: 'Creating academies (templates & clones)' },
      { id: 'approval', title: 'The approval & publishing workflow' },
      { id: 'builder', title: 'Building the schedule (calendar)' },
      { id: 'staffing', title: 'Staffing: slots, reserves & sign-ups' },
      { id: 'rooms', title: 'Room reservations' },
    ],
  },
  {
    group: 'Cadet records',
    items: [
      { id: 'roster', title: 'Roster: intake, import & lifecycle' },
      { id: 'attendance', title: 'Attendance rosters & the attendance log' },
      { id: 'gradebook', title: 'Gradebook & FDLE exam rules' },
      { id: 'discipline', title: 'Discipline tracker' },
      { id: 'remediation', title: 'Remediation & Returns (returning cadets)' },
      { id: 'documents', title: 'Documents, letters & reports' },
      { id: 'printing', title: 'Printing guide' },
    ],
  },
  {
    group: 'Administration',
    items: [
      { id: 'users', title: 'Users, roles & suspension' },
      { id: 'curriculum', title: 'Curriculum & Hours (per-discipline setup)' },
      { id: 'org-settings', title: 'Org settings, branding & emails' },
      { id: 'billing', title: 'Billing & subscription' },
    ],
  },
  {
    group: 'Help',
    items: [{ id: 'troubleshooting', title: 'Troubleshooting & support' }],
  },
];

const ROLE_TONES: Record<string, string> = {
  Everyone: 'bg-green-50 text-green-800',
  Instructors: 'bg-sky-50 text-sky-700',
  Staff: 'bg-amber-50 text-amber-800',
  Admins: 'bg-red-50 text-red-700',
};

function Section({ id, title, role, children }: { id: string; title: string; role: keyof typeof ROLE_TONES; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-watch-100 pt-6">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-watch-900">{title}</h2>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${ROLE_TONES[role]}`}>{role}</span>
        <a href="#contents" className="ml-auto text-xs text-bifrost-700 hover:underline">↑ Contents</a>
      </div>
      <div className="space-y-3 text-sm leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

function Sub({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 mt-4 text-sm font-semibold text-watch-800">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

const Steps = ({ items }: { items: React.ReactNode[] }) => (
  <ol className="list-decimal space-y-1 pl-5">{items.map((s, i) => <li key={i}>{s}</li>)}</ol>
);
const Tips = ({ items }: { items: React.ReactNode[] }) => (
  <ul className="list-disc space-y-1 pl-5">{items.map((s, i) => <li key={i}>{s}</li>)}</ul>
);
const B = ({ children }: { children: React.ReactNode }) => <strong className="font-semibold text-watch-900">{children}</strong>;

export function HowToPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader kicker="Guide" title="How To — HEIMDALL User Guide" />
      <p className="mb-4 text-sm text-slate-600">
        Everything in one place, organized by role. Use the contents below to jump to a topic — each section links back here.
        Role tags show who each section applies to; admins can do everything staff can, and staff can do everything instructors can.
      </p>

      {/* ── Table of contents ─────────────────────────────────────────────── */}
      <nav id="contents" aria-label="Table of contents" className="scroll-mt-24 rounded-lg border border-watch-100 bg-watch-50/60 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-watch-600">Contents</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {TOC.map((g) => (
            <div key={g.group}>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.group}</div>
              <ul className="space-y-1">
                {g.items.map((i) => (
                  <li key={i.id}>
                    <a href={`#${i.id}`} className="text-sm text-bifrost-700 hover:underline">{i.title}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <div className="mt-6 space-y-8">
        {/* ── Getting started ─────────────────────────────────────────────── */}
        <Section id="account" title="Your account & first sign-in" role="Everyone">
          <Steps items={[
            <>An administrator creates your account. You receive an <B>activation email</B> with a temporary password.</>,
            <>Sign in at your academy&apos;s HEIMDALL address with that temporary password — you&apos;ll be required to <B>set a new password</B> immediately.</>,
            <>Complete the <B>welcome profile</B> (name, rank, phone) and claim any instructor qualifications you hold (an admin verifies them before they count).</>,
          ]} />
          <Tips items={[
            <>Forgot your password? Use <B>Reset password</B> on the sign-in page — a reset email is sent to your account address.</>,
            <>If your account was created but you never got the email, ask an admin to re-send the activation from <B>Admin → Users &amp; Roles</B>.</>,
          ]} />
        </Section>

        <Section id="profile" title="Profile, qualifications & availability" role="Everyone">
          <Sub title="Qualifications & instructor certification">
            <p>
              Open <B>Profile</B> to claim qualifications (General Instructor, Handgun, Defensive Tactics, Vehicle Ops, First Aid, Role Player…).
              Claims start unverified — an admin verifies them under <B>Admin → Users &amp; Roles</B>. All FDLE instructor certs share one
              <B> certification expiration date</B> on your profile; when it lapses, you can&apos;t be reserved or sign up for qualified slots until it&apos;s renewed.
              Removing a qualification takes effect immediately (re-verification is required to get it back).
            </p>
          </Sub>
          <Sub title="Unavailable days">
            <p>
              Mark days you can&apos;t teach under <B>Profile → Unavailable days</B>. Browse Open Sessions hides sessions on those days by default
              (a toggle shows them again). This is advisory — it never blocks staff from reserving you, so tell your coordinator too.
            </p>
          </Sub>
          <Sub title="Curriculum notifications">
            <p>
              You&apos;re subscribed to every discipline&apos;s course-opening call-outs by default. Under <B>Profile → Curriculum notifications</B>,
              un-check any discipline (e.g. Corrections, if you only teach Law Enforcement) to silence its announcements across bell and email.
              Your own assignments, reminders, and account notices always come through regardless.
            </p>
          </Sub>
        </Section>

        {/* ── Instructors ────────────────────────────────────────────────── */}
        <Section id="signups" title="Finding & signing up for sessions" role="Instructors">
          <Steps items={[
            <>Open <B>Browse Open Sessions</B>. Sessions are grouped by day (Today/Tomorrow called out); flip to the <B>Calendar</B> view for a month at a glance, colored by academy — your choice is remembered. Filter by academy or show your unavailable days.</>,
            <>Pick a session and <B>Sign up</B> for an open slot. Slots that require a qualification you don&apos;t hold (verified + unexpired) are blocked.</>,
            <>If the slot is full, you can <B>join the waitlist</B> — when someone withdraws you&apos;re promoted automatically (re-checked for conflicts and certification at that moment) and notified.</>,
            <>Withdraw from a session from the session detail or <B>My Schedule</B>. Lead-instructor withdrawals alert command.</>,
          ]} />
          <Tips items={[
            <>Sign-ups only open when the coordinator opens the course — <B>Scheduled</B> means visible but not yet open.</>,
            <>Double-booking is blocked: you can&apos;t sign up for a session that overlaps one you already hold.</>,
          ]} />
        </Section>

        <Section id="my-schedule" title="My Schedule, reminders & calendar feed" role="Instructors">
          <p>
            <B>My Schedule</B> lists your upcoming and past assignments. Email reminders arrive before each assignment — set your preferred
            lead time in <B>Profile → Notifications</B> (your org sets the default). The <B>calendar feed (ICS)</B> link on My Schedule
            subscribes your phone/Outlook/Google calendar to your assignments so they stay in sync automatically.
          </p>
          <p>
            The <B>Gjallarhorn bell</B> (top right) shows your latest notifications with category colors and timestamps — clicking View
            marks one read and takes you to the source. <B>View all notifications</B> opens the full feed, grouped by day and filterable
            by category or unread state, with one-click mark-all-read.
          </p>
        </Section>

        {/* ── Building & staffing ────────────────────────────────────────── */}
        <Section id="academies" title="Creating academies (templates & clones)" role="Staff">
          <Sub title="From a quarterly template">
            <Steps items={[
              <>Go to <B>CADRE → Academies</B>. Templates are grouped by discipline (Jan/Apr/Jul/Oct starts).</>,
              <>Pick a template → <B>Use template</B> → set the class name, short name (e.g. &quot;LE 133&quot;), start date, and default room. Every session shifts to the new dates automatically.</>,
              <>The clone lands as a <B>draft</B> — staffing does not copy, the FDLE sequence number is intentionally blank (it&apos;s per-cohort), and approval resets.</>,
            ]} />
          </Sub>
          <Sub title="Cloning a past class">
            <p>Cloning an existing academy works the same way. After the copy, HEIMDALL flags any cloned session whose <B>room is already booked</B> by another class, and any that landed on holidays — fix those days in the builder.</p>
          </Sub>
          <Tips items={[
            <>Deleting an academy requires typing <B>DELETE</B> — it removes the class and its sessions permanently.</>,
            <>The Academies list shows live cadet headcounts per class.</>,
          ]} />
          <Sub title="Public class link">
            <p>
              In the builder, the <B>Public class link</B> panel creates a view-only link for cadets and other
              interested parties. The link opens behind a simple access code — the digits of the class (LE 132 → <B>132</B>) —
              and shows the printable training schedule. Optionally set an <B>academic password</B> to enable an
              &quot;Academic information&quot; section with the read-only gradebook and discipline (only cadets with actual
              entries are listed). Everything is read-only, the link can be regenerated or disabled anytime, and no
              contact info, IDs, or dates of birth are ever exposed.
            </p>
          </Sub>
        </Section>

        <Section id="approval" title="The approval & publishing workflow" role="Staff">
          <Steps items={[
            <>Build the schedule as a <B>draft</B> — drafts are invisible to instructors.</>,
            <>From the builder, <B>Submit for approval</B> and pick the reviewing sergeant.</>,
            <>The chain runs sergeant → lieutenant → captain; each approver gets a notification and an entry in their <B>Overview → Pending your approval</B> queue. Command may fast-track past the sergeant step. Lieutenant and Director are equal ranks — either can clear the command stages.</>,
            <>Once approved, <B>Publish</B> makes the calendar visible. Publishing is hard-gated: an unapproved academy cannot be published, and course sign-ups stay closed until you open each course (see Staffing).</>,
          ]} />
        </Section>

        <Section id="builder" title="Building the schedule (calendar)" role="Staff">
          <Sub title="Creating sessions">
            <Steps items={[
              <>Open the academy → the calendar. Click/drag a time range to create a session; drag or resize existing blocks to move them (room conflicts block the move).</>,
              <>Picking a <B>course from the curriculum</B> auto-fills hours, default role slots, and the lead-qualification requirement. A <B>custom block</B> (PSO assignment, formation, study hall…) never counts toward FDLE program hours.</>,
              <>Set the <B>lunch break</B> (minutes + start). Lunch is carved out of instructional hours unless you explicitly check <B>lunch counts toward hours</B> — that&apos;s rare/case-by-case and shows a warning.</>,
              <>Pick a <B>room</B> — the location auto-fills from the room&apos;s location and locks (choose Custom room to type a free-text room/location). Use <B>+ Add room</B> for scenario days needing several rooms; every room is conflict-checked.</>,
            ]} />
          </Sub>
          <Sub title="Recurring blocks & coverage">
            <Tips items={[
              <>The <B>recurring generator</B> lays down a repeating block across a date range and hard-blocks days whose room is already booked.</>,
              <>The <B>Curriculum coverage</B> panel tracks scheduled hours vs each course&apos;s FDLE minimum; each calendar block also shows a running tally (e.g. <B>6/12 hrs</B>) as you schedule a course across multiple days.</>,
              <>Blocks named/noted <B>Test</B>, <B>Scenario</B>, or <B>PT</B> highlight red/green/yellow on calendars and printouts.</>,
              <>Holidays your org observes shade the calendar; a dismissible warning lists sessions that land on them.</>,
            ]} />
          </Sub>
        </Section>

        <Section id="staffing" title="Staffing: slots, reserves & sign-ups" role="Staff">
          <Sub title="Role slots & reserving instructors">
            <p>
              Each session carries role slots (lead, assistant, role player, coordinator) with counts and optional qualification requirements.
              You can <B>reserve</B> specific instructors into slots from the session editor — the picker excludes expired certifications and
              warns on double-bookings. Coordinator slots are pre-assigned (no open registration). An advisory badge shows when a
              high-liability day is below its FDLE instructor ratio.
            </p>
          </Sub>
          <Sub title="After the day has passed — record who taught">
            <p>
              Once a session&apos;s day is over it is <B>finalized</B>: times, course, and rooms lock, and sign-ups close.
              Clicking the session now opens <B>Record who taught</B> — remove a no-show, add the instructor who stepped
              in, or add a <B>write-in</B> for someone without an account. Corrections update the instructor&apos;s own
              records, print on the attendance and sign-in rosters, and are audit-logged — so the record matches what
              actually happened (ATMS). A past session with <B>no lead recorded</B> shows a red dashed ring on the
              calendar until someone records who taught it.
            </p>
          </Sub>
          <Sub title="Opening sign-ups">
            <Steps items={[
              <>After publishing, open each course for sign-ups from the builder&apos;s course panel — choose which instructor groups get the announcement email.</>,
              <>Track fill status on the <B>Staffing Board</B>; understaffed sessions inside your alert window trigger daily coordinator alerts and command escalation.</>,
              <>A weekly staffing digest email goes to staff each Monday (configurable under Admin → Gjallarhorn).</>,
            ]} />
          </Sub>
        </Section>

        <Section id="rooms" title="Room reservations" role="Staff">
          <Tips items={[
            <><B>CADRE → Room Reservations</B> manages locations (College, Range…) and their rooms (capacity, color, floor-plan image). Locations can be renamed anytime.</>,
            <>Bookings are automatic: assigning a room to a session reserves it. Conflicts are <B>hard-blocked</B> everywhere (create, edit, drag, duplicate, recurring, multi-room).</>,
            <>Use <B>+ Reservation</B> for ad-hoc holds (maintenance, outside groups) — they block the calendar like classes and show with a 🔒.</>,
            <>The booking calendar shows every room a session holds; filter by location or room. Capacity warnings appear when a class exceeds a room&apos;s seats.</>,
          ]} />
        </Section>

        {/* ── Cadet records ──────────────────────────────────────────────── */}
        <Section id="roster" title="Roster: intake, import & lifecycle" role="Staff">
          <Sub title="Adding cadets">
            <Steps items={[
              <>Open the academy → <B>Roster</B>. Use <B>+ Add member</B> for the guided intake (name, agency, CJIS, student ID, date of birth, contacts, emergency contact) — roster numbers assign automatically.</>,
              <>Use <B>Bulk import</B> to paste or upload a CSV (Name, Agency, CJIS, Student ID, DOB, Email, Phone — header order-tolerant). Rows are validated and previewed first; invalid rows are skipped with reasons.</>,
              <>Names display <B>Last, First</B> and every roster list sorts alphabetically by last name — a new cadet slots straight into place, and withdrawn/dismissed cadets fall to the bottom.</>,
              <>Mark <B>block takers</B> for people taking only specific blocks — they print in the separate Additional Course Takers section, not the main roster.</>,
            ]} />
          </Sub>
          <Sub title="Cadet lifecycle">
            <Tips items={[
              <><B>Withdraw</B> keeps the record (struck through, grades to the withdrawal point); <B>Reinstate</B> restores it. <B>Remove</B> deletes entirely — prefer withdrawing.</>,
              <><B>Graduate</B> marks completion and unlocks the org-branded <B>Certificate of Completion</B>; it warns about unresolved course failures but never blocks — the record is yours.</>,
              <><B>Dismiss</B> records a reason and excludes the cadet from future sign-in sheets.</>,
              <>The <B>Certificate</B> link on each row opens the printable certificate (graduated cadets) + course-by-course transcript.</>,
              <><B>⬇ Export records</B> downloads the full class as CSV: identity, outcome, class standing, attended hours, per-course results.</>,
            ]} />
          </Sub>
        </Section>

        <Section id="attendance" title="Attendance rosters & the attendance log" role="Staff">
          <Sub title="Printable attendance rosters (the official paper record)">
            <Tips items={[
              <><B>Manual</B> — pick the course and fill the header fields yourself, then print.</>,
              <><B>From schedule</B> — pick a date and HEIMDALL builds one roster per course block from the calendar: times, hours (lunch handled per the session&apos;s setting), lead + additional instructors from sign-ups. Tweak anything before printing.</>,
              <><B>Blank</B> — prints the class info (header, sequence #, class #, total hours, program dates) and the student list, with course/date/times/instructors left as empty boxes and <B>5 write-in rows</B> for additional course takers.</>,
              <>Rosters auto-shrink to fit <B>one page</B> (down to a readable floor). Instructor and Coordinator signature lines print side by side.</>,
            ]} />
          </Sub>
          <Sub title="Digital attendance log (optional)">
            <p>
              The <B>Attendance Log</B> tab records per-day status (present, excused, unexcused, tardy, makeup) and credited hours per cadet.
              It&apos;s voluntary — paper remains the legal record — but filled in, it powers the attended-hours column in the records export.
            </p>
          </Sub>
        </Section>

        <Section id="gradebook" title="Gradebook & FDLE exam rules" role="Staff">
          <Sub title="Entering grades">
            <Steps items={[
              <>Mark courses as <B>Test</B> in Admin → Curriculum &amp; Hours to make them gradable — they become columns in the Gradebook tab.</>,
              <>Click a cell to enter the end-of-course score (pass line is <B>80%</B>), or set N/A (injured), CO (carry-over), or XO (crossover-exempt).</>,
            ]} />
          </Sub>
          <Sub title="Failures, re-exams & lifelines (built to Rule 11B-35, F.A.C.)">
            <Tips items={[
              <>A failed non-high-liability exam is <B>pending</B> until resolved: enter the <B>one</B> permitted re-exam (a passing re-exam records as 80), or check <B>not eligible</B> if the cadet already used their program re-exam — the editor flags which course used it.</>,
              <>High-liability courses get <B>one lifeline</B>: a written re-exam <B>or</B> a practical remediation, never both. A lifeline that&apos;s been elected but not yet completed stays pending — it never auto-fails.</>,
              <>A <B>red ring</B> on a cell means the lifeline/re-exam was used — a re-exam pass (capped at 80) is visibly distinct from a clean pass.</>,
              <>The ⚠ beside a cadet summarizes standing (a second failure means dismissal); <B>✉ Letter</B> jumps to the Reports tab with the cadet, failed course, and score pre-filled — you still pick the letter.</>,
            ]} />
          </Sub>
        </Section>

        <Section id="discipline" title="Discipline tracker" role="Staff">
          <p>
            The <B>Discipline</B> tab tallies warnings and demerits per cadet: A=1, B=3, C=6, D=12 points; <B>12 points is automatic
            dismissal</B> (a D alone triggers it). Note violations with type, level, date, and notes; the history shows as chips.
            At the dismissal threshold a <B>✉ Letter</B> shortcut appears for the dismissal paperwork.
          </p>
        </Section>

        <Section id="remediation" title="Remediation & Returns (returning cadets)" role="Staff">
          <Tips items={[
            <><B>Cadre → Remediation</B> tracks cadets who left a class incomplete — a <B>block failure</B>, an <B>injury</B>, or a <B>crossover</B> between disciplines — and must attend a later class to finish. Coordinators and above only; instructors cannot see this module at all.</>,
            <>Adding a cadet: pick their original class to load its roster, or type the name for classes that predate HEIMDALL. Blocks still owed are picked <B>from that class&apos;s curriculum</B> (hours ride along from the FDLE minimums; a Custom option covers anything else). Choosing <B>Crossover</B> auto-fills the blocks from the FDLE crossover program for the chosen direction (CO → LE, or the rare LE → CO). Set the <B>return class</B> once they&apos;re placed (the status flips to &quot;Return scheduled&quot; automatically).</>,
            <>Blocks show as <B>pills</B> in the list — red ▲ for high-liability, and <B>clicking a pill checks it off</B> (green ✓) as the cadet completes it. <B>Resolve</B> asks how the case ended — <B>Returned to full duty</B>, <B>Resigned</B>, or <B>Transferred</B> — then archives it with the outcome on the row.</>,
            <>For injuries, record the <B>date injured</B>, the <B>next workers&apos;-comp follow-up</B>, the <B>restrictions</B> given, and the <B>return date</B>. An overdue follow-up flags red in the list — until a return date is set, which clears it.</>,
            <>If the sponsoring agency has them working elsewhere in the meantime, check <B>Currently assigned within the agency</B> and record where, since when, and their immediate supervisor. A free-form notes field covers everything else at a glance.</>,
            <>Done with a case? <B>Resolve</B> archives it — out of the working list (under the <B>Archived</B> filter), no more follow-up flags, restorable any time. <B>Delete</B> (on archived rows, or inside Edit) permanently removes a case that shouldn&apos;t have been tracked.</>,
          ]} />
        </Section>

        <Section id="documents" title="Documents, letters & reports" role="Staff">
          <Sub title="The Reports tab">
            <Tips items={[
              <>Each academy&apos;s <B>Reports</B> tab offers the document library: the four FDLE academic-action letters (exam failure, re-exam failure, proficiency failure, dismissal — with verified F.A.C. citations) plus conduct/general documents (counseling, incident, injury/illness, training use-of-force, disciplinary action, conduct dismissal, acknowledgment, crossover transfer memo, general memo).</>,
              <>Forms pre-fill what HEIMDALL already knows (cadet, class designation, program dates, failed course/score from the gradebook). Filed reports are saved per academy and reprintable/editable.</>,
              <>The <B>crossover/blackbird memo</B> starts with a class → cadet picker: choose the cadet&apos;s <B>original</B> class and the To line fills with its Sequence No.; choose the cadet and the Re line fills — the From line defaults to the class you&apos;re writing from.</>,
              <>The conduct-dismissal notice requires concrete <B>appeal authority and deadline</B> at issue time.</>,
              <>Printed documents carry your <B>organization&apos;s letterhead</B> (logo, name, address) — configure it under Admin → Settings and per-discipline overrides in Curriculum &amp; Hours.</>,
            ]} />
          </Sub>
        </Section>

        <Section id="printing" title="Printing guide" role="Staff">
          <Tips items={[
            <><B>Cadet & staffing schedules</B> — builder → Print: a branded cover, week-at-a-glance, day-by-day schedule with notes, Test/Scenario/PT highlights, and holidays. Cadet mode hides internal pay blocks; staff mode shows every role slot and open seats.</>,
            <><B>Day sign-in roster</B> — builder → pick a date: the day&apos;s topics with times + instructors and a numbered signature sheet.</>,
            <><B>Attendance rosters</B> — Roster → Attendance (Manual / From schedule / Blank), one page each.</>,
            <><B>Certificate & transcript</B> — Roster → Members → Certificate link on each cadet.</>,
            <><B>Letters & documents</B> — Reports tab → open a filed report → Print.</>,
            <>App screens stay Heimdall-branded; <B>printed documents carry your org&apos;s branding</B>.</>,
          ]} />
        </Section>

        {/* ── Administration ─────────────────────────────────────────────── */}
        <Section id="users" title="Users, roles & suspension" role="Admins">
          <Tips items={[
            <><B>Admin → Users &amp; Roles</B>: approve pending self-registrations, create accounts (activation email + temporary password), or <B>Bulk import</B> staff from CSV (each row gets an activation email).</>,
            <>Ranks: Instructor → Coordinator → Sergeant → Lieutenant → Director. Coordinator+ is &quot;staff&quot; (builds schedules); Lieutenant and Director are equal admins. Rank display names are editable under Admin → Permissions.</>,
            <><B>Verify qualifications</B> and set each member&apos;s single instructor-cert expiration date from their row.</>,
            <><B>Edit</B> (on each row) lets admins fix a member&apos;s name, sign-in email, rank, agency, or phone, and reset their password. Saving shows a <B>review screen of exactly what changes</B> before anything is applied. A reset password is temporary — the member is signed out everywhere and must choose their own at next sign-in.</>,
            <><B>Suspend</B> blocks sign-in immediately (the member sees an &quot;Account suspended&quot; notice); <B>Deactivate</B> is the permanent variant. Both strip access server-side.</>,
          ]} />
        </Section>

        <Section id="curriculum" title="Curriculum & Hours (per-discipline setup)" role="Admins">
          <Tips items={[
            <>The five FDLE programs (LE 770h, CO, crossovers, EOT) ship as platform curricula — read-only, centrally verified. Your org can add its own disciplines.</>,
            <>Per course: FDLE minimum hours, CJK number, <B>Test</B> flag (gradable), <B>high-liability</B> flag, instructor ratio, lead qualification, default role slots.</>,
            <>Per discipline: which roster tabs are enabled (attendance, gradebook, discipline…), the attendance sheet layout (grid vs sign-in), report categories, and <B>printed-document branding overrides</B> (logo/name/tagline/address for that discipline&apos;s paperwork — e.g. a sheriff&apos;s-office program under a college org).</>,
          ]} />
        </Section>

        <Section id="org-settings" title="Org settings, branding & emails" role="Admins">
          <Tips items={[
            <><B>Admin → Settings</B>: org name, logo, letterhead tagline/address, brand colors (printed documents only), allowed email domains for self-registration, pay-period target hours, site code.</>,
            <><B>Admin → Holidays</B>: toggle which holidays shade calendars, mark which are <B>observed</B> (paid day off — credits holiday pay hours), set the pay hours.</>,
            <><B>Admin → Gjallarhorn</B>: the email system — master switch, per-automation toggles (reminders, open-course announcements, waitlist promotions, understaffing alerts, weekly digest), default reminder lead time, escalation recipients.</>,
            <><B>Admin → Audit Log</B>: who did what, when — approvals, schedule changes, sign-ups, settings changes.</>,
          ]} />
        </Section>

        <Section id="billing" title="Billing & subscription" role="Admins">
          <Tips items={[
            <>HEIMDALL is a flat <B>$199/month per organization</B> — unlimited staff and cadets.</>,
            <><B>Admin → Billing</B>: subscribe via Stripe checkout; <B>Manage billing</B> opens the Stripe portal for cards, invoices, and cancellation.</>,
            <>A missed payment starts a short <B>grace window</B> before restrictions; even then, restriction only pauses <B>creating/publishing new academies</B> — your existing records are never locked away.</>,
            <>Complimentary partner orgs are never billed or restricted.</>,
          ]} />
        </Section>

        {/* ── Help ───────────────────────────────────────────────────────── */}
        <Section id="troubleshooting" title="Troubleshooting & support" role="Everyone">
          <Tips items={[
            <><B>Something looks stale or a button is missing?</B> Hard-refresh (Cmd/Ctrl+Shift+R) — you&apos;re likely on an older cached version after an update.</>,
            <><B>&quot;Site can&apos;t be reached&quot; on one device</B> while others work: quit and reopen the browser — it&apos;s a local network/browser cache issue, not an outage.</>,
            <><B>A list looks empty that shouldn&apos;t be:</B> check your filters first; then hard-refresh.</>,
            <><B>Found a bug or want a feature?</B> Use <B>Feedback</B> in the sidebar — screenshots attach directly and reports go straight to the developers with your page context.</>,
            <>Anything else: contact your Academy Director or coordinator; platform issues reach HEIMDALL through the feedback channel.</>,
          ]} />
        </Section>
      </div>
    </div>
  );
}
