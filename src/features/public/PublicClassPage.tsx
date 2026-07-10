/**
 * Public class portal — /class/:academyId/:token (NO sign-in). All data comes
 * from the getPublicClassPortal callable, which validates the link token and
 * the tier passwords server-side; Firestore rules stay fully closed.
 *
 *   Tier 1 (access code = the digits of the class, "LE 132" → 132):
 *     the cadet schedule, day by day — no cover page, no week overview —
 *     printable from the page.
 *   Tier 2 ("Academic information", coordinator-set password):
 *     read-only gradebook + discipline (only cadets WITH entries).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import type { CurriculumCourse, RosterMemberDoc, ViolationEntry } from '../../types';
import {
  courseKey, courseResult, effectiveScore, gradedCourses, lastFirst, memberStanding, resultClasses, rosterCompare,
  disciplineTally,
} from '../cadre/roster/rosterShared';
import { GjallarhornGlyph } from '../../brand/Logo';

interface PortalSession {
  title: string; startMs: number; endMs: number; room: string; hours: number;
  highLiability: boolean; notes: string; kind: string | null; leadNames: string[];
}
interface ScheduleData {
  kind: 'schedule'; className: string; name: string; program: string;
  startMs: number | null; endMs: number | null; academicAvailable: boolean; sessions: PortalSession[];
}
interface AcademicMember {
  id: string; fullName: string; status: string; no: number; blockTaker: boolean;
  grades: Record<string, unknown>; withdrawnAfterCourse: string | null;
  violations: { dateMs: number; type: string; level: string }[];
}
interface AcademicData { kind: 'academic'; className: string; members: AcademicMember[]; courses: CurriculumCourse[] }

const call = httpsCallable(functions, 'getPublicClassPortal');

const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
const fmtDay = (k: string) => new Date(`${k}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

/** Full-screen gate card (both tiers) — the "fancy modern password" screen. */
function Gate({ title, subtitle, placeholder, busy, error, onSubmit, inputMode }: {
  title: string; subtitle: string; placeholder: string; busy: boolean; error: string | null;
  onSubmit: (value: string) => void; inputMode?: 'numeric';
}) {
  const [value, setValue] = useState('');
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-watch-950 px-4">
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{
        background: 'radial-gradient(600px 300px at 50% -40px, rgba(231,173,51,0.16), transparent 70%), radial-gradient(900px 420px at 50% 110%, rgba(74,98,150,0.25), transparent 70%)',
      }} />
      <form
        className="relative w-full max-w-sm rounded-2xl border border-watch-800 bg-watch-900/80 p-8 text-center shadow-2xl backdrop-blur"
        onSubmit={(e) => { e.preventDefault(); if (value.trim()) onSubmit(value.trim()); }}
      >
        <GjallarhornGlyph size={40} className="mx-auto text-bifrost-400" title="HEIMDALL" />
        <h1 className="mt-4 font-display text-xl font-bold text-watch-50">{title}</h1>
        <p className="mt-1 text-sm text-watch-300">{subtitle}</p>
        <input
          autoFocus
          type={inputMode === 'numeric' ? 'text' : 'password'}
          inputMode={inputMode}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="mt-5 w-full rounded-lg border border-watch-700 bg-watch-950 px-4 py-3 text-center text-lg font-semibold tracking-[0.3em] text-watch-50 placeholder:font-normal placeholder:tracking-normal placeholder:text-watch-500 focus:border-bifrost-400 focus:outline-none"
        />
        {error && <p className="mt-3 text-sm font-medium text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="mt-5 w-full rounded-lg bg-bifrost-500 px-4 py-3 text-sm font-semibold text-watch-950 transition-colors hover:bg-bifrost-400 disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'View class'}
        </button>
        <p className="mt-6 text-[11px] uppercase tracking-[0.2em] text-watch-500">HEIMDALL · Class Portal</p>
      </form>
    </div>
  );
}

