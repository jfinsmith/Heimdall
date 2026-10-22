/**
 * Limbo tracker — one class. Cadets from the chosen agencies down the left,
 * one column per day across; each cell is where that cadet is that day
 * (Range, Validations, SOCE, TDY…). A "brush" (the activity picked at the top)
 * paints single cells on click, and the bulk panel applies it to any set of
 * cadets over a date range in one write — nobody fills in 20 people one by
 * one. The NMT start date is the gold column everyone is counting down to.
 *
 * Storage: academies/{id}/limbo/plan — cells[memberId][yyyy-mm-dd] = label
 * (staff-only; every write stamps the academy's orgId).
 */
import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { deleteField, doc, serverTimestamp, setDoc, type FieldValue } from 'firebase/firestore';
import { Modal } from '../../../components/Modal';
import { db } from '../../../lib/firebase';
import { useCollection, useDoc, type WithId } from '../../../lib/firestore';
import { useAuth } from '../../../auth/AuthContext';
import { useGlobalSettings } from '../../../app/providers';
import type { AcademyDoc, LimboPlanDoc, RosterMemberDoc } from '../../../types';
import { LIMBO_ACTIVITIES, ROSTER_AGENCIES } from '../../../types';
import { Button, Field, Input, PageHeader, Select, Spinner } from '../../../components/ui';
import { addDays, fmtDate, toDateInputValue } from '../../../lib/time';
import { lastFirst, memberAgency } from '../roster/rosterShared';
import { friendlyError } from '../../../lib/callableError';

const CLEAR = '__clear__';
const CUSTOM = '__custom__';
const MAX_DAYS = 200;
/** Activity colors — picked per activity in Manage activities (stored by key);
 *  unpicked labels fall back to a stable hash of the name. */
const PALETTE: { key: string; name: string; cls: string }[] = [
  { key: 'sky', name: 'Sky', cls: 'bg-sky-200 text-sky-950' },
  { key: 'emerald', name: 'Green', cls: 'bg-emerald-200 text-emerald-950' },
  { key: 'violet', name: 'Violet', cls: 'bg-violet-200 text-violet-950' },
  { key: 'rose', name: 'Rose', cls: 'bg-rose-200 text-rose-950' },
  { key: 'amber', name: 'Amber', cls: 'bg-amber-200 text-amber-950' },
  { key: 'teal', name: 'Teal', cls: 'bg-teal-200 text-teal-950' },
  { key: 'indigo', name: 'Indigo', cls: 'bg-indigo-200 text-indigo-950' },
  { key: 'orange', name: 'Orange', cls: 'bg-orange-200 text-orange-950' },
  { key: 'lime', name: 'Lime', cls: 'bg-lime-200 text-lime-950' },
  { key: 'fuchsia', name: 'Fuchsia', cls: 'bg-fuchsia-200 text-fuchsia-950' },
  { key: 'cyan', name: 'Cyan', cls: 'bg-cyan-200 text-cyan-950' },
  { key: 'pink', name: 'Pink', cls: 'bg-pink-200 text-pink-950' },
  { key: 'slate', name: 'Grey', cls: 'bg-slate-300 text-slate-950' },
  { key: 'red', name: 'Red', cls: 'bg-red-300 text-red-950' },
];
const paletteCls = (key: string | undefined) => PALETTE.find((p) => p.key === key)?.cls;
/** Fallback color for a label with no picked color — stable across list edits. */
function hashCls(label: string): string {
  let h = 0;
  for (const ch of label.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % 12].cls;
}
const localDate = (s: string) => new Date(`${s}T00:00:00`);
/** What a save may carry: plan fields plus nested cell writes (deleteField clears). */
type PlanPatch = Omit<Partial<LimboPlanDoc>, 'cells' | 'nmtStart'> & {
  cells?: Record<string, Record<string, string | FieldValue>>;
  nmtStart?: string | FieldValue;
};
const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

