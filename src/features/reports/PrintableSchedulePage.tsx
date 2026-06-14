/**
 * Printable academy schedule — a branded, PDF-ready document with two modes:
 *
 *   • Cadet schedule   — the clean training calendar handed to recruits: what
 *                        happens each day (times, courses, rooms, hours). The
 *                        coordinator-only "PSO Assignment" pay blocks are hidden.
 *   • Staff & staffing — the operational copy for instructors/coordinators:
 *                        the same calendar plus every role slot and who fills it,
 *                        with open slots flagged.
 *
 * Rendered outside the app shell; an injected print stylesheet sets letter-size
 * margins, forces brand colors to print, and keeps day cards from splitting
 * across pages.
 */
import React, { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { orderBy, where } from 'firebase/firestore';
import { useCollection, useDoc, type WithId } from '../../lib/firestore';
import { useGlobalSettings } from '../../app/providers';
import type { AcademyDoc, SessionDoc, UserDoc } from '../../types';
import { SLOT_ROLE_LABELS } from '../../types';
import { WordmarkHorizontal } from '../../brand/Logo';
import { Button } from '../../components/ui';

const TZ = 'America/New_York';
const NAVY_FALLBACK = '#16203a';
const AMBER_FALLBACK = '#d99320';
const PSO_BLOCK = 'PSO Assignment'; // coordinator pay-filler — hidden from cadets

type Mode = 'cadet' | 'staff';

const t = (d: Date) => d.toLocaleTimeString('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const localKey = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
function mondayOf(d: Date) {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export function PrintableSchedulePage() {
  const { academyId } = useParams<{ academyId: string }>();
  const settings = useGlobalSettings();
  const { data: academy } = useDoc<AcademyDoc>(academyId ? `academies/${academyId}` : null);
  const { data: sessions } = useCollection<SessionDoc>(
    academyId ? 'sessions' : null,
    [where('academyId', '==', academyId ?? ''), orderBy('start')],
    [academyId]
  );
  const { data: users } = useCollection<UserDoc>('users');
  const [mode, setMode] = useState<Mode>('staff');

  const navy = settings?.brandPrimaryColor || NAVY_FALLBACK;
  const amber = settings?.brandAccentColor || AMBER_FALLBACK;

  const nameFor = useMemo(() => {
    const m = new Map(users.map((u) => [u.id, u.displayName]));
    return (uid: string) => m.get(uid) ?? 'Unassigned';
  }, [users]);

  // Visible sessions for this mode, grouped day → week.
  const weeks = useMemo(() => {
    const visible = sessions.filter(
      (s) => s.status !== 'cancelled' && (mode === 'staff' || s.courseName !== PSO_BLOCK)
    );
    const dayMap = new Map<string, WithId<SessionDoc>[]>();
    for (const s of visible) {
      const k = localKey(s.start.toDate());
      (dayMap.get(k) ?? dayMap.set(k, []).get(k)!).push(s);
    }
    const days = [...dayMap.keys()].sort().map((k) => ({
      date: new Date(`${k}T12:00:00`),
      sessions: dayMap.get(k)!.sort((a, b) => a.start.toMillis() - b.start.toMillis()),
    }));
    const weekMap = new Map<string, typeof days>();
    for (const d of days) {
      const wk = localKey(mondayOf(d.date));
      (weekMap.get(wk) ?? weekMap.set(wk, []).get(wk)!).push(d);
    }
    return [...weekMap.keys()].sort().map((wk, i) => ({ index: i + 1, days: weekMap.get(wk)! }));
  }, [sessions, mode]);

  const stats = useMemo(() => {
    const days = weeks.reduce((n, w) => n + w.days.length, 0);
    const hours = weeks.reduce((n, w) => n + w.days.reduce((m, d) => m + d.sessions.reduce((h, s) => h + s.hours, 0), 0), 0);
    return { days, hours: Math.round(hours * 4) / 4, weeks: weeks.length };
  }, [weeks]);

  if (!academy) return null;
  const docType = mode === 'cadet' ? 'Cadet Training Schedule' : 'Staffing Schedule';
  const coordinators = (academy.coordinatorIds ?? []).map(nameFor).filter((n) => n !== 'Unassigned');

  const fmtRange = (d: Date) => d.toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });

  return (
    <div className="mx-auto max-w-[8.5in] bg-white text-[#1f2a45]">
      <style>{PRINT_CSS}</style>

      {/* ── Screen-only control bar ─────────────────────────────────────── */}
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3">
        <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
          {(['cadet', 'staff'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-4 py-1.5 text-sm font-medium ${mode === m ? 'text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              style={mode === m ? { backgroundColor: navy } : undefined}
            >
              {m === 'cadet' ? 'Cadet schedule' : 'Staff & staffing'}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-500">
          {mode === 'cadet' ? 'Clean recruit copy — PSO blocks hidden.' : 'Operational copy — every slot + who fills it.'}
        </span>
        <Button variant="primary" onClick={() => window.print()}>
          Print / Save as PDF
        </Button>
      </div>

      <div className="px-[0.5in] pb-12 pt-[0.4in]">
        {/* ── Masthead ──────────────────────────────────────────────────── */}
        <header className="mb-5">
          <div className="flex items-center justify-between px-5 py-3" style={{ backgroundColor: navy }}>
            <WordmarkHorizontal size={24} className="text-white" />
            <div className="text-right text-white">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: amber }}>
                {docType}
              </div>
              <div className="text-[10px] uppercase tracking-[0.18em] opacity-80">{settings?.orgName ?? 'Training Academy'}</div>
            </div>
          </div>
          <div className="border-x border-b border-slate-200 px-5 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: amber }}>
              {academy.shortName ?? academy.discipline}
            </div>
            <h1 className="mt-0.5 text-2xl font-bold" style={{ color: navy }}>
              {academy.name}
            </h1>
            <div className="text-sm text-slate-600">{academy.fdleProgram}</div>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-4">
              <Meta label="Dates">
                {academy.startDate.toDate().toLocaleDateString('en-US', { timeZone: TZ, dateStyle: 'medium' })} –{' '}
                {academy.endDate.toDate().toLocaleDateString('en-US', { timeZone: TZ, dateStyle: 'medium' })}
              </Meta>
              <Meta label="Span">{stats.weeks} weeks · {stats.days} class days</Meta>
              <Meta label="Hours">
                {stats.hours} {mode === 'cadet' ? 'instructional' : `/ ${academy.targetTotalHours} program`} hrs
              </Meta>
              <Meta label="Location">{academy.location}</Meta>
            </div>
            {mode === 'staff' && coordinators.length > 0 && (
              <div className="mt-2 text-sm">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Coordinators</span>{' '}
                <span className="text-slate-700">{coordinators.join(' · ')}</span>
              </div>
            )}
          </div>
          <div className="h-1" style={{ backgroundColor: amber }} />
          {mode === 'staff' && (
            <div className="mt-2 text-[11px] text-slate-500">
              <span className="font-semibold uppercase tracking-wider">Legend</span> — names fill role slots;{' '}
              <span className="font-semibold" style={{ color: amber }}>OPEN</span> = unfilled · ▲ = high-liability course
            </div>
          )}
        </header>

        {/* ── Weeks → days ──────────────────────────────────────────────── */}
        {weeks.map((w) => {
          const first = w.days[0].date;
          const last = w.days[w.days.length - 1].date;
          return (
            <div key={w.index} className="mb-3">
              <div
                className="week-head flex items-baseline justify-between px-4 py-1.5 text-white"
                style={{ backgroundColor: navy }}
              >
                <span className="text-xs font-bold uppercase tracking-[0.18em]">Week {w.index}</span>
                <span className="text-[11px] opacity-80">
                  {fmtRange(first)} – {fmtRange(last)}
                </span>
              </div>
              {w.days.map((d) => {
                const dayHours = Math.round(d.sessions.reduce((n, s) => n + s.hours, 0) * 4) / 4;
                return (
                  <section
                    key={d.date.toISOString()}
                    className="day-card border-x border-b border-slate-200"
                    style={{ borderLeft: `3px solid ${academy.color || navy}` }}
                  >
                    <div className="flex items-baseline justify-between bg-slate-50 px-4 py-1">
                      <h3 className="text-sm font-bold" style={{ color: navy }}>
                        {d.date.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' })}
                      </h3>
                      <span className="text-[11px] font-medium text-slate-400">{dayHours} hrs</span>
                    </div>
                    <table className="w-full border-collapse text-sm">
                      <tbody>
                        {d.sessions.map((s) => (
                          <tr key={s.id} className="border-t border-slate-100 align-top">
                            <td className="w-[5.5rem] whitespace-nowrap px-4 py-1.5 font-mono text-xs text-slate-500">
                              {t(s.start.toDate())}–{t(s.end.toDate())}
                            </td>
                            <td className="px-2 py-1.5">
                              <span className="font-semibold text-[#1f2a45]">{s.title || s.courseName}</span>
                              {s.highLiability && <span className="ml-2 align-middle text-[10px] font-bold" style={{ color: amber }}>▲</span>}
                              {mode === 'staff' && (
                                <div className="mt-0.5 space-y-0.5">
                                  {s.roleSlots.map((sl) => {
                                    const filled = sl.filledBy.map(nameFor);
                                    const open = sl.count - sl.filledBy.length;
                                    return (
                                      <div key={sl.slotId} className="text-[11px] leading-tight text-slate-600">
                                        <span className="font-semibold text-slate-500">{SLOT_ROLE_LABELS[sl.role]}:</span>{' '}
                                        {filled.join(', ')}
                                        {filled.length > 0 && open > 0 ? ', ' : ''}
                                        {open > 0 && <span className="font-semibold" style={{ color: amber }}>{open} OPEN</span>}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </td>
                            <td className="w-32 px-2 py-1.5 text-xs text-slate-500">{s.room}</td>
                            <td className="w-12 px-4 py-1.5 text-right text-xs font-medium text-slate-500">{s.hours}h</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                );
              })}
            </div>
          );
        })}

        {weeks.length === 0 && (
          <p className="py-16 text-center text-sm text-slate-400">No sessions scheduled.</p>
        )}

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <footer className="mt-8 flex items-center justify-between border-t border-slate-300 pt-3 text-[11px] text-slate-400">
          <span>
            {academy.shortName ? `${academy.shortName} · ` : ''}
            {academy.name} — {docType}
          </span>
          <span>
            Generated {new Date().toLocaleDateString('en-US', { timeZone: TZ, dateStyle: 'medium' })} · Sounded by Gjallarhorn · HEIMDALL
          </span>
        </footer>
      </div>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-slate-700">{children}</div>
    </div>
  );
}

const PRINT_CSS = `
  @media print {
    @page { size: letter; margin: 0.5in 0.45in 0.6in; }
    .no-print { display: none !important; }
    html, body { background: #ffffff !important; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .day-card { break-inside: avoid; }
    .week-head { break-after: avoid-page; }
  }
  .day-card { break-inside: avoid; }
`;
