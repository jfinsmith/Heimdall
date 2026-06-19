/**
 * Public marketing + pricing landing (Phase 14) — the front door at the bare
 * path "/" for UNAUTHENTICATED visitors (RootGate sends signed-in users to the
 * app). Heimdall-branded; no tenant data is read here.
 *
 * NOTE: the copy and price below are STARTING POINTS for your review — edit the
 * headline, the feature blurbs, and PRICE_LABEL to match how you sell HEIMDALL.
 * There are no fabricated stats, customer names, or testimonials by design.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { WordmarkStacked, WordmarkHorizontal } from '../../brand/Logo';

/** Edit to your real price, e.g. '$199 / month per academy'. Left neutral so we
 *  never advertise a number you didn't set. The actual charge is whatever your
 *  Stripe price (STRIPE_PRICE_ID) is configured to. */
const PRICE_LABEL = 'Contact us for pricing';

const FEATURES: { title: string; body: string }[] = [
  { title: 'Academy scheduling', body: 'Build basic-recruit academies, publish classes through a chain-of-command sign-off, and let instructors claim open sessions.' },
  { title: 'Cadet roster & gradebook', body: 'Attendance, demerits, end-of-course grades with pass/fail flagging, and printable roster sheets — all per class.' },
  { title: 'FDLE-aligned curricula', body: 'Start from standard Florida CMS curricula with high-liability courses and instructor-ratio guidance built in.' },
  { title: 'Documents that print clean', body: 'Generate counseling, dismissal, and academic-action letters on your letterhead — or build your own in the document builder.' },
  { title: 'Gjallarhorn notifications', body: 'Email + in-app alerts for approvals, open-session reminders, and command escalations, with a weekly digest.' },
  { title: 'Your data, isolated', body: 'Every organization’s records are walled off by tenant — your academy only ever sees its own cadets, staff, and documents.' },
];

function CTAButtons({ center = false }: { center?: boolean }) {
  return (
    <div className={`flex flex-wrap gap-3 ${center ? 'justify-center' : ''}`}>
      <Link
        to="/signin"
        className="rounded-md bg-bifrost-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-bifrost-400"
      >
        Get started
      </Link>
      <a
        href="#pricing"
        className="rounded-md border border-watch-200 bg-white px-5 py-2.5 text-sm font-semibold text-watch-800 transition-colors hover:bg-watch-50"
      >
        See pricing
      </a>
    </div>
  );
}

export function MarketingPage() {
  return (
    <div className="min-h-screen bg-white text-watch-900">
      {/* Top bar */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-watch-100 bg-watch-950 px-5 py-3 md:px-10">
        <WordmarkHorizontal size={26} className="text-watch-50" />
        <Link to="/signin" className="rounded-md px-4 py-2 text-sm font-semibold text-watch-100 hover:bg-watch-800">
          Sign in
        </Link>
      </header>

      {/* Hero */}
      <section className="bg-watch-950 px-5 pb-20 pt-12 text-center text-watch-50 md:px-10">
        <WordmarkStacked size={120} className="mx-auto" />
        <h1 className="mx-auto mt-8 max-w-3xl font-display text-3xl font-bold leading-tight md:text-5xl">
          Run your training academy without the spreadsheets.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-watch-300 md:text-lg">
          HEIMDALL is the scheduling, roster, and records platform for law-enforcement and corrections
          training academies — purpose-built around the Florida CMS recruit program.
        </p>
        <div className="mt-8 flex justify-center">
          <CTAButtons center />
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-5 py-16 md:px-10">
        <h2 className="text-center font-display text-2xl font-bold md:text-3xl">Everything an academy office needs</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-watch-100 bg-watch-50/40 p-5">
              <h3 className="font-semibold text-watch-900">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="bg-watch-50 px-5 py-16 md:px-10">
        <div className="mx-auto max-w-xl text-center">
          <h2 className="font-display text-2xl font-bold md:text-3xl">Simple, flat pricing</h2>
          <p className="mt-3 text-sm text-slate-600">
            One subscription per organization — every coordinator, instructor, and cadet record included.
          </p>
          <div className="mt-8 rounded-2xl border border-watch-200 bg-white p-8 shadow-sm">
            <div className="text-3xl font-bold text-watch-900">{PRICE_LABEL}</div>
            <ul className="mx-auto mt-6 max-w-sm space-y-2 text-left text-sm text-slate-700">
              {['Unlimited staff & instructor accounts', 'Unlimited academies & cadets', 'Document builder + FDLE curricula', 'Email + in-app notifications', 'Cancel anytime'].map((li) => (
                <li key={li} className="flex items-start gap-2">
                  <span aria-hidden className="mt-0.5 text-bifrost-600">✓</span>
                  <span>{li}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8 flex justify-center">
              <CTAButtons center />
            </div>
            <p className="mt-4 text-xs text-slate-400">
              Start your account, then activate billing from <strong>Admin → Billing</strong>. Payments are handled
              securely by Stripe — HEIMDALL never sees your card details.
            </p>
          </div>
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
