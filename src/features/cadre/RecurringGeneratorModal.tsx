/**
 * CADRE — Recurring block generator. Generates one session per matching
 * weekday between two dates. Supports:
 *  - catalog courses OR a custom/agency block (e.g. daily 0645–0700 Formation)
 *  - auto day-count math: pick a course and the tool sizes the date range from
 *    course hours ÷ hours-per-day (24 hrs @ 8/day → 3 days)
 *  - a configurable lunch carved out of each block (not counted)
 */
import React, { useMemo, useState } from 'react';
import { collection, doc, serverTimestamp, writeBatch, Timestamp, setDoc, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { shortId, useCollection, useDoc, type WithId } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import { addDays, combineDateTime, hoursBetween, toDateInputValue, tsFromDate } from '../../lib/time';
import type { AcademyDoc, CurriculumDoc, RoleSlot, UserDoc } from '../../types';
import { Button, Field, Input, Select } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { logAudit } from '../sessions/audit';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CUSTOM = '__custom__';

export function RecurringGeneratorModal({ academy, onClose }: { academy: WithId<AcademyDoc>; onClose: () => void }) {
  const { firebaseUser } = useAuth();
  const { data: coordinatorUsers } = useCollection<UserDoc>('users', [where('role', '==', 'coordinator')]);
  // Courses come entirely from THIS academy's discipline (its curriculum blocks)
  // — hours, high-liability, lead qualification, and default slots all live on
  // the block (Admin → Curriculum & Hours). Alphabetical.
  const { data: curriculum } = useDoc<CurriculumDoc>(academy.discipline ? `curricula/${academy.discipline}` : null);
  const courseOptions = useMemo(
    () =>
      (curriculum?.courses ?? [])
        .map((b) => ({
          value: `block:${b.name}`,
          name: b.name,
          hours: b.minHours,
          highLiability: !!b.highLiability,
          leadQualification: b.leadQualification,
          defaultRoleSlots: b.defaultRoleSlots ?? [],
        }))
        .sort((a, c) => a.name.localeCompare(c.name)),
    [curriculum]
  );

  const [courseId, setCourseId] = useState('');
  const [customName, setCustomName] = useState('');
  const [days, setDays] = useState<Set<number>>(new Set([1, 2, 3, 4, 5])); // weekdays
  const [from, setFrom] = useState(toDateInputValue(academy.startDate.toDate()));
  const [until, setUntil] = useState(toDateInputValue(academy.startDate.toDate()));
  const [perDay, setPerDay] = useState(8);
  const [startTime, setStartTime] = useState('07:00');
  const [endTime, setEndTime] = useState('18:00');
  const [lunchMinutes, setLunchMinutes] = useState(60);
  const [lunchStart, setLunchStart] = useState('12:00');
  const [lunchCounts, setLunchCounts] = useState(false);
  const [room, setRoom] = useState(academy.defaultRoom ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCustom = courseId === CUSTOM;
  const selectedOption = courseOptions.find((o) => o.value === courseId);

  const matchingDates = useMemo(() => {
    const out: Date[] = [];
    if (!from || !until) return out;
    let d = new Date(`${from}T00:00:00`);
    const end = new Date(`${until}T00:00:00`);
    while (d <= end) {
      if (days.has(d.getDay())) out.push(new Date(d));
      d = addDays(d, 1);
    }
    return out;
  }, [from, until, days]);

  /** Pick a course → auto-size the date range from hours ÷ per-day. */
  function pickCourse(id: string) {
    setCourseId(id);
    if (id === CUSTOM || !id) return;
    const opt = courseOptions.find((o) => o.value === id);
    if (!opt) return;
    const neededDays = Math.max(1, Math.ceil(opt.hours / Math.max(1, perDay)));
    setUntil(nthMatchingDay(from, days, neededDays));
  }

  /** Date of the Nth matching weekday on/after `from`. */
  function nthMatchingDay(fromStr: string, weekdays: Set<number>, n: number): string {
    let d = new Date(`${fromStr}T00:00:00`);
    let count = 0;
    // Cap the search so a bad weekday set can't loop forever.
    for (let i = 0; i < 366 && count < n; i++) {
      if (weekdays.has(d.getDay())) {
        count++;
        if (count === n) break;
      }
      d = addDays(d, 1);
    }
    return toDateInputValue(d);
  }

  function toggleDay(i: number) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  const perBlockHours = Math.max(
    0,
    hoursBetween(combineDateTime('2000-01-01', startTime), combineDateTime('2000-01-01', endTime)) - (lunchCounts ? 0 : lunchMinutes / 60)
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!firebaseUser || (!selectedOption && !isCustom)) return;
    if (isCustom && !customName.trim()) {
      setError('Enter a name for the custom block.');
      return;
    }
    if (matchingDates.length === 0) {
      setError('No matching days in the selected range.');
      return;
    }
    setBusy(true);

    const courseName = isCustom ? customName.trim() : selectedOption?.name ?? '';
    const defaultCoord = academy.coordinatorIds[0];

    // Sanitize slots — Firestore rejects undefined, so only include the
    // qualification key when set.
    const buildSlots = (): Record<string, unknown>[] => {
      const raw: RoleSlot[] = isCustom
        ? [{ slotId: shortId(), role: 'coordinator', count: 1, filledBy: defaultCoord ? [defaultCoord] : [] }]
        : [
            { slotId: shortId(), role: 'lead', count: 1, requiredQualificationKey: selectedOption?.leadQualification ?? undefined, filledBy: [] },
            ...(selectedOption?.defaultRoleSlots ?? []).filter((s) => s.role !== 'lead').map((s) => ({ slotId: shortId(), filledBy: [], ...s })),
          ];
      return raw.map((s) => {
        const out: Record<string, unknown> = { slotId: s.slotId, role: s.role, count: s.count, filledBy: s.filledBy ?? [] };
        if (s.requiredQualificationKey) out.requiredQualificationKey = s.requiredQualificationKey;
        return out;
      });
    };

    try {
      let batch = writeBatch(db);
      let count = 0;
      const created: { ref: ReturnType<typeof doc>; start: Date; end: Date }[] = [];
      for (const date of matchingDates) {
        const ds = toDateInputValue(date);
        const start = combineDateTime(ds, startTime);
        const end = combineDateTime(ds, endTime);
        const ref = doc(collection(db, 'sessions'));
        batch.set(ref, {
          academyId: academy.id,
          courseId: isCustom ? 'custom' : selectedOption?.value ?? courseId,
          courseName,
          highLiability: isCustom ? false : selectedOption?.highLiability ?? false,
          title: '',
          start: tsFromDate(start),
          end: tsFromDate(end),
          location: academy.location,
          room,
          hours: Math.max(0, hoursBetween(start, end) - (lunchCounts ? 0 : lunchMinutes / 60)),
          lunchMinutes,
          lunchStart: lunchMinutes > 0 ? lunchStart : '',
          lunchCountsTowardHours: lunchCounts,
          countsTowardFdle: !isCustom,
          status: academy.status === 'draft' ? 'draft' : 'scheduled',
          roleSlots: buildSlots(),
          notes: '',
          createdBy: firebaseUser.uid,
          updatedAt: serverTimestamp(),
        });
        if (isCustom && defaultCoord) created.push({ ref, start, end });
        if (++count % 300 === 0) {
          await batch.commit();
          batch = writeBatch(db);
        }
      }
      await batch.commit();

      // Mirror coordinator assignments for custom blocks so they hit My Schedule.
      if (isCustom && defaultCoord) {
        for (const { ref, start, end } of created) {
          const now = Timestamp.now();
          await setDoc(doc(db, 'assignments', `${ref.id}_${defaultCoord}`), {
            uid: defaultCoord,
            sessionId: ref.id,
            academyId: academy.id,
            role: 'coordinator',
            courseName,
            location: academy.location,
            room,
            start: tsFromDate(start),
            end: tsFromDate(end),
            status: 'confirmed',
            reminderSent: false,
            createdAt: now,
          });
        }
      }

      await logAudit(firebaseUser.uid, 'session.bulk_create', 'academy', academy.id, `Generated ${matchingDates.length} recurring "${courseName}" sessions`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the sessions. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Recurring block generator">
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Course">
            <Select value={courseId} onChange={(e) => pickCourse(e.target.value)} required>
              <option value="">Select a course…</option>
              {courseOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.name} ({o.hours} hrs)
                </option>
              ))}
              <option value={CUSTOM}>— Custom / agency block (e.g. Formation) —</option>
            </Select>
          </Field>
          {isCustom ? (
            <Field label="Custom block name" hint="Coordinator-run; no sign-up needed">
              <Input value={customName} onChange={(e) => setCustomName(e.target.value)} required placeholder="Formation" />
            </Field>
          ) : (
            <Field label="Hours per day" hint="Sizes the date range from course hours">
              <Input
                type="number"
                min={1}
                max={12}
                value={perDay}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setPerDay(v);
                  if (selectedOption) setUntil(nthMatchingDay(from, days, Math.max(1, Math.ceil(selectedOption.hours / Math.max(1, v)))));
                }}
              />
            </Field>
          )}
        </div>

        <fieldset>
          <legend className="mb-1 text-sm font-medium text-watch-800">Repeat on</legend>
          <div className="flex gap-1.5">
            {WEEKDAYS.map((label, i) => (
              <button
                key={label}
                type="button"
                aria-pressed={days.has(i)}
                onClick={() => toggleDay(i)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium ring-1 ring-inset ${
                  days.has(i) ? 'bg-watch-800 text-bifrost-300 ring-watch-800' : 'bg-white text-slate-600 ring-watch-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-4">
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
          </Field>
          <Field label="Until" hint={selectedOption ? 'Auto-sized from hours/day — adjust freely' : undefined}>
            <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} required />
          </Field>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <Field label="Start">
            <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
          </Field>
          <Field label="End">
            <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
          </Field>
          <Field label="Lunch (min)">
            <Input type="number" min={0} step={15} value={lunchMinutes} onChange={(e) => setLunchMinutes(Number(e.target.value))} />
          </Field>
          <Field label="Room (optional)">
            <Input value={room} onChange={(e) => setRoom(e.target.value)} />
          </Field>
        </div>
        {lunchMinutes > 0 && (
          <div className="flex flex-wrap items-end gap-4">
            <Field label="Lunch starts at" className="max-w-[10rem]">
              <Input type="time" value={lunchStart} onChange={(e) => setLunchStart(e.target.value)} />
            </Field>
            <label className="mb-2 flex items-center gap-2 text-sm text-watch-800">
              <input type="checkbox" checked={lunchCounts} onChange={(e) => setLunchCounts(e.target.checked)} />
              Count lunch toward instructional hours
            </label>
          </div>
        )}

        <p className="text-sm text-slate-500">
          Will create <strong className="text-watch-900">{matchingDates.length}</strong> sessions
          {' '}× <strong className="text-watch-900">{perBlockHours}</strong> hrs ={' '}
          <strong className="text-watch-900">{(matchingDates.length * perBlockHours).toFixed(1)}</strong> total hrs
          {!isCustom && selectedOption ? ` (course needs ${selectedOption.hours})` : ''}.
        </p>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || (!courseId) || matchingDates.length === 0}>
            Generate {matchingDates.length} sessions
          </Button>
        </div>
      </form>
    </Modal>
  );
}