export function LimboTrackerPage() {
  const { academyId = '' } = useParams();
  const { firebaseUser, orgId } = useAuth();
  const settings = useGlobalSettings();
  const { data: academy } = useDoc<AcademyDoc>(academyId ? `academies/${academyId}` : null);
  const { data: plan } = useDoc<LimboPlanDoc>(academyId ? `academies/${academyId}/limbo/plan` : null);
  const { data: roster, loading: rosterLoading } = useCollection<RosterMemberDoc>(
    academyId ? `academies/${academyId}/roster` : null,
    [],
    [academyId]
  );
  const planRef = doc(db, 'academies', academyId, 'limbo', 'plan');

  // Agencies: the org's managed list ∪ whatever's actually on this roster.
  const rosterAgencies = useMemo(() => [...new Set(roster.map(memberAgency))].sort(), [roster]);
  const agencyChoices = useMemo(() => {
    const managed = settings?.agencies?.length ? settings.agencies : ROSTER_AGENCIES.map((a) => a.key).filter((k) => k !== 'Other');
    return [...new Set([...managed, ...rosterAgencies])];
  }, [settings, rosterAgencies]);
  const chosenAgencies = plan?.agencies ?? rosterAgencies;
  const chosenSet = new Set(chosenAgencies);

  const members = useMemo(
    () =>
      roster
        .filter((m) => !m.blockTaker && m.status !== 'withdrawn' && m.status !== 'dismissed' && chosenSet.has(memberAgency(m)))
        .sort((a, b) => lastFirst(a.fullName).localeCompare(lastFirst(b.fullName))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roster, chosenAgencies.join('|')]
  );

  // Window: the academy's END date (from the class itself) through the NMT
  // start date — the whole limbo. Once today passes the end date the left edge
  // becomes today, so passed days drop off and the chart rolls right. No NMT
  // date yet = 60 days from the start. Scrolls horizontally.
  const today = toDateInputValue(new Date());
  const nmtStart = plan?.nmtStart ?? '';
  const academyEnd = academy ? toDateInputValue(academy.endDate.toDate()) : '';
  const days = useMemo(() => {
    const start = localDate(academyEnd && academyEnd > today ? academyEnd : today);
    const nmt = nmtStart ? localDate(nmtStart) : null;
    const end = nmt && nmt >= start ? nmt : addDays(start, 60);
    const out: { key: string; date: Date }[] = [];
    for (let d = start; d <= end && out.length < MAX_DAYS; d = addDays(d, 1)) out.push({ key: toDateInputValue(d), date: d });
    return out;
  }, [today, nmtStart, academyEnd]);
  // NMT countdown — shown with the date so it's glaring even when the start
  // sits outside the two-week window.
  const nmtIn = plan?.nmtStart ? Math.round((localDate(plan.nmtStart).getTime() - localDate(today).getTime()) / 864e5) : null;
  const nmtHint =
    nmtIn == null
      ? 'The gold column everyone is counting down to'
      : nmtIn === 0
        ? 'NMT starts TODAY'
        : nmtIn > 0
          ? `NMT starts in ${nmtIn} day${nmtIn === 1 ? '' : 's'} (${localDate(plan!.nmtStart!).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })})`
          : `NMT started ${-nmtIn} day${nmtIn === -1 ? '' : 's'} ago`;

  // Activities = the org's managed list (Manage activities…; defaults until
  // set) + anything custom already painted on this chart.
  const cells = useMemo(() => plan?.cells ?? {}, [plan?.cells]);
  const managedActivities = useMemo(
    () => (settings?.limboActivities?.length ? settings.limboActivities : [...LIMBO_ACTIVITIES]),
    [settings?.limboActivities]
  );
  const activities = useMemo(() => {
    const seen = new Set<string>(managedActivities);
    for (const row of Object.values(cells)) for (const v of Object.values(row)) if (v) seen.add(v);
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [cells, managedActivities]);
  const [manageOpen, setManageOpen] = useState(false);
  const activityColors = settings?.limboActivityColors ?? {};
  const colorOf = (label: string) => paletteCls(activityColors[label]) ?? hashCls(label);

  // Brush + bulk panel state.
  const [brushPick, setBrushPick] = useState<string>(CLEAR);
  const [customLabel, setCustomLabel] = useState('');
  const brush = brushPick === CUSTOM ? customLabel.trim() : brushPick;
  const [bulkFrom, setBulkFrom] = useState(today);
  const [bulkTo, setBulkTo] = useState(today);
  const [weekdaysOnly, setWeekdaysOnly] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function write(patch: PlanPatch) {
    if (!academy?.orgId || !firebaseUser) {
      setError('This class is missing its organization — reload and try again.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // merge:true deep-merges the nested cells map, and deleteField() inside
      // it clears a single day — one write for the whole bulk assignment.
      await setDoc(
        planRef,
        { orgId: academy.orgId, academyId, ...patch, updatedAt: serverTimestamp(), updatedBy: firebaseUser.uid },
        { merge: true }
      );
    } catch (err) {
      setError(friendlyError(err, 'Could not save.'));
    } finally {
      setBusy(false);
    }
  }

  function paint(memberId: string, dayKey: string) {
    if (brushPick === CUSTOM && !brush) {
      setError('Type the custom activity first.');
      return;
    }
    void write({ cells: { [memberId]: { [dayKey]: brushPick === CLEAR ? deleteField() : brush } } });
  }

  async function applyBulk() {
    if (selected.size === 0) {
      setError('Select at least one cadet.');
      return;
    }
    if (brushPick === CUSTOM && !brush) {
      setError('Type the custom activity first.');
      return;
    }
    const from = localDate(bulkFrom);
    const to = localDate(bulkTo);
    if (!(to >= from)) {
      setError('The end date is before the start date.');
      return;
    }
    const patch: Record<string, Record<string, string | FieldValue>> = {};
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (weekdaysOnly && isWeekend(d)) continue;
      const key = toDateInputValue(d);
      for (const mid of selected) (patch[mid] ??= {})[key] = brushPick === CLEAR ? deleteField() : brush;
    }
    await write({ cells: patch });
  }

  /** One click paints every listed cadet for that day with the current brush. */
  function paintAll(dayKey: string) {
    if (brushPick === CUSTOM && !brush) {
      setError('Type the custom activity first.');
      return;
    }
    const value = brushPick === CLEAR ? deleteField() : brush;
    const patch: Record<string, Record<string, string | FieldValue>> = {};
    for (const m of members) patch[m.id] = { [dayKey]: value };
    void write({ cells: patch });
  }

  // Today's headcount by activity — the "where is everyone right now" line.
  const todaySummary = useMemo(() => {
    const counts = new Map<string, number>();
    let unassigned = 0;
    for (const m of members) {
      const v = cells[m.id]?.[today];
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
      else unassigned += 1;
    }
    return { counts: [...counts.entries()].sort((a, b) => b[1] - a[1]), unassigned };
  }, [members, cells, today]);

  if (!academy) return <Spinner className="mt-10" />;

  const nmtKey = plan?.nmtStart ?? '';
  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <PageHeader
        back
        kicker="CADRE — Limbo"
        title={`${academy.shortName ? `${academy.shortName} — ` : ''}${academy.name}`}
        actions={
          <Link to="/cadre/limbo" className="text-sm text-bifrost-700 hover:underline">
            All classes
          </Link>
        }
      />
      <p className="mb-4 text-sm text-slate-500">
        Class ended {fmtDate(academy.endDate)}. Pick an activity, then click a day on the chart — or tick cadets
        and apply it to a date range at once (the range may run past the two-week view; those days roll in).
      </p>
      {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

      {/* NMT date + agency filter + window */}
      <div className="mb-4 grid gap-4 rounded-lg border border-watch-100 bg-white p-4 shadow-sm lg:grid-cols-[11rem_16rem_1fr]">
        <Field label="Academy end date" hint="From the class itself (Edit academy)">
          <Input type="date" value={academyEnd} disabled />
        </Field>
        <Field label="NMT start date" hint={nmtHint}>
          <Input
            type="date"
            value={plan?.nmtStart ?? ''}
            onChange={(e) => void write({ nmtStart: e.target.value || deleteField() })}
          />
        </Field>
        <Field label="Agencies on this chart" hint="Only these agencies' cadets are listed (manage the list under Admin → Settings → Agencies)">
          <div className="flex flex-wrap gap-2 pt-1">
            {agencyChoices.map((a) => {
              const on = chosenSet.has(a);
              const onRoster = rosterAgencies.includes(a);
              return (
                <label
                  key={a}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${on ? 'border-bifrost-300 bg-bifrost-50 text-bifrost-900' : 'border-watch-200 text-slate-500'}`}
                  title={onRoster ? undefined : 'No cadets from this agency on the roster'}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      void write({ agencies: on ? chosenAgencies.filter((x) => x !== a) : [...chosenAgencies, a] })
                    }
                  />
                  {a}
                  {onRoster && <span className="text-slate-400">({roster.filter((m) => memberAgency(m) === a).length})</span>}
                </label>
              );
            })}
          </div>
        </Field>
      </div>

      {/* Brush + bulk assignment */}
      <div className="mb-4 rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
          <Field label="Activity (the brush)" hint="Click any day on the chart to paint it">
            <Select value={brushPick} onChange={(e) => setBrushPick(e.target.value)}>
              <option value={CLEAR}>— Clear (unassigned) —</option>
              {activities.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
              <option value={CUSTOM}>Custom…</option>
            </Select>
            {brushPick === CUSTOM && (
              <Input className="mt-2" value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder="e.g. Property TDY" autoFocus />
            )}
            <button type="button" className="mt-1.5 text-xs text-bifrost-700 hover:underline" onClick={() => setManageOpen(true)}>
              Manage activities…
            </button>
          </Field>
          <Field label="Apply from">
            <Input type="date" value={bulkFrom} onChange={(e) => setBulkFrom(e.target.value)} />
          </Field>
          <Field label="to">
            <Input type="date" value={bulkTo} onChange={(e) => setBulkTo(e.target.value)} />
          </Field>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={weekdaysOnly} onChange={(e) => setWeekdaysOnly(e.target.checked)} />
              Weekdays only
            </label>
            <Button variant="primary" disabled={busy || selected.size === 0} onClick={() => void applyBulk()}>
              Apply to {selected.size} selected
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600">
          <span className="font-medium">Today:</span>
          {todaySummary.counts.map(([label, n]) => (
            <span key={label} className={`rounded px-1.5 py-0.5 ${colorOf(label)}`}>
              {label} {n}
            </span>
          ))}
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">Unassigned {todaySummary.unassigned}</span>
          <span className="ml-auto text-slate-400">Chart runs from the academy end date through NMT (passed days drop off); the &quot;Everyone&quot; row paints a whole day in one click.</span>
        </div>
      </div>

      {/* The chart */}
      {rosterLoading ? (
        <Spinner />
      ) : members.length === 0 ? (
        <div className="rounded-lg border border-watch-100 bg-white p-6 text-center text-sm text-slate-500">
          No cadets from the selected agencies on this roster.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-watch-100 bg-white shadow-sm">
          <table className="border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 min-w-[14rem] border-b border-r border-watch-200 bg-watch-50 px-3 py-2 text-left font-semibold text-watch-700">
                  <label className="flex items-center gap-2" title="Select / clear every cadet on the chart">
                    <input
                      type="checkbox"
                      checked={members.length > 0 && selected.size === members.length}
                      onChange={(e) => setSelected(e.target.checked ? new Set(members.map((m) => m.id)) : new Set())}
                    />
                    Cadet
                  </label>
                </th>
                {days.map(({ key, date }) => {
                  const nmt = key === nmtKey;
                  const wk = isWeekend(date);
                  return (
                    <th
                      key={key}
                      className={`min-w-[2.6rem] border-b border-watch-200 px-0.5 py-1 text-center font-medium ${
                        nmt ? 'bg-bifrost-500 text-white' : wk ? 'bg-slate-100 text-slate-400' : 'bg-watch-50 text-watch-600'
                      } ${key === today ? 'underline decoration-2' : ''}`}
                      title={nmt ? 'New Member Training starts' : date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                    >
                      <div className="text-[10px] uppercase">{nmt ? 'NMT' : date.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                      <div>{date.getMonth() + 1}/{date.getDate()}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {/* Paint-everyone row: one click assigns the brush to every cadet
                  listed for that day (the 17-clicks problem). */}
              <tr className="bg-watch-50/70">
                <td className="sticky left-0 z-10 border-b border-r border-watch-200 bg-watch-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-watch-600">
                  Everyone ↓ <span className="font-normal normal-case tracking-normal text-slate-400">(click a day)</span>
                </td>
                {days.map(({ key, date }) => {
                  const nmt = key === nmtKey;
                  return (
                    <td key={key} className={`border-b border-watch-200 p-0 ${nmt ? 'border-l-2 border-l-bifrost-500 bg-bifrost-50' : isWeekend(date) ? 'bg-slate-100' : ''}`}>
                      <button
                        type="button"
                        disabled={busy || members.length === 0}
                        onClick={() => paintAll(key)}
                        title={`Set every cadet to "${brushPick === CLEAR ? 'clear' : brush || '…'}" on ${date.toLocaleDateString()}`}
                        className="block h-5 w-full text-[10px] leading-5 text-slate-400 hover:bg-bifrost-100 hover:text-bifrost-800"
                      >
                        all
                      </button>
                    </td>
                  );
                })}
              </tr>
              {members.map((m: WithId<RosterMemberDoc>) => (
                <tr key={m.id} className="group">
                  <td className="sticky left-0 z-10 border-b border-r border-watch-100 bg-white px-3 py-1.5 group-hover:bg-watch-50">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggleSelected(m.id)} />
                      <span>
                        <span className="block font-medium text-watch-900">{lastFirst(m.fullName)}</span>
                        <span className="block text-[10px] text-slate-500">{memberAgency(m)}</span>
                      </span>
                    </label>
                  </td>
                  {days.map(({ key, date }) => {
                    const v = cells[m.id]?.[key];
                    const nmt = key === nmtKey;
                    const wk = isWeekend(date);
                    return (
                      <td
                        key={key}
                        className={`border-b border-watch-100 p-0 ${nmt ? 'border-l-2 border-l-bifrost-500 bg-bifrost-50' : wk ? 'bg-slate-50' : ''}`}
                      >
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => paint(m.id, key)}
                          title={`${lastFirst(m.fullName)} — ${date.toLocaleDateString()}${v ? `: ${v}` : ''} (click to set "${brushPick === CLEAR ? 'clear' : brush || '…'}")`}
                          className={`block h-9 w-full truncate px-1 text-[11px] leading-9 ${v ? `${colorOf(v)} font-medium` : 'text-transparent hover:bg-bifrost-50'}`}
                        >
                          {v || '·'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {manageOpen && orgId && (
        <ManageActivitiesModal
          current={managedActivities}
          colors={activityColors}
          extras={activities.filter((a) => !managedActivities.includes(a))}
          onClose={() => setManageOpen(false)}
          onSave={async (list, colors) => {
            // Rules let staff touch exactly these fields on the org settings doc.
            await setDoc(
              doc(db, 'settings', orgId),
              { limboActivities: list, limboActivityColors: colors, updatedAt: serverTimestamp() },
              { merge: true }
            );
            if (!list.includes(brushPick) && brushPick !== CUSTOM && brushPick !== CLEAR) setBrushPick(CLEAR);
          }}
        />
      )}
      <p className="mt-3 text-xs text-slate-500">
        Legend:{' '}
        {activities.map((a) => (
          <span key={a} className={`mr-1.5 rounded px-1.5 py-0.5 ${colorOf(a)}`}>
            {a}
          </span>
        ))}
      </p>
    </div>
  );
}

/**
 * Org-wide activity list editor. Removing an activity only drops it from the
 * dropdown — days already painted with it keep their label (and it still
 * shows in the legend as a chart custom), so nothing silently disappears.
 */
function ManageActivitiesModal({
  current,
  colors: initialColors,
  extras,
  onClose,
  onSave,
}: {
  current: string[];
  /** Picked palette key per label (unpicked = hashed fallback). */
  colors: Record<string, string>;
  /** Labels painted on this chart that aren't in the managed list (one-off customs) — offered for promotion. */
  extras: string[];
  onClose: () => void;
  onSave: (list: string[], colors: Record<string, string>) => Promise<void>;
}) {
  const [list, setList] = useState<string[]>(current);
  const [colors, setColors] = useState<Record<string, string>>(initialColors);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = (label: string) => {
    const v = label.trim();
    if (!v) return;
    if (list.some((x) => x.toLowerCase() === v.toLowerCase())) {
      setError(`"${v}" is already in the list.`);
      return;
    }
    setError(null);
    setList((l) => [...l, v]);
    setDraft('');
  };
  async function save() {
    setBusy(true);
    setError(null);
    try {
      // Drop colors for labels no longer in the list (keeps the map tidy).
      const kept = Object.fromEntries(Object.entries(colors).filter(([label]) => list.includes(label)));
      await onSave(list, kept);
      onClose();
    } catch (err) {
      setError(friendlyError(err, 'Could not save the activity list.'));
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Manage activities">
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          These are the choices in the activity dropdown for every class&apos;s Limbo chart (listed alphabetically).
          Click a swatch to set each one&apos;s color. Removing an activity keeps the days already painted with it.
        </p>
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
        <ul className="divide-y divide-watch-100 rounded-md border border-watch-100">
          {[...list].sort((a, b) => a.localeCompare(b)).map((a) => (
            <li key={a} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm">
              <span className={`min-w-[8rem] rounded px-1.5 py-0.5 font-medium ${paletteCls(colors[a]) ?? hashCls(a)}`}>{a}</span>
              <span className="flex flex-wrap gap-1" aria-label={`Color for ${a}`}>
                {PALETTE.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    title={p.name}
                    onClick={() => setColors((c) => ({ ...c, [a]: p.key }))}
                    className={`h-5 w-5 rounded ${p.cls.split(' ')[0]} ${colors[a] === p.key ? 'ring-2 ring-watch-900 ring-offset-1' : 'ring-1 ring-black/10 hover:ring-watch-400'}`}
                  />
                ))}
              </span>
              <button type="button" className="ml-auto px-1 text-red-600 hover:underline" onClick={() => setList((l) => l.filter((x) => x !== a))}>
                Remove
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No activities yet — add one below.</li>}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add(draft);
          }}
        >
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="New activity, e.g. Property TDY" />
          <Button type="submit" variant="secondary" disabled={!draft.trim()}>
            Add
          </Button>
        </form>
        {extras.length > 0 && (
          <div className="text-xs text-slate-500">
            Used on this chart but not in the list:{' '}
            {extras.map((x) => (
              <button key={x} type="button" className="mr-1.5 rounded border border-watch-200 px-1.5 py-0.5 hover:bg-watch-50" onClick={() => add(x)}>
                + {x}
              </button>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" disabled={busy} onClick={() => void save()}>
            Save list
          </Button>
        </div>
      </div>
    </Modal>
  );
}
