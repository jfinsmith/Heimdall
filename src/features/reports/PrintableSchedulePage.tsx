/**
 * Printable academy schedule — a branded, PDF-ready document with two modes:
 *
 *   • Cadet schedule   — the clean training calendar handed to recruits: what
 *                        happens each day (times, courses, rooms, hours, lead
 *                        instructor). Coordinator-only "PSO Assignment" pay
 *                        blocks are hidden.
 *   • Staff & staffing — the operational copy for instructors/coordinators:
 *                        the same calendar plus every role slot and who fills it,
 *                        with open slots flagged.
 *
 * Document structure: a branded cover page, a week-at-a-glance overview grid,
 * then the day-by-day schedule. A fixed running footer (+ page numbers where
 * the print engine supports @page counters) brands every sheet. Rendered
 * outside the app shell; the injected print stylesheet sets letter margins,
 * forces brand colors to print, and keeps day cards from splitting across pages.
 */
import React, { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { orderBy, where } from 'firebase/firestore';
import { useCollection, useDoc, type WithId } from '../../lib/firestore';
import { useCurriculum } from '../../lib/curricula';
import { useGlobalSettings } from '../../app/providers';
import type { AcademyDoc, SessionDoc, UserDoc } from '../../types';
import { SLOT_ROLE_LABELS } from '../../types';
import { WordmarkHorizontal } from '../../brand/Logo';
import { OrgLogo } from '../../brand/OrgLogo';
import { Button } from '../../components/ui';
import { sessionFlag, type SessionFlag } from '../cadre/sessionEvents';
import { holidaysForYear } from '../../lib/holidays';

const TZ = 'America/New_York';
const NAVY_FALLBACK = '#16203a';
const AMBER_FALLBACK = '#d99320';
const PSO_BLOCK = 'PSO Assignment'; // coordinator pay-filler — hidden from cadets
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

// Same highlight rules as the live calendar: test → red, scenario → green, PT → amber.
const FLAG_STYLE: Record<SessionFlag, { color: string; label: string }> = {
  test: { color: '#dc2626', label: 'Test' },
  scenario: { color: '#16a34a', label: 'Scenario' },
  pt: { color: '#ca8a04', label: 'PT' },
};

type Mode = 'cadet' | 'staff';
type Day = { date: Date; sessions: WithId<SessionDoc>[]; holiday?: string };

const t = (d: Date) => d.toLocaleTimeString('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const localKey = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const weekdayIdx = (d: Date) => (d.getDay() + 6) % 7; // Mon=0 … Sun=6
function mondayOf(d: Date) {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  x.setDate(x.getDate() - weekdayIdx(x));
  return x;
}
/** The day's headline course — the longest non-formation, non-PSO block. */
function primaryOf(sessions: WithId<SessionDoc>[]) {
  const pool = sessions.filter((s) => s.courseName !== 'Formation' && s.courseName !== PSO_BLOCK);
  const from = pool.length ? pool : sessions;
  return from.reduce((a, b) => (b.hours > a.hours ? b : a), from[0]);
}

export function PrintableSchedulePage() {
  const { academyId } = useParams<{ academyId: string }>();
  const settings = useGlobalSettings();
  const { data: academy } = useDoc<AcademyDoc>(academyId ? `academies/${academyId}` : null);
  // The class's curriculum drives branding overrides (logo + org name) on the
  // printed cover/footer, falling back to org settings — same as DocumentHeader.
  const { data: curriculum } = useCurriculum(academy?.discipline);
  const { data: sessions } = useCollection<SessionDoc>(
    academyId ? 'sessions' : null,
    [where('academyId', '==', academyId ?? ''), orderBy('start')],
    [academyId]
  );
  const { data: users } = useCollection<UserDoc>('users');
  const [mode, setMode] = useState<Mode>('staff');
  const [showCover, setShowCover] = useState(true);
  const [showOverview, setShowOverview] = useState(true);

  const navy = settings?.brandPrimaryColor || NAVY_FALLBACK;
  const amber = settings?.brandAccentColor || AMBER_FALLBACK;
  const accent = academy?.color || navy;

  const nameFor = useMemo(() => {
    const m = new Map(users.map((u) => [u.id, u.displayName]));
    return (uid: string) => m.get(uid) ?? 'Unassigned';
  }, [users]);
  const leadOf = (s: WithId<SessionDoc>) =>
    [
      ...s.roleSlots.filter((sl) => sl.role === 'lead').flatMap((sl) => sl.filledBy).map(nameFor),
      ...(s.writeInInstructors ?? []).filter((w) => w.role === 'lead').map((w) => w.name),
    ].join(', ');

  const disabledHolidays = useMemo(() => new Set(settings?.disabledHolidays ?? []), [settings]);

  const weeks = useMemo(() => {
    const visible = sessions.filter(
      (s) => s.status !== 'cancelled' && (mode === 'staff' || s.courseName !== PSO_BLOCK)
    );
    const dayMap = new Map<string, WithId<SessionDoc>[]>();
    for (const s of visible) {
      const k = localKey(s.start.toDate());
      (dayMap.get(k) ?? dayMap.set(k, []).get(k)!).push(s);
    }
    // Enabled (non-disabled) holidays within the academy window — surfaced on the
    // printout even when no class is scheduled that day.
    const holidayMap = new Map<string, string>();
    if (academy) {
      const startK = localKey(academy.startDate.toDate());
      const endK = localKey(academy.endDate.toDate());
      // Year-1 like the builder: a winter break whose January days belong to the
      // PREVIOUS year's holiday set still shows at an academy's start.
      for (let y = academy.startDate.toDate().getFullYear() - 1; y <= academy.endDate.toDate().getFullYear(); y++) {
        for (const h of holidaysForYear(y, disabledHolidays)) {
          // Weekdays only — a Saturday July 4th isn't a training day to annotate.
          if (weekdayIdx(h.date) > 4) continue;
          const hk = localKey(h.date);
          if (hk >= startK && hk <= endK) holidayMap.set(hk, h.name);
        }
      }
    }
    const allKeys = [...new Set([...dayMap.keys(), ...holidayMap.keys()])];
    const days: Day[] = allKeys.sort().map((k) => ({
      date: new Date(`${k}T12:00:00`),
      sessions: (dayMap.get(k) ?? []).sort((a, b) => a.start.toMillis() - b.start.toMillis()),
      holiday: holidayMap.get(k),
    }));
    const weekMap = new Map<string, Day[]>();
    for (const d of days) {
      const wk = localKey(mondayOf(d.date));
      (weekMap.get(wk) ?? weekMap.set(wk, []).get(wk)!).push(d);
    }
    // Weeks are numbered by TRAINING weeks: a holiday-only week (winter break)
    // must not mint a phantom "Week N" and shift every later week number.
    return [...weekMap.keys()]
      .sort()
      .map((wk) => ({ monday: new Date(`${wk}T12:00:00`), days: weekMap.get(wk)! }))
      .filter((w) => w.days.some((d) => d.sessions.length > 0))
      .map((w, i) => ({ index: i + 1, ...w }));
  }, [sessions, mode, academy, disabledHolidays]);

  const stats = useMemo(() => {
    const days = weeks.reduce((n, w) => n + w.days.filter((d) => d.sessions.length > 0).length, 0);
    return { days, weeks: weeks.length };
  }, [weeks]);

  if (!academy) return null;
  const docType = mode === 'cadet' ? 'Cadet Training Schedule' : 'Staffing Schedule';
  const orgName = curriculum?.brandOrgName || settings?.orgName || 'Training Academy';
  const coordinators = (academy.coordinatorIds ?? []).map(nameFor).filter((n) => n !== 'Unassigned');
  const fmtShort = (d: Date) => d.toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
  const fmtMed = (d: Date) => d.toLocaleDateString('en-US', { timeZone: TZ, dateStyle: 'medium' });
  const dateRange = `${fmtMed(academy.startDate.toDate())} – ${fmtMed(academy.endDate.toDate())}`;

  return (
    <div className="mx-auto max-w-[8.5in] bg-white text-[#1f2a45]">
      <style>{printCss(navy, amber)}</style>

      {/* ── Screen-only control bar ─────────────────────────────────────── */}
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex flex-wrap items-center gap-4">
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
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" checked={showCover} onChange={(e) => setShowCover(e.target.checked)} /> Cover page
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" checked={showOverview} onChange={(e) => setShowOverview(e.target.checked)} /> Week overview
          </label>
        </div>
        <Button variant="primary" onClick={() => window.print()}>
          Print / Save as PDF
        </Button>
      </div>

      <div className="content px-[0.45in] pb-12 pt-[0.4in]">
        {/* ── Cover page ────────────────────────────────────────────────── */}
        {showCover && (
          <section className="page-break flex flex-col items-center justify-center text-center" style={{ minHeight: '9in' }}>
            <div className="h-1.5 w-24" style={{ backgroundColor: amber }} />
            <div className="my-8">
              {curriculum?.brandLogoUrl ? (
                <img src={curriculum.brandLogoUrl} alt="" style={{ height: 150, width: 'auto', maxWidth: 280, objectFit: 'contain' }} />
              ) : (
                <OrgLogo size={150} fallback="stacked" />
              )}
            </div>
            <div className="text-sm uppercase tracking-[0.3em] text-slate-500">{orgName}</div>
            <div className="mt-10 text-base font-semibold uppercase tracking-[0.35em]" style={{ color: amber }}>
              {academy.shortName ?? academy.discipline}
            </div>
            <h1 className="mt-1 text-5xl font-bold" style={{ color: navy }}>
              {academy.name}
            </h1>
            <div className="mt-2 max-w-xl text-sm text-slate-600">{academy.fdleProgram}</div>
            <div className="mx-auto my-8 h-px w-40" style={{ backgroundColor: amber }} />
            <div className="text-lg font-semibold uppercase tracking-[0.18em]" style={{ color: navy }}>
              {docType}
            </div>
            <div className="mt-6 grid grid-cols-2 gap-x-12 gap-y-2 text-sm">
              <CoverMeta label="Dates" value={dateRange} />
              <CoverMeta label="Span" value={`${stats.weeks} weeks · ${stats.days} class days`} />
              <CoverMeta label="Program hours" value={`${academy.targetTotalHours} hrs`} />
              <CoverMeta label="Location" value={academy.location} />
            </div>
            {mode === 'staff' && coordinators.length > 0 && (
              <div className="mt-6 text-sm">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Coordinators</span>
                <div className="text-slate-700">{coordinators.join(' · ')}</div>
              </div>
            )}
            <div className="mt-12 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-slate-400">
              <span style={{ color: amber }}>◆</span> HEIMDALL <span style={{ color: amber }}>◆</span>
            </div>
          </section>
        )}

        {/* ── Week-at-a-glance overview ─────────────────────────────────── */}
        {showOverview && weeks.length > 0 && (
          <section className="page-break mb-6">
            <SectionHead navy={navy} amber={amber} title="Week-at-a-glance" academy={academy} docType={docType} />
            <table className="w-full table-fixed border-collapse text-sm">
              <thead>
                <tr>
                  <th className="w-[1.6in] border border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Week
                  </th>
                  {WEEKDAYS.map((wd) => (
                    <th key={wd} className="border border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      {wd}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => (
                  <tr key={w.index} className="ov-row align-top">
                    <td className="border border-slate-200 px-2 py-1.5" style={{ borderLeft: `3px solid ${accent}` }}>
                      <div className="text-xs font-bold" style={{ color: navy }}>
                        Week {w.index}
                      </div>
                      <div className="text-[10px] text-slate-400">{fmtShort(w.monday)}</div>
                    </td>
                    {WEEKDAYS.map((_, wd) => {
                      const day = w.days.find((d) => weekdayIdx(d.date) === wd);
                      if (!day) return <td key={wd} className="border border-slate-200 bg-slate-50/40" />;
                      if (day.sessions.length === 0) {
                        return (
                          <td key={wd} className="border border-slate-200 bg-amber-50/60 px-2 py-1.5 align-top">
                            <div className="text-[10px] font-semibold leading-tight text-amber-800">{day.holiday}</div>
                            <div className="text-[10px] text-slate-400">{day.date.getDate()}</div>
                          </td>
                        );
                      }
                      const p = primaryOf(day.sessions);
                      const hl = day.sessions.some((s) => s.highLiability);
                      return (
                        <td key={wd} className="border border-slate-200 px-2 py-1.5">
                          <div className="text-[11px] font-medium leading-tight text-[#1f2a45]">
                            {p.title || p.courseName}
                            {hl && <span className="ml-1 text-[9px] font-bold" style={{ color: amber }}>▲</span>}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {day.date.getDate()} · {Math.round(day.sessions.reduce((n, s) => n + s.hours, 0) * 4) / 4}h
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* ── Daily schedule ────────────────────────────────────────────── */}
        <SectionHead navy={navy} amber={amber} title="Daily schedule" academy={academy} docType={docType} />
        <div className="mb-2 text-[11px] text-slate-500">
          <span className="font-semibold uppercase tracking-wider">Each row</span> — time · course · room · hours.
          {mode === 'staff' && (
            <> Names fill role slots; <span className="font-semibold" style={{ color: amber }}>OPEN</span> = unfilled.</>
          )}{' '}
          ▲ = high-liability course.{' '}
          <span className="font-semibold" style={{ color: FLAG_STYLE.test.color }}>Test</span> ·{' '}
          <span className="font-semibold" style={{ color: FLAG_STYLE.scenario.color }}>Scenario</span> ·{' '}
          <span className="font-semibold" style={{ color: FLAG_STYLE.pt.color }}>PT</span> blocks are flagged.
        </div>

        {weeks.map((w) => (
          <div key={w.index} className="mb-3">
            <div className="week-head flex items-baseline justify-between px-4 py-1.5 text-white" style={{ backgroundColor: navy }}>
              <span className="text-xs font-bold uppercase tracking-[0.18em]">Week {w.index}</span>
              <span className="text-[11px] opacity-80">
                {fmtShort(w.days[0].date)} – {fmtShort(w.days[w.days.length - 1].date)}
              </span>
            </div>
            {w.days.map((d) => {
              const dayHours = Math.round(d.sessions.reduce((n, s) => n + s.hours, 0) * 4) / 4;
              return (
                <section key={d.date.toISOString()} className="day-card border-x border-b border-slate-200" style={{ borderLeft: `3px solid ${accent}` }}>
                  <div className="flex items-baseline justify-between bg-slate-50 px-4 py-1">
                    <h3 className="text-sm font-bold" style={{ color: navy }}>
                      {d.date.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' })}
                    </h3>
                    <span className="text-[11px] font-medium text-slate-400">{d.sessions.length > 0 ? `${dayHours} hrs` : 'Holiday'}</span>
                  </div>
                  {d.holiday && (
                    <div className="border-t border-amber-200 bg-amber-50 px-4 py-1 text-[11px] font-semibold text-amber-800">
                      🏛 {d.holiday}{d.sessions.length === 0 ? ' — no scheduled training' : ''}
                    </div>
                  )}
                  {d.sessions.length > 0 && (
                  <table className="w-full border-collapse text-sm">
                    <tbody>
                      {d.sessions.map((s) => {
                        const lead = leadOf(s);
                        const flag = sessionFlag(s);
                        const flagStyle = flag ? FLAG_STYLE[flag] : null;
                        return (
                          <tr key={s.id} className="border-t border-slate-100 align-top">
                            <td className="w-[5.4rem] whitespace-nowrap px-4 py-1.5 font-mono text-xs text-slate-500" style={flagStyle ? { borderLeft: `3px solid ${flagStyle.color}` } : undefined}>
                              {t(s.start.toDate())}–{t(s.end.toDate())}
                            </td>
                            <td className="px-2 py-1.5">
                              <span className="font-semibold text-[#1f2a45]">{s.title || s.courseName}</span>
                              {s.highLiability && <span className="ml-2 align-middle text-[10px] font-bold" style={{ color: amber }}>▲</span>}
                              {flagStyle && <span className="ml-2 rounded px-1 align-middle text-[9px] font-bold uppercase text-white" style={{ backgroundColor: flagStyle.color }}>{flagStyle.label}</span>}
                              {mode === 'cadet' && lead && <div className="mt-0.5 text-[11px] text-slate-500">Instructor: {lead}</div>}
                              {mode === 'staff' && (s.writeInInstructors ?? []).length > 0 && (
                                <div className="mt-0.5 text-[11px] leading-tight text-slate-600">
                                  <span className="font-semibold text-slate-500">Write-in:</span>{' '}
                                  {(s.writeInInstructors ?? []).map((w) => `${w.name} (${w.role.replace('_', ' ')})`).join(', ')}
                                </div>
                              )}
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
                              {s.notes && <div className="mt-0.5 text-[11px] italic leading-tight text-slate-500">{s.notes}</div>}
                            </td>
                            <td className="w-28 px-2 py-1.5">
                              {s.room && (
                                <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                                  {s.room}
                                </span>
                              )}
                            </td>
                            <td className="w-12 px-4 py-1.5 text-right text-xs font-medium text-slate-500">{s.hours}h</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  )}
                </section>
              );
            })}
          </div>
        ))}

        {weeks.length === 0 && <p className="py-16 text-center text-sm text-slate-400">No sessions scheduled.</p>}
      </div>

      {/* ── Fixed running footer (prints on every page) ───────────────────── */}
      <div className="run-foot items-center justify-between px-[0.45in] text-[10px] text-slate-400" style={{ borderTop: '0.5px solid #d4d8e0' }}>
        <span>
          {academy.shortName ? `${academy.shortName} · ` : ''}
          {academy.name} — {docType}
        </span>
        <span>{orgName} · HEIMDALL</span>
      </div>
    </div>
  );
}

function CoverMeta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="text-left">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-slate-700">{value}</div>
    </div>
  );
}

function SectionHead({
  navy,
  amber,
  title,
  academy,
  docType,
}: {
  navy: string;
  amber: string;
  title: string;
  academy: AcademyDoc;
  docType: string;
}) {
  return (
    <div className="section-head mb-2">
      <div className="flex items-center justify-between px-4 py-2" style={{ backgroundColor: navy }}>
        <WordmarkHorizontal size={20} className="text-white" subtitle={false} />
        <div className="text-right">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: amber }}>
            {title}
          </div>
          <div className="text-[9px] uppercase tracking-[0.16em] text-white opacity-70">
            {academy.shortName ? `${academy.shortName} · ` : ''}
            {docType}
          </div>
        </div>
      </div>
      <div className="h-1" style={{ backgroundColor: amber }} />
    </div>
  );
}

function printCss(navy: string, amber: string) {
  return `
    .run-foot { display: none; }
    .day-card, .ov-row { break-inside: avoid; }
    @media print {
      @page { size: letter; margin: 0.5in 0.45in 0.62in; @bottom-right { content: counter(page); color: ${navy}; font-size: 9px; } }
      .no-print { display: none !important; }
      html, body { background: #ffffff !important; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      .page-break { break-after: page; }
      .section-head, .week-head { break-after: avoid-page; }
      .content { padding-bottom: 0.35in; }
      .run-foot { display: flex; position: fixed; left: 0; right: 0; bottom: 0; background: #fff; padding-top: 4px; padding-bottom: 4px; }
    }
    .amber-rule { background: ${amber}; }
  `;
}