export function PublicClassPage() {
  const { academyId = '', token = '' } = useParams();
  const [code, setCode] = useState('');
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [academic, setAcademic] = useState<AcademicData | null>(null);
  const [showAcademicGate, setShowAcademicGate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Public page: keep it out of search indexes.
  useEffect(() => {
    const m = document.createElement('meta');
    m.name = 'robots';
    m.content = 'noindex, nofollow';
    document.head.appendChild(m);
    return () => { document.head.removeChild(m); };
  }, []);

  async function enter(value: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await call({ academyId, token, code: value, tier: 'schedule' });
      setSchedule(res.data as ScheduleData);
      setCode(value);
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^.*?:\s*/, '') : 'Could not open the class.');
    } finally {
      setBusy(false);
    }
  }

  async function enterAcademic(value: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await call({ academyId, token, code, tier: 'academic', academicPassword: value });
      setAcademic(res.data as AcademicData);
      setShowAcademicGate(false);
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^.*?:\s*/, '') : 'Could not open academic information.');
    } finally {
      setBusy(false);
    }
  }

  const days = useMemo(() => {
    if (!schedule) return [];
    const map = new Map<string, PortalSession[]>();
    for (const s of schedule.sessions) {
      const k = dayKey(s.startMs);
      (map.get(k) ?? map.set(k, []).get(k)!).push(s);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [schedule]);

  if (!schedule) {
    return (
      <Gate
        title="Class Portal"
        subtitle="Enter the class access code to view the training schedule."
        placeholder="Access code"
        inputMode="numeric"
        busy={busy}
        error={error}
        onSubmit={enter}
      />
    );
  }

  if (showAcademicGate) {
    return (
      <Gate
        title="Academic information"
        subtitle={`${schedule.className} — this section requires the academic password from your coordinator.`}
        placeholder="Academic password"
        busy={busy}
        error={error}
        onSubmit={enterAcademic}
      />
    );
  }

  const range =
    schedule.startMs && schedule.endMs
      ? `${new Date(schedule.startMs).toLocaleDateString()} – ${new Date(schedule.endMs).toLocaleDateString()}`
      : '';

  return (
    <div className="min-h-screen bg-watch-50">
      {/* Screen-only header */}
      <header className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-watch-800 bg-watch-950 px-5 py-3">
        <div className="flex items-center gap-2 text-watch-50">
          <GjallarhornGlyph size={22} className="text-bifrost-400" title="HEIMDALL" />
          <span className="font-display font-bold">{schedule.className}</span>
          <span className="hidden text-sm text-watch-300 sm:inline">· {schedule.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {academic ? (
            <button className="rounded-md border border-watch-700 px-3 py-1.5 text-sm font-medium text-watch-100 hover:bg-watch-800" onClick={() => setAcademic(null)}>
              ← Schedule
            </button>
          ) : (
            <>
              {schedule.academicAvailable && (
                <button
                  className="rounded-md border border-watch-700 px-3 py-1.5 text-sm font-medium text-watch-100 hover:bg-watch-800"
                  onClick={() => { setError(null); setShowAcademicGate(true); }}
                >
                  Academic information
                </button>
              )}
              <button className="rounded-md bg-bifrost-500 px-3 py-1.5 text-sm font-semibold text-watch-950 hover:bg-bifrost-400" onClick={() => window.print()}>
                Print schedule
              </button>
            </>
          )}
        </div>
      </header>

      {academic ? (
        <AcademicView data={academic} />
      ) : (
        <main className="mx-auto max-w-3xl px-4 py-6">
          <div className="mb-4">
            <h1 className="font-display text-xl font-bold text-watch-900">{schedule.name}</h1>
            <p className="text-sm text-slate-600">{schedule.program}{range ? ` · ${range}` : ''}</p>
          </div>
          <div className="space-y-3">
            {days.map(([k, items]) => {
              const dayHours = Math.round(items.reduce((n, s) => n + (s.kind === 'lunch' ? 0 : s.hours), 0) * 4) / 4;
              return (
                <section key={k} className="day-card overflow-hidden rounded-lg border border-watch-200 bg-white shadow-sm">
                  <div className="flex items-baseline justify-between bg-watch-900 px-4 py-1.5 text-watch-50">
                    <h2 className="text-sm font-bold">{fmtDay(k)}</h2>
                    <span className="text-xs opacity-75">{dayHours} hrs</span>
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {items.map((s, i) => (
                        <tr key={i} className="border-t border-watch-100 align-top first:border-t-0">
                          <td className="w-[6.2rem] whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-500">
                            {fmtTime(s.startMs)}–{fmtTime(s.endMs)}
                          </td>
                          <td className="px-2 py-2">
                            <span className={s.kind === 'lunch' ? 'text-slate-500' : 'font-semibold text-watch-900'}>
                              {s.kind === 'lunch' ? '🍴 ' : ''}{s.title}
                            </span>
                            {s.highLiability && <span className="ml-1.5 text-[10px] font-bold text-bifrost-600">▲</span>}
                            {s.leadNames.length > 0 && (
                              <div className="text-xs text-slate-500">Instructor: {s.leadNames.join(', ')}</div>
                            )}
                            {s.notes && <div className="text-xs italic text-slate-500">{s.notes}</div>}
                          </td>
                          <td className="w-28 px-2 py-2 text-right">
                            {s.room && <span className="inline-block rounded bg-watch-50 px-1.5 py-0.5 text-[11px] text-slate-600">{s.room}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              );
            })}
            {days.length === 0 && <p className="py-12 text-center text-sm text-slate-400">No schedule published yet.</p>}
          </div>
          <p className="no-print mt-6 text-center text-[11px] uppercase tracking-[0.2em] text-slate-400">
            HEIMDALL · Class Portal
          </p>
        </main>
      )}

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          .day-card { break-inside: avoid; box-shadow: none; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
    </div>
  );
}

/** Read-only gradebook + given-discipline view (tier 2). */
function AcademicView({ data }: { data: AcademicData }) {
  const graded = gradedCourses(data.courses);
  const idxById = new Map(graded.map((c, i) => [courseKey(c), i] as const));
  const members = useMemo(
    () =>
      data.members
        .filter((m) => !m.blockTaker)
        .sort((a, b) => rosterCompare(a as unknown as RosterMemberDoc, b as unknown as RosterMemberDoc)),
    [data.members]
  );
  // Discipline: ONLY cadets who actually have entries — no wall of zeros.
  const disciplined = members.filter((m) => m.violations.length > 0);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <h1 className="font-display text-xl font-bold text-watch-900">Academic information — {data.className}</h1>
      <p className="mt-1 text-sm text-slate-500">Read-only. Grades follow the FDLE rules (80% pass line; re-exam passes record as 80).</p>

      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wider text-watch-600">Gradebook</h2>
      <div className="overflow-x-auto rounded-lg border border-watch-200 bg-white shadow-sm">
        <table className="text-left text-sm">
          <thead className="bg-watch-50 text-xs uppercase tracking-wider text-watch-600">
            <tr>
              <th className="sticky left-0 z-10 bg-watch-50 px-3 py-2">Cadet</th>
              <th className="px-2 py-2 text-center">Avg</th>
              {graded.map((c) => (
                <th key={c.name} className="px-2 py-2 text-center" title={c.name}>
                  <span className="inline-block max-w-[5rem] truncate align-bottom">{c.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-watch-50">
            {members.map((raw) => {
              const m = raw as unknown as RosterMemberDoc;
              const standing = memberStanding(m, data.courses);
              return (
                <tr key={raw.id} className={raw.status === 'withdrawn' || raw.status === 'dismissed' ? 'opacity-60' : ''}>
                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-watch-900">{lastFirst(raw.fullName)}</td>
                  <td className="px-2 py-2 text-center font-semibold">{standing.letter ?? '—'}</td>
                  {graded.map((c, i) => {
                    const res = courseResult(m, c, idxById, i);
                    const eff = effectiveScore(m.grades?.[courseKey(c)]);
                    const label = res === 'pending' ? (eff != null ? String(eff) : '—')
                      : res === 'pass' || res === 'fail' ? String(eff ?? res)
                      : res.toUpperCase();
                    return (
                      <td key={c.name} className="px-1 py-1 text-center">
                        <span className={`inline-block min-w-[3rem] rounded px-2 py-1 text-xs ${resultClasses(res)}`}>{label}</span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-wider text-watch-600">Discipline</h2>
      {disciplined.length === 0 ? (
        <p className="rounded-lg border border-watch-200 bg-white px-4 py-6 text-center text-sm text-slate-500 shadow-sm">
          No discipline has been recorded for this class.
        </p>
      ) : (
        <div className="space-y-3">
          {disciplined.map((m) => {
            const t = disciplineTally(m.violations as unknown as ViolationEntry[]);
            return (
              <div key={m.id} className="rounded-lg border border-watch-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-medium text-watch-900">{lastFirst(m.fullName)}</span>
                  {t.warnings > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{t.warnings} warning{t.warnings === 1 ? '' : 's'}</span>}
                  {t.points > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">{t.points} demerit point{t.points === 1 ? '' : 's'}</span>}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[...m.violations].sort((a, b) => a.dateMs - b.dateMs).map((v, i) => (
                    <span key={i} className="rounded-full bg-watch-50 px-2 py-0.5 text-xs ring-1 ring-inset ring-watch-200">
                      <span className="text-slate-500">{new Date(v.dateMs).toLocaleDateString()}</span>{' '}
                      <span className="font-medium text-watch-800">{v.type}</span>{' '}
                      <span className={v.level === 'warning' ? 'text-amber-700' : 'text-red-700'}>
                        · {v.level === 'warning' ? 'Warning' : `Demerit ${v.level}`}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
