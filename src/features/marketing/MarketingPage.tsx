/**
 * Public marketing + pricing landing — the front door at "/" for signed-out
 * visitors (RootGate sends members to the app). Always Heimdall-branded; reads
 * no tenant data.
 *
 * Pricing is the PLANNED beta price ($199/mo flat). The product is in beta, so
 * there is NO subscribe flow here — only Sign in for existing beta participants.
 * The "preview" graphics are stylized representations of real features; swap in
 * actual screenshots (public/marketing/*.png) when you have them.
 *
 * Every claim on this page describes SHIPPED functionality — keep it that way.
 * Cost comparisons are general market estimates, labeled as such (never
 * named-competitor quotes).
 *
 * SEO essentials (title, description, OG/Twitter, canonical, JSON-LD, noscript)
 * live in index.html so crawlers see them without running the SPA; robots.txt +
 * sitemap.xml are in public/.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { WordmarkStacked, WordmarkHorizontal } from '../../brand/Logo';

/** Subtle scroll-reveal: fades + rises into view once, honoring reduced-motion.
 *  `immediate` plays on mount (for above-the-fold hero content). */
function Reveal({ children, className = '', delay = 0, immediate = false }: {
  children: React.ReactNode; className?: string; delay?: number; immediate?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (immediate) { const t = setTimeout(() => setShown(true), 60); return () => clearTimeout(t); }
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [immediate]);
  return (
    <div ref={ref} className={`hd-reveal ${shown ? 'hd-reveal--in' : ''} ${className}`} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}

const PRICE = '$199';
const PRICE_PERIOD = '/mo';

/** Small uppercase section eyebrow — one consistent rhythm across the page. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 text-center text-xs font-bold uppercase tracking-[0.2em] text-bifrost-600">{children}</div>
  );
}

// ── The centerpiece: everything you'd otherwise buy, and what replaces it ────
const REPLACES: { tool: string; typicalCost: string; pain: string; module: string; detail: string }[] = [
  {
    tool: 'Staff-scheduling app',
    typicalCost: '~$3–6 per user / mo',
    pain: 'Per-seat pricing, and it has no idea what an FDLE program hour is.',
    module: 'CADRE schedule builder',
    detail: 'Drag-and-drop calendar that tracks curriculum hours live, routes classes through chain-of-command approval, and lets qualified instructors claim open sessions — waitlists promote automatically.',
  },
  {
    tool: 'Spreadsheet gradebook',
    typicalCost: '“Free” + hours of upkeep',
    pain: 'One bad cell reference and a cadet’s record is wrong. No rules, no history.',
    module: 'FDLE-rule gradebook',
    detail: 'The 80% pass line, the one-re-exam rule, and high-liability lifelines are built in — failures flag themselves, and the matching academic letter pre-fills from the grade.',
  },
  {
    tool: 'Room-booking tool',
    typicalCost: '~$50–150 / mo',
    pain: 'Separate calendar nobody checks — double-booked ranges get found the hard way.',
    module: 'Room reservations',
    detail: 'Locations and rooms with hard conflict blocking on every path — including multi-room scenario days, drag-reschedules, clones, and ad-hoc holds for outside groups.',
  },
  {
    tool: 'Word templates on a shared drive',
    typicalCost: 'Staff time + legal risk',
    pain: 'Twelve versions of the dismissal letter, none of them the current one.',
    module: 'Document library',
    detail: 'FDLE academic-action letters with verified F.A.C. citations, conduct and incident documents, all filed per class and reprintable on your letterhead.',
  },
  {
    tool: 'Email lists & group texts',
    typicalCost: '~$20–60 / mo',
    pain: 'Everyone gets everything, so everyone reads nothing.',
    module: 'Gjallarhorn notifications',
    detail: 'Targeted open-course call-outs by qualification, assignment reminders on each instructor’s schedule, understaffing escalations, weekly digests — with per-discipline subscriptions.',
  },
  {
    tool: 'Filing cabinets & binders',
    typicalCost: 'Square footage + search time',
    pain: 'The record exists — somewhere in the third drawer.',
    module: 'Cadet records',
    detail: 'Roster with bulk import, printable + digital attendance, discipline points, graduation with org-branded certificates and transcripts, and one-click CSV exports of the whole class.',
  },
];

// ── Feature pillars (all shipped functionality) ──────────────────────────────
const PILLARS: { title: string; items: string[] }[] = [
  {
    title: 'Scheduling & approval',
    items: [
      'Quarterly templates and one-click class cloning — every session shifts to the new dates',
      'Live curriculum coverage against FDLE minimums, per course and per block',
      'Chain-of-command approval with a hard publish gate — nothing goes live unsigned',
      'Holiday shading, test/scenario/PT highlighting, recurring block generator',
    ],
  },
  {
    title: 'Staffing & sign-ups',
    items: [
      'Open-session sign-ups gated by verified qualifications and cert expiration',
      'Waitlists that auto-promote (and re-check conflicts) the moment a slot opens',
      'Double-booking blocked; instructor-ratio advisories on high-liability days',
      'Daily understaffing alerts with command escalation',
    ],
  },
  {
    title: 'Facilities',
    items: [
      'Locations and rooms with capacity, colors, and floor-plan images',
      'Hard conflict blocking — sessions, drags, clones, and multi-room scenario days',
      'Ad-hoc holds for maintenance and outside groups',
      'A booking calendar filterable by location or room',
    ],
  },
  {
    title: 'Cadet records',
    items: [
      'Guided intake or bulk CSV import; alphabetical rosters with stable cadet numbers',
      'Attendance three ways: from the calendar, manual, or blank sheets — plus a digital log',
      'Discipline tracking with weighted demerits and automatic-dismissal thresholds',
      'Graduation, org-branded certificates and transcripts, full-class CSV export',
    ],
  },
  {
    title: 'Documents & compliance',
    items: [
      'FDLE academic-action letters with verified F.A.C. citations, pre-filled from the gradebook',
      'Counseling, incident, injury, use-of-force (training), and dismissal documents',
      'Your letterhead on every printed document — per-discipline branding overrides',
      'A full audit log of approvals, schedule changes, and record edits',
    ],
  },
  {
    title: 'Communications & admin',
    items: [
      'In-app bell + email, per-user reminder lead times, per-discipline subscriptions',
      'Personal calendar feeds (ICS) that sync assignments to any phone or Outlook',
      'Role-based access from instructor to director; suspension locks out instantly',
      'Each organization’s data fully isolated; no SSNs stored; hosted in the U.S.',
    ],
  },
];

const WORKFLOW: { step: string; body: string }[] = [
  { step: 'Build', body: 'Start from a quarterly template or clone last cohort — the calendar shifts itself.' },
  { step: 'Approve', body: 'Route the class up the chain of command; publishing is blocked until it’s signed off.' },
  { step: 'Publish & staff', body: 'Open courses for sign-up with targeted call-outs; watch slots fill on the staffing board.' },
  { step: 'Teach & record', body: 'Print the day’s rosters, take attendance, enter grades and discipline as you go.' },
  { step: 'Document', body: 'Letters, incident reports, and memos generate pre-filled on your letterhead.' },
  { step: 'Graduate', body: 'Certificates, transcripts, and a full records export — the class file is already done.' },
];

const AUDIENCE = [
  'Law-enforcement basic-recruit academies',
  'Corrections training academies',
  'New Member Training (NMT) programs',
  'In-service & specialized training units',
];

// General market estimates for comparison — NOT named-competitor quotes (those
// are typically custom). Keep these honest + clearly illustrative.
const COMPARISON: { option: string; cost: string; gets: string; highlight?: boolean }[] = [
  { option: 'HEIMDALL', cost: '$199 / mo flat', gets: 'Unlimited staff & cadets — scheduling, staffing, rooms, roster, gradebook, FDLE curricula, documents & notifications in one system', highlight: true },
  { option: 'Per-seat scheduling apps', cost: '~$3–6 / user / mo', gets: 'A 30-person academy ≈ $90–180/mo — and that’s scheduling only' },
  { option: 'A pieced-together stack', cost: '~$150–400 / mo across tools', gets: 'Scheduling + room booking + mass email + e-sign/docs — separate logins, nothing connected' },
  { option: 'Enterprise training / records suites', cost: 'Custom quote — often thousands / yr', gets: 'Powerful, but priced and contracted for large agencies' },
  { option: 'Spreadsheets & paper', cost: '“Free”', gets: 'No approvals, audit trail, notifications, or printable rosters — all manual' },
];

const TRUST = [
  'Hosted in the United States',
  'Each agency’s data isolated',
  'No SSNs stored',
  'Chain-of-command approvals',
  'Full audit trail',
  'Your branding on documents',
];

const FAQS: { q: string; a: string }[] = [
  { q: 'What is HEIMDALL?', a: 'The operating system for a training academy: scheduling, instructor staffing, room reservations, cadet roster, attendance, gradebook, discipline, documents, and notifications — built around the Florida CMS basic-recruit program.' },
  { q: 'What does it replace?', a: 'The typical academy stack: a per-seat scheduling app, spreadsheet gradebooks, a room-booking tool, Word letter templates on a shared drive, mass-email lists, and the filing cabinet. One login, one flat price, and every record connected to the schedule that produced it.' },
  { q: 'Who is it for?', a: 'Law-enforcement and corrections basic-recruit academies, New Member Training (NMT) programs, and in-service or specialized training units.' },
  { q: 'How much does it cost?', a: 'A flat $199/month per organization — unlimited staff and cadets, no per-seat fees. Pricing is finalized during beta.' },
  { q: 'Can I sign up now?', a: 'Not yet. HEIMDALL is in beta with a founding Florida academy and isn’t accepting new subscriptions. Sign-ups open here once testing is complete.' },
  { q: 'Where is my data stored and is it secure?', a: 'Data is hosted in the United States, each organization’s records are isolated so one academy can never see another’s, access is role-based from instructor to director, and HEIMDALL does not store Social Security Numbers.' },
];

function BetaBanner() {
  return (
    <div className="bg-bifrost-500 px-4 py-2 text-center text-sm font-semibold text-watch-950">
      HEIMDALL is in <strong>beta</strong> — we&rsquo;re not accepting new subscriptions yet. Sign-ups open once testing wraps up.
    </div>
  );
}

/** Stylized preview of the schedule builder (representative, not a live screenshot). */
function SchedulePreview() {
  const Block = ({ x, y, w, h, fill, stroke, label }: { x: number; y: number; w: number; h: number; fill: string; stroke: string; label: string }) => (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="3" fill={fill} stroke={stroke} strokeWidth="2" />
      <text x={x + 6} y={y + 15} fontSize="9" fill="#fff" fontWeight="600">{label}</text>
    </g>
  );
  return (
    <svg viewBox="0 0 480 300" className="w-full rounded-lg border border-watch-200 shadow-sm" role="img" aria-label="Schedule builder preview">
      <rect width="480" height="300" rx="8" fill="#ffffff" />
      <rect width="480" height="26" rx="8" fill="#16203a" />
      <circle cx="14" cy="13" r="4" fill="#e7ad33" /><circle cx="28" cy="13" r="4" fill="#4a6296" /><circle cx="42" cy="13" r="4" fill="#2b3a5e" />
      <text x="60" y="17" fontSize="10" fill="#e8ecf6" fontWeight="600">Schedule Builder — LE 133</text>
      {/* day headers */}
      {['MON', 'TUE', 'WED', 'THU', 'FRI'].map((d, i) => (
        <text key={d} x={50 + i * 84} y={46} fontSize="9" fill="#374b78" fontWeight="700">{d}</text>
      ))}
      {/* grid lines */}
      {[0, 1, 2, 3, 4, 5].map((i) => <line key={i} x1="40" y1={56 + i * 40} x2="470" y2={56 + i * 40} stroke="#e8ecf6" />)}
      {/* holiday wash on WED */}
      <rect x="208" y="56" width="80" height="200" fill="#fecaca" opacity="0.6" />
      <text x="248" y="70" fontSize="8" fill="#000" fontWeight="700" textAnchor="middle">Holiday</text>
      {/* class blocks (incl. the color-coded flags) */}
      <Block x={44} y={60} w={76} h={56} fill="#2b3a5e" stroke="#16203a" label="Patrol" />
      <Block x={128} y={60} w={76} h={36} fill="#965417" stroke="#7b4319" label="Firearms ▲" />
      <Block x={44} y={150} w={76} h={36} fill="#dc2626" stroke="#991b1b" label="TEST" />
      <Block x={128} y={150} w={76} h={56} fill="#16a34a" stroke="#166534" label="Scenario" />
      <Block x={296} y={60} w={76} h={36} fill="#eab308" stroke="#a16207" label="PT Assess." />
      <Block x={296} y={150} w={76} h={56} fill="#2b3a5e" stroke="#16203a" label="DT" />
      <Block x={380} y={60} w={76} h={56} fill="#2b3a5e" stroke="#16203a" label="Legal" />
    </svg>
  );
}

/** Stylized preview of the cadet roster + gradebook. */
function RosterPreview() {
  const rows = [
    { n: 1, name: 'Alequin, J.', g: '94', pass: true },
    { n: 2, name: 'Bader, E.', g: '88', pass: true },
    { n: 3, name: 'Conn, M.', g: '72', pass: false },
    { n: 4, name: 'Hackett, C.', g: '96', pass: true },
    { n: 5, name: 'Martinez, S.', g: '83', pass: true },
  ];
  return (
    <svg viewBox="0 0 480 300" className="w-full rounded-lg border border-watch-200 shadow-sm" role="img" aria-label="Cadet roster and gradebook preview">
      <rect width="480" height="300" rx="8" fill="#ffffff" />
      <rect width="480" height="26" rx="8" fill="#16203a" />
      <circle cx="14" cy="13" r="4" fill="#e7ad33" /><circle cx="28" cy="13" r="4" fill="#4a6296" /><circle cx="42" cy="13" r="4" fill="#2b3a5e" />
      <text x="60" y="17" fontSize="10" fill="#e8ecf6" fontWeight="600">Cadet Roster — End-of-Course Grades</text>
      {/* header */}
      <rect x="20" y="40" width="440" height="26" fill="#f4f6fb" />
      <text x="32" y="57" fontSize="9" fill="#374b78" fontWeight="700">NO.</text>
      <text x="72" y="57" fontSize="9" fill="#374b78" fontWeight="700">CADET</text>
      <text x="300" y="57" fontSize="9" fill="#374b78" fontWeight="700">GRADE</text>
      <text x="380" y="57" fontSize="9" fill="#374b78" fontWeight="700">STATUS</text>
      {rows.map((r, i) => {
        const y = 66 + i * 36;
        return (
          <g key={r.n}>
            <line x1="20" y1={y + 36} x2="460" y2={y + 36} stroke="#e8ecf6" />
            <text x="34" y={y + 22} fontSize="10" fill="#16203a" fontWeight="600">{r.n}</text>
            <text x="72" y={y + 22} fontSize="10" fill="#16203a">{r.name}</text>
            <text x="300" y={y + 22} fontSize="10" fill="#16203a" fontWeight="600">{r.g}</text>
            <rect x="376" y={y + 9} width="58" height="18" rx="9" fill={r.pass ? '#dcfce7' : '#fee2e2'} />
            <text x="405" y={y + 22} fontSize="9" fontWeight="700" textAnchor="middle" fill={r.pass ? '#166534' : '#991b1b'}>{r.pass ? 'PASS' : 'FAIL'}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function MarketingPage() {
  return (
    <div className="min-h-screen bg-white text-watch-900">
      <BetaBanner />

      {/* Top bar */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-watch-800 bg-watch-950/95 px-5 py-3 backdrop-blur md:px-10">
        <WordmarkHorizontal size={26} className="text-watch-50" />
        <nav className="flex items-center gap-1 text-sm">
          <a href="#replaces" className="hidden rounded-md px-3 py-2 font-medium text-watch-200 hover:bg-watch-800 md:block">Replaces</a>
          <a href="#features" className="hidden rounded-md px-3 py-2 font-medium text-watch-200 hover:bg-watch-800 sm:block">Features</a>
          <a href="#pricing" className="hidden rounded-md px-3 py-2 font-medium text-watch-200 hover:bg-watch-800 sm:block">Pricing</a>
          <a href="#faq" className="hidden rounded-md px-3 py-2 font-medium text-watch-200 hover:bg-watch-800 md:block">FAQ</a>
          <Link to="/signin" className="rounded-md bg-bifrost-500 px-4 py-2 font-semibold text-watch-950 hover:bg-bifrost-400">Sign in</Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-watch-950 px-5 pb-24 pt-14 text-center text-watch-50 md:px-10">
        {/* Layered glow + fine grid — pure CSS, no assets. */}
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{
          background:
            'radial-gradient(600px 300px at 50% -40px, rgba(231,173,51,0.14), transparent 70%), radial-gradient(900px 420px at 50% 110%, rgba(74,98,150,0.25), transparent 70%)',
        }} />
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.06]" style={{
          backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }} />
        <Reveal immediate className="relative">
          <WordmarkStacked size={112} className="mx-auto" />
          <h1 className="mx-auto mt-8 max-w-3xl font-display text-4xl font-bold leading-tight md:text-6xl">
            One system runs the <span className="bg-gradient-to-r from-bifrost-300 to-bifrost-500 bg-clip-text text-transparent">whole academy</span>.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-watch-300 md:text-lg">
            Scheduling, instructor staffing, rooms, cadet records, the gradebook, and every letter you print —
            purpose-built for law-enforcement and corrections training academies around the Florida CMS
            basic-recruit program.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a href="#replaces" className="rounded-md bg-bifrost-500 px-6 py-3 text-sm font-semibold text-watch-950 shadow-lg shadow-bifrost-500/20 transition-colors hover:bg-bifrost-400">
              See everything it replaces
            </a>
            <Link to="/signin" className="rounded-md border border-watch-700 px-6 py-3 text-sm font-semibold text-watch-100 transition-colors hover:bg-watch-800">
              Beta participant? Sign in
            </Link>
          </div>
          <div className="mx-auto mt-10 flex max-w-3xl flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-watch-300">
            <span><strong className="text-bifrost-300">$199/mo flat</strong> · no per-seat fees</span>
            <span><strong className="text-bifrost-300">Unlimited</strong> staff, instructors & cadets</span>
            <span><strong className="text-bifrost-300">FDLE curricula</strong> built in — LE, CO & crossovers</span>
          </div>
        </Reveal>
      </section>

      {/* Replace the stack — the centerpiece */}
      <section id="replaces" className="scroll-mt-16 px-5 py-20 md:px-10">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <Eyebrow>One platform instead of six</Eyebrow>
            <h2 className="text-center font-display text-3xl font-bold md:text-4xl">Replace the whole stack</h2>
            <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-slate-500 md:text-base">
              Running an academy usually means half a dozen tools that don&rsquo;t talk to each other — plus the
              spreadsheets holding it all together. HEIMDALL does the job of every one of them, connected.
            </p>
          </Reveal>
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {REPLACES.map((r, i) => (
              <Reveal key={r.tool} delay={(i % 3) * 90}>
                <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-watch-100 bg-white shadow-sm transition-shadow hover:shadow-md">
                  {/* The old tool */}
                  <div className="border-b border-dashed border-watch-200 bg-watch-50/70 px-5 py-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-500 line-through decoration-red-400/70 decoration-2">{r.tool}</span>
                      <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">{r.typicalCost}</span>
                    </div>
                    <p className="mt-1.5 text-xs italic text-slate-500">{r.pain}</p>
                  </div>
                  {/* The replacement */}
                  <div className="flex flex-1 flex-col px-5 py-4">
                    <div className="flex items-center gap-2">
                      <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-bifrost-500 text-[11px] font-bold text-watch-950">✓</span>
                      <h3 className="font-semibold text-watch-900">{r.module}</h3>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">{r.detail}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal>
            <div className="mx-auto mt-10 flex max-w-3xl flex-col items-center gap-2 rounded-2xl bg-watch-950 px-6 py-6 text-center text-watch-100 sm:flex-row sm:justify-center sm:gap-8">
              <div className="text-sm"><span className="font-bold text-bifrost-300">6+ tools</span> · separate logins · nothing connected</div>
              <div aria-hidden className="text-bifrost-400">→</div>
              <div className="text-sm"><span className="font-bold text-bifrost-300">One login. {PRICE} flat.</span> Every record tied to the schedule that produced it.</div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Product preview */}
      <section className="bg-watch-50 px-5 py-20 md:px-10">
        <div className="mx-auto max-w-5xl">
          <Reveal>
            <Eyebrow>A look inside</Eyebrow>
            <h2 className="text-center font-display text-3xl font-bold md:text-4xl">Built for how academies actually run</h2>
            <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-slate-500">
              Build the schedule, track every cadet, and print what you need — one place for the whole academy.
            </p>
          </Reveal>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <Reveal>
              <figure>
                <SchedulePreview />
                <figcaption className="mt-2 text-center text-xs text-slate-500">Schedule builder — color-coded tests, scenarios, and PT; live hour totals against FDLE minimums.</figcaption>
              </figure>
            </Reveal>
            <Reveal delay={120}>
              <figure>
                <RosterPreview />
                <figcaption className="mt-2 text-center text-xs text-slate-500">Cadet roster & gradebook — attendance, demerits, and pass/fail with the FDLE exam rules built in.</figcaption>
              </figure>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Feature pillars */}
      <section id="features" className="scroll-mt-16 px-5 py-20 md:px-10">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <Eyebrow>Everything included</Eyebrow>
            <h2 className="text-center font-display text-3xl font-bold md:text-4xl">Every job the academy office does</h2>
          </Reveal>
          <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {PILLARS.map((p, i) => (
              <Reveal key={p.title} delay={(i % 3) * 90}>
                <div className="h-full rounded-2xl border border-watch-100 bg-white p-6 shadow-sm">
                  <h3 className="font-display text-lg font-bold text-watch-900">{p.title}</h3>
                  <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-600">
                    {p.items.map((it) => (
                      <li key={it} className="flex items-start gap-2">
                        <span aria-hidden className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-bifrost-500" />
                        <span>{it}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Workflow */}
      <section className="bg-watch-950 px-5 py-20 text-watch-50 md:px-10">
        <div className="mx-auto max-w-5xl">
          <Reveal>
            <Eyebrow>From template to graduation</Eyebrow>
            <h2 className="text-center font-display text-3xl font-bold md:text-4xl">The whole cohort, one flow</h2>
          </Reveal>
          <ol className="mt-12 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {WORKFLOW.map((w, i) => (
              <Reveal key={w.step} delay={(i % 3) * 90}>
                <li className="flex gap-4">
                  <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-bifrost-500 font-display text-sm font-bold text-bifrost-300">{i + 1}</span>
                  <div>
                    <div className="font-semibold text-watch-50">{w.step}</div>
                    <p className="mt-1 text-sm leading-relaxed text-watch-300">{w.body}</p>
                  </div>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* Who it's for */}
      <section className="mx-auto max-w-4xl px-5 py-16 text-center md:px-10">
        <Reveal>
          <Eyebrow>Who it&rsquo;s for</Eyebrow>
          <h2 className="font-display text-3xl font-bold md:text-4xl">Built for public-safety training</h2>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {AUDIENCE.map((a) => (
              <span key={a} className="rounded-full border border-watch-200 bg-watch-50 px-4 py-2 text-sm font-medium text-watch-800">{a}</span>
            ))}
          </div>
        </Reveal>
      </section>

      {/* Comparison */}
      <section className="bg-watch-50 px-5 py-20 md:px-10">
        <Reveal className="mx-auto max-w-4xl">
          <Eyebrow>The math</Eyebrow>
          <h2 className="text-center font-display text-3xl font-bold md:text-4xl">Priced for academies, not enterprises</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-slate-500">
            One flat fee covers your whole academy — here&rsquo;s how that stacks up against the alternatives.
          </p>
          <div className="mt-8 overflow-x-auto rounded-2xl border border-watch-100 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-watch-50 text-xs uppercase tracking-wider text-watch-600">
                <tr>
                  <th className="px-4 py-3">Option</th>
                  <th className="px-4 py-3">Typical cost</th>
                  <th className="px-4 py-3">What you get</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-watch-100">
                {COMPARISON.map((c) => (
                  <tr key={c.option} className={c.highlight ? 'bg-bifrost-50/70' : ''}>
                    <td className="px-4 py-3 font-semibold text-watch-900">
                      {c.option}
                      {c.highlight && <span className="ml-2 rounded-full bg-bifrost-500 px-2 py-0.5 text-[10px] font-bold uppercase text-watch-950">You</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-watch-800">{c.cost}</td>
                    <td className="px-4 py-3 text-slate-600">{c.gets}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-center text-xs text-slate-400">
            Figures are general market estimates for illustration; most academy/records platforms are custom-quoted.
          </p>
        </Reveal>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-16 px-5 py-20 md:px-10">
        <Reveal className="mx-auto max-w-xl text-center">
          <Eyebrow>Pricing</Eyebrow>
          <h2 className="font-display text-3xl font-bold md:text-4xl">Simple, flat pricing</h2>
          <p className="mt-3 text-sm text-slate-600">
            One subscription per organization — every coordinator, instructor, and cadet record included. No
            per-seat math.
          </p>
          <div className="mt-8 rounded-2xl border-2 border-bifrost-400/60 bg-white p-8 shadow-lg shadow-bifrost-500/10">
            <div className="flex items-end justify-center gap-1">
              <span className="font-display text-5xl font-bold text-watch-900">{PRICE}</span>
              <span className="pb-1.5 text-lg font-medium text-slate-500">{PRICE_PERIOD}</span>
            </div>
            <div className="mt-1 text-xs font-medium uppercase tracking-wider text-slate-400">flat rate · planned beta pricing</div>
            <ul className="mx-auto mt-6 max-w-sm space-y-2 text-left text-sm text-slate-700">
              {[
                'Unlimited staff & instructor accounts',
                'Unlimited academies & cadets',
                'Schedule builder, staffing & room reservations',
                'Roster, attendance, gradebook & discipline',
                'FDLE curricula + the full document library',
                'Email + in-app notifications & calendar feeds',
                'Your branding on printed documents',
              ].map((li) => (
                <li key={li} className="flex items-start gap-2">
                  <span aria-hidden className="mt-0.5 text-bifrost-600">✓</span>
                  <span>{li}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong>In beta — not accepting subscriptions yet.</strong> We&rsquo;re finishing testing with our
              founding academy. Sign-ups will open here once it&rsquo;s ready.
            </div>
            <Link to="/signin" className="mt-4 inline-block rounded-md border border-watch-200 px-5 py-2.5 text-sm font-semibold text-watch-800 hover:bg-watch-50">
              Beta participant? Sign in
            </Link>
          </div>
          <p className="mt-4 text-xs text-slate-400">
            When billing opens, payments will be processed securely by Stripe — HEIMDALL never sees your card details.
          </p>
        </Reveal>
      </section>

      {/* Trust strip */}
      <section className="border-y border-watch-100 bg-watch-50 px-5 py-6 md:px-10">
        <Reveal className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm font-medium text-watch-700">
          {TRUST.map((t) => (
            <span key={t} className="flex items-center gap-1.5"><span aria-hidden className="text-bifrost-600">✓</span>{t}</span>
          ))}
        </Reveal>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-16 px-5 py-20 md:px-10">
        <div className="mx-auto max-w-3xl">
          <Reveal>
            <Eyebrow>Questions</Eyebrow>
            <h2 className="text-center font-display text-3xl font-bold md:text-4xl">Frequently asked questions</h2>
          </Reveal>
          <dl className="mt-8 space-y-4">
            {FAQS.map((f, i) => (
              <Reveal key={f.q} delay={(i % 3) * 80}>
                <div className="rounded-2xl border border-watch-100 bg-white p-5 shadow-sm">
                  <dt className="font-semibold text-watch-900">{f.q}</dt>
                  <dd className="mt-2 text-sm leading-relaxed text-slate-600">{f.a}</dd>
                </div>
              </Reveal>
            ))}
          </dl>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="relative overflow-hidden bg-watch-950 px-5 py-16 text-center text-watch-50 md:px-10">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{
          background: 'radial-gradient(700px 300px at 50% 120%, rgba(231,173,51,0.12), transparent 70%)',
        }} />
        <Reveal className="relative">
          <h2 className="mx-auto max-w-2xl font-display text-3xl font-bold md:text-4xl">
            Retire the spreadsheets. Keep the standards.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-watch-300">
            HEIMDALL is finishing beta with a founding Florida academy. Subscriptions open here when it&rsquo;s ready —
            at {PRICE}{PRICE_PERIOD}, flat.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <a href="#replaces" className="rounded-md bg-bifrost-500 px-6 py-3 text-sm font-semibold text-watch-950 hover:bg-bifrost-400">
              See everything it replaces
            </a>
            <Link to="/signin" className="rounded-md border border-watch-700 px-6 py-3 text-sm font-semibold text-watch-100 hover:bg-watch-800">
              Sign in
            </Link>
          </div>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="border-t border-watch-800 bg-watch-950 px-5 py-10 text-center text-xs text-watch-400 md:px-10">
        <WordmarkHorizontal size={20} className="text-watch-200" />
        <nav className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-watch-300">
          <a href="#replaces" className="hover:text-watch-100">Replaces</a>
          <a href="#features" className="hover:text-watch-100">Features</a>
          <a href="#pricing" className="hover:text-watch-100">Pricing</a>
          <a href="#faq" className="hover:text-watch-100">FAQ</a>
          <Link to="/signin" className="hover:text-watch-100">Sign in</Link>
        </nav>
        <p className="mt-4">© HEIMDALL Scheduling. Watch staffing · Sound the alert.</p>
      </footer>
    </div>
  );
}
