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

const FEATURES: { title: string; body: string }[] = [
  {
    title: 'Schedule builder',
    body: 'Drag-and-drop calendar that tracks FDLE program hours as you go, routes a class through chain-of-command approval before it publishes, then lets instructors claim open sessions.',
  },
  {
    title: 'Cadet roster & gradebook',
    body: 'Attendance, demerits, and end-of-course grades with automatic pass/fail flagging — plus printable attendance sheets and daily sign-in rosters for multi-topic days.',
  },
  {
    title: 'FDLE-aligned curricula',
    body: 'Start from standard Florida CMS recruit curricula with high-liability courses and recommended instructor-to-student ratios already built in.',
  },
  {
    title: 'Documents & letters',
    body: 'Generate counseling, academic-action, and dismissal letters on your letterhead — or compose your own in the in-app document builder.',
  },
  {
    title: 'Gjallarhorn notifications',
    body: 'Email and in-app alerts for approvals, open-session reminders, understaffing, and command escalations, with an optional weekly digest.',
  },
  {
    title: 'Built for every agency',
    body: 'Each organization’s records are fully isolated, your branding appears on printed documents, and data is hosted in the United States.',
  },
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
  { option: 'HEIMDALL', cost: '$199 / mo flat', gets: 'Unlimited staff & cadets — scheduling, roster, gradebook, FDLE curricula, documents & notifications', highlight: true },
  { option: 'Per-seat scheduling apps', cost: '~$3–6 / user / mo', gets: 'A 30-person academy ≈ $90–180/mo — and that’s scheduling only' },
  { option: 'Enterprise training / records suites', cost: 'Custom quote — often thousands / yr', gets: 'Powerful, but priced and contracted for large agencies' },
  { option: 'Spreadsheets & paper', cost: '“Free”', gets: 'No approvals, audit trail, notifications, or printable rosters — all manual' },
];

const TRUST = ['Hosted in the United States', 'Each agency’s data isolated', 'No SSNs stored', 'Your branding on documents'];

const FAQS: { q: string; a: string }[] = [
  { q: 'What is HEIMDALL?', a: 'Scheduling, roster, gradebook, and records software for law-enforcement and corrections training academies, built around the Florida CMS basic-recruit program. It replaces the spreadsheets used to build schedules, track cadets and grades, and generate documents.' },
  { q: 'Who is it for?', a: 'Law-enforcement and corrections basic-recruit academies, New Member Training (NMT) programs, and in-service or specialized training units.' },
  { q: 'How much does it cost?', a: 'A flat $199/month per organization — unlimited staff and cadets, no per-seat fees. Pricing is finalized during beta.' },
  { q: 'Can I sign up now?', a: 'Not yet. HEIMDALL is in beta with a founding academy and isn’t accepting new subscriptions. Sign-ups open here once testing is complete.' },
  { q: 'Where is my data stored and is it secure?', a: 'Data is hosted in the United States, each organization’s records are isolated so one academy can never see another’s, and HEIMDALL does not store Social Security Numbers.' },
];

function BetaBanner() {
  return (
    <div className="bg-bifrost-500 px-4 py-2 text-center text-sm font-semibold text-watch-950">
      HEIMDALL is in <strong>beta</strong> — we’re not accepting new subscriptions yet. Sign-ups open once testing wraps up.
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
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-watch-800 bg-watch-950 px-5 py-3 md:px-10">
        <WordmarkHorizontal size={26} className="text-watch-50" />
        <nav className="flex items-center gap-1 text-sm">
          <a href="#features" className="hidden rounded-md px-3 py-2 font-medium text-watch-200 hover:bg-watch-800 sm:block">Features</a>
          <a href="#pricing" className="hidden rounded-md px-3 py-2 font-medium text-watch-200 hover:bg-watch-800 sm:block">Pricing</a>
          <Link to="/signin" className="rounded-md bg-bifrost-500 px-4 py-2 font-semibold text-watch-950 hover:bg-bifrost-400">Sign in</Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="bg-watch-950 px-5 pb-20 pt-12 text-center text-watch-50 md:px-10">
        <Reveal immediate>
          <WordmarkStacked size={116} className="mx-auto" />
          <h1 className="mx-auto mt-8 max-w-3xl font-display text-3xl font-bold leading-tight md:text-5xl">
            Run your training academy without the spreadsheets.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-watch-300 md:text-lg">
            HEIMDALL is the scheduling, roster, and records platform for law-enforcement and corrections training
            academies — purpose-built around the Florida CMS basic-recruit program.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/signin" className="rounded-md bg-bifrost-500 px-5 py-2.5 text-sm font-semibold text-watch-950 shadow-sm transition-colors hover:bg-bifrost-400">
              Sign in
            </Link>
            <a href="#features" className="rounded-md border border-watch-700 px-5 py-2.5 text-sm font-semibold text-watch-100 transition-colors hover:bg-watch-800">
              See what it does
            </a>
          </div>
          <p className="mt-4 text-xs text-watch-400">In beta — new subscriptions aren’t open yet.</p>
        </Reveal>
      </section>

      {/* Product preview */}
      <section className="mx-auto max-w-5xl px-5 py-16 md:px-10">
        <Reveal>
          <h2 className="text-center font-display text-2xl font-bold md:text-3xl">A look inside</h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-slate-500">
            Build the schedule, track every cadet, and print what you need — one place for the whole academy.
          </p>
        </Reveal>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <Reveal>
            <figure>
              <SchedulePreview />
              <figcaption className="mt-2 text-center text-xs text-slate-500">Schedule builder — color-coded tests, scenarios, and PT; live hour totals.</figcaption>
            </figure>
          </Reveal>
          <Reveal delay={120}>
            <figure>
              <RosterPreview />
              <figcaption className="mt-2 text-center text-xs text-slate-500">Cadet roster & gradebook — attendance, demerits, and pass/fail grades.</figcaption>
            </figure>
          </Reveal>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="bg-watch-50 px-5 py-16 md:px-10">
        <div className="mx-auto max-w-5xl">
          <Reveal><h2 className="text-center font-display text-2xl font-bold md:text-3xl">Everything an academy office needs</h2></Reveal>
          <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={(i % 3) * 90}>
                <div className="h-full rounded-xl border border-watch-100 bg-white p-5 shadow-sm">
                  <h3 className="font-semibold text-watch-900">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section className="mx-auto max-w-4xl px-5 py-16 text-center md:px-10">
        <Reveal>
          <h2 className="font-display text-2xl font-bold md:text-3xl">Built for public-safety training</h2>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {AUDIENCE.map((a) => (
              <span key={a} className="rounded-full border border-watch-200 bg-watch-50 px-4 py-2 text-sm font-medium text-watch-800">{a}</span>
            ))}
          </div>
        </Reveal>
      </section>

      {/* Comparison */}
      <section className="bg-watch-50 px-5 py-16 md:px-10">
        <Reveal className="mx-auto max-w-4xl">
          <h2 className="text-center font-display text-2xl font-bold md:text-3xl">Priced for academies, not enterprises</h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-slate-500">
            One flat fee covers your whole academy — here’s how that stacks up against the alternatives.
          </p>
          <div className="mt-8 overflow-x-auto rounded-xl border border-watch-100 bg-white shadow-sm">
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
      <section id="pricing" className="px-5 py-16 md:px-10">
        <Reveal className="mx-auto max-w-xl text-center">
          <h2 className="font-display text-2xl font-bold md:text-3xl">Simple, flat pricing</h2>
          <p className="mt-3 text-sm text-slate-600">
            One subscription per organization — every coordinator, instructor, and cadet record included. No
            per-seat math.
          </p>
          <div className="mt-8 rounded-2xl border border-watch-200 bg-white p-8 shadow-sm">
            <div className="flex items-end justify-center gap-1">
              <span className="text-4xl font-bold text-watch-900">{PRICE}</span>
              <span className="pb-1 text-lg font-medium text-slate-500">{PRICE_PERIOD}</span>
            </div>
            <div className="mt-1 text-xs font-medium uppercase tracking-wider text-slate-400">flat rate · planned beta pricing</div>
            <ul className="mx-auto mt-6 max-w-sm space-y-2 text-left text-sm text-slate-700">
              {['Unlimited staff & instructor accounts', 'Unlimited academies & cadets', 'Schedule builder, roster & gradebook', 'FDLE curricula + document builder', 'Email + in-app notifications', 'Your branding on printed documents'].map((li) => (
                <li key={li} className="flex items-start gap-2">
                  <span aria-hidden className="mt-0.5 text-bifrost-600">✓</span>
                  <span>{li}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong>In beta — not accepting subscriptions yet.</strong> We’re finishing testing with our
              founding academy. Sign-ups will open here once it’s ready.
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
        <Reveal className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm font-medium text-watch-700">
          {TRUST.map((t) => (
            <span key={t} className="flex items-center gap-1.5"><span aria-hidden className="text-bifrost-600">✓</span>{t}</span>
          ))}
        </Reveal>
      </section>

      {/* FAQ */}
      <section id="faq" className="px-5 py-16 md:px-10">
        <div className="mx-auto max-w-3xl">
          <Reveal><h2 className="text-center font-display text-2xl font-bold md:text-3xl">Frequently asked questions</h2></Reveal>
          <dl className="mt-8 space-y-4">
            {FAQS.map((f, i) => (
              <Reveal key={f.q} delay={(i % 3) * 80}>
                <div className="rounded-xl border border-watch-100 bg-white p-5 shadow-sm">
                  <dt className="font-semibold text-watch-900">{f.q}</dt>
                  <dd className="mt-2 text-sm leading-relaxed text-slate-600">{f.a}</dd>
                </div>
              </Reveal>
            ))}
          </dl>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-watch-100 bg-watch-950 px-5 py-8 text-center text-xs text-watch-400 md:px-10">
        <WordmarkHorizontal size={20} className="text-watch-200" />
        <p className="mt-3">© HEIMDALL Scheduling. Watch staffing · Sound the alert.</p>
      </footer>
    </div>
  );
}
