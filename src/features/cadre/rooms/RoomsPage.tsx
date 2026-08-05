/**
 * CADRE — Room Reservations. Schedule-building staff manage location categories
 * (College, Range, …) and the rooms within them, then see a filterable month
 * calendar of every room booking (a booking is a session that references a
 * managed room). Booked blocks show the room, class, and course. Categories and
 * rooms are org-scoped; the program is universal.
 *
 * Conflict prevention lives at the session save path (SessionFormModal): a
 * managed room can't be double-booked over an overlapping time.
 */
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDoc, collection, deleteDoc, deleteField, doc, orderBy, serverTimestamp, Timestamp, updateDoc, where } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { db, storage, functions } from '../../../lib/firebase';
import { useAuth } from '../../../auth/AuthContext';
import { useCollection, type WithId } from '../../../lib/firestore';
import { combineDateTime, toDateInputValue, toTimeInputValue } from '../../../lib/time';
import type { AcademyDoc, RoomCategoryDoc, RoomDoc, RoomReservationDoc, SessionDoc } from '../../../types';
import { Button, Field, Input, PageHeader, Select, TextArea } from '../../../components/ui';
import { Modal } from '../../../components/Modal';
import { RoomSelect } from './RoomSelect';
import { roomExemptAcademy } from './roomBooking';
import { academyColorFor } from '../../../lib/academyColors';

// Ad-hoc reservations are SERVER-owned (transactional conflict check); the rules
// forbid client writes to roomReservations.
const saveRoomReservationFn = httpsCallable<{ reservationId?: string; roomId: string; title: string; startMs: number; endMs: number; notes?: string }, { id: string }>(functions, 'saveRoomReservation');
const deleteRoomReservationFn = httpsCallable<{ reservationId: string }, { ok: boolean }>(functions, 'deleteRoomReservation');

const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#db2777', '#65a30d'];

/** Monday-first week start (matches the old spreadsheet + org scheduling). */
function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

/** One colored block in a week-grid cell. */
type GridChip = {
  key: string;
  kind: 'session' | 'hold';
  label: string;
  title: string;
  color: string;
  startMs: number;
  academyId?: string;
  reservation?: WithId<RoomReservationDoc>;
};

export function RoomsPage() {
  const { orgId } = useAuth();
  const navigate = useNavigate();
  const { data: categories } = useCollection<RoomCategoryDoc>('roomCategories');
  const { data: rooms } = useCollection<RoomDoc>('rooms');
  // Bound the live subscription to ~1 year of bookings (the calendar is per-month)
  // instead of the whole, ever-growing sessions collection.
  const sessionWindowStart = useMemo(() => Timestamp.fromMillis(Date.now() - 365 * 864e5), []);
  const { data: sessions } = useCollection<SessionDoc>('sessions', [where('start', '>=', sessionWindowStart), orderBy('start')], [sessionWindowStart]);
  const { data: academies } = useCollection<AcademyDoc>('academies');
  const { data: reservations } = useCollection<RoomReservationDoc>('roomReservations');

  const [newCat, setNewCat] = useState('');
  const [busy, setBusy] = useState(false);
  const [roomModal, setRoomModal] = useState<{ categoryId: string; room?: WithId<RoomDoc> } | null>(null);
  const [resModal, setResModal] = useState<{ reservation?: WithId<RoomReservationDoc>; prefill?: { roomId?: string; date?: string } } | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [roomsOpen, setRoomsOpen] = useState(false); // top management section — collapsed by default

  const sortedCats = useMemo(
    () => [...categories].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)),
    [categories]
  );
  const catColor = useMemo(() => {
    const m = new Map<string, string>();
    sortedCats.forEach((c, i) => m.set(c.id, PALETTE[i % PALETTE.length]));
    return m;
  }, [sortedCats]);
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);
  const roomsByCat = useMemo(() => {
    const m = new Map<string, WithId<RoomDoc>[]>();
    for (const r of rooms) (m.get(r.categoryId) ?? m.set(r.categoryId, []).get(r.categoryId)!).push(r);
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [rooms]);
  const academyById = useMemo(() => new Map(academies.map((a) => [a.id, a])), [academies]);

  // ── Week grid (the digital version of the old rooms×days spreadsheet) ────
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; }),
    [weekStart]
  );
  const todayKey = toDateInputValue(new Date());

  /** Cell chips keyed `${roomId}_${dayKey}`. Sessions from the same academy in
   *  the same room+day MERGE into one chip (like one cell entry on the old
   *  spreadsheet); the tooltip lists every time block. */
  const cellChips = useMemo(() => {
    const dayKeys = new Set(weekDays.map((d) => toDateInputValue(d)));
    const map = new Map<string, GridChip[]>();
    const push = (cellKey: string, chip: GridChip) => (map.get(cellKey) ?? map.set(cellKey, []).get(cellKey)!).push(chip);
    const mil = (ms: number) => {
      const d = new Date(ms);
      return `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    };

    for (const s of sessions) {
      // Archived classes no longer hold their rooms — keep the grid consistent
      // with the conflict rules (free on the grid = actually bookable).
      if (s.status === 'cancelled' || roomExemptAcademy(academyById.get(s.academyId))) continue;
      const dayKey = toDateInputValue(s.start.toDate());
      if (!dayKeys.has(dayKey)) continue;
      const acad = academyById.get(s.academyId);
      const timeLine = `${mil(s.start.toMillis())}–${mil(s.end.toMillis())} ${s.title || s.courseName}`;
      for (const rid of new Set(s.roomIds?.length ? s.roomIds : s.roomId ? [s.roomId] : [])) {
        if (!roomById.has(rid)) continue;
        const cellKey = `${rid}_${dayKey}`;
        const existing = map.get(cellKey)?.find((c) => c.kind === 'session' && c.academyId === s.academyId);
        if (existing) {
          existing.title += `\n${timeLine}`;
          existing.startMs = Math.min(existing.startMs, s.start.toMillis());
        } else {
          push(cellKey, {
            key: `${s.id}_${rid}`,
            kind: 'session',
            academyId: s.academyId,
            label: acad?.shortName || s.courseName,
            title: `${acad ? `${acad.shortName || acad.name}\n` : ''}${timeLine}`,
            color: academyColorFor(acad),
            startMs: s.start.toMillis(),
          });
        }
      }
    }
    for (const r of reservations) {
      const dayKey = toDateInputValue(r.start.toDate());
      if (!dayKeys.has(dayKey) || !roomById.has(r.roomId)) continue;
      push(`${r.roomId}_${dayKey}`, {
        key: `res_${r.id}`,
        kind: 'hold',
        label: `🔒 ${r.title}`,
        title: `${mil(r.start.toMillis())}–${mil(r.end.toMillis())} ${r.title}${r.notes ? `\n${r.notes}` : ''}`,
        color: '#475569',
        startMs: r.start.toMillis(),
        reservation: r,
      });
    }
    for (const list of map.values()) list.sort((a, b) => a.startMs - b.startMs);
    return map;
  }, [weekDays, sessions, reservations, roomById, academyById]);

  // Color legend: academies actually booked somewhere this week.
  const weekAcademies = useMemo(() => {
    const ids = new Set<string>();
    for (const chips of cellChips.values()) for (const c of chips) if (c.academyId) ids.add(c.academyId);
    return [...ids]
      .map((id) => academyById.get(id))
      .filter((a): a is NonNullable<typeof a> => !!a)
      .sort((a, b) => (a.shortName || a.name).localeCompare(b.shortName || b.name));
  }, [cellChips, academyById]);

  async function addCategory() {
    const name = newCat.trim();
    if (!name || !orgId) return;
    setBusy(true);
    await addDoc(collection(db, 'roomCategories'), { orgId, name, order: categories.length, createdAt: serverTimestamp() });
    setNewCat('');
    setBusy(false);
  }
  async function deleteCategory(c: WithId<RoomCategoryDoc>) {
    if ((roomsByCat.get(c.id)?.length ?? 0) > 0) {
      alert('Delete or move this category’s rooms first.');
      return;
    }
    if (!window.confirm(`Delete category “${c.name}”?`)) return;
    await deleteDoc(doc(db, 'roomCategories', c.id));
  }
  async function renameCategory(c: WithId<RoomCategoryDoc>) {
    const name = window.prompt('Rename location', c.name)?.trim();
    if (!name || name === c.name) return;
    await updateDoc(doc(db, 'roomCategories', c.id), { name });
  }
  async function toggleRoomActive(r: WithId<RoomDoc>) {
    await updateDoc(doc(db, 'rooms', r.id), { active: r.active === false });
  }
  async function deleteRoom(r: WithId<RoomDoc>) {
    if (reservations.some((res) => res.roomId === r.id)) {
      alert('This room has ad-hoc reservations on the calendar — delete those first (they reference the room only by id and would be orphaned).');
      return;
    }
    if (!window.confirm(`Delete room “${r.name}”? Existing class bookings keep the room name but lose the managed link.`)) return;
    await deleteDoc(doc(db, 'rooms', r.id));
  }

  return (
    <div>
      <PageHeader kicker="CADRE" title="Room Reservations" />

      {/* ── Categories & rooms ─────────────────────────────────────────────── */}
      <section className="mb-6 rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
        <button
          type="button"
          onClick={() => setRoomsOpen((o) => !o)}
          aria-expanded={roomsOpen}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <h2 className="text-sm font-semibold uppercase tracking-wider text-watch-600">
            Locations &amp; rooms{' '}
            <span className="ml-1 font-normal normal-case tracking-normal text-slate-400">({sortedCats.length} location{sortedCats.length === 1 ? '' : 's'}, {rooms.length} room{rooms.length === 1 ? '' : 's'})</span>
          </h2>
          <span className="text-xs font-medium text-bifrost-700">{roomsOpen ? '▾ Hide' : '▸ Manage'}</span>
        </button>

        {roomsOpen && (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="New location" hint="e.g. College, Range, Off-site">
                <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Range" onKeyDown={(e) => { if (e.key === 'Enter') addCategory(); }} />
              </Field>
              <Button variant="primary" disabled={busy || !newCat.trim()} onClick={addCategory}>Add</Button>
            </div>

        {sortedCats.length === 0 && <p className="text-sm text-slate-500">No locations yet — add one above (e.g. “College”, “Range”), then add rooms within it.</p>}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sortedCats.map((c) => (
            <div key={c.id} className="rounded-md border border-watch-100 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: catColor.get(c.id) }} />
                  <span className="font-medium text-watch-900">{c.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button className="text-xs text-bifrost-700 hover:underline" onClick={() => renameCategory(c)}>Rename</button>
                  <button className="text-xs text-slate-400 hover:text-red-600" onClick={() => deleteCategory(c)}>Delete</button>
                </div>
              </div>
              <ul className="space-y-1">
                {(roomsByCat.get(c.id) ?? []).map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className={r.active === false ? 'text-slate-400 line-through' : 'text-slate-700'}>
                      {r.diagramUrl && <a href={r.diagramUrl} target="_blank" rel="noopener" title="View diagram" className="mr-1">📐</a>}
                      {r.name}{r.capacity ? <span className="text-xs text-slate-400"> · {r.capacity} seats</span> : null}
                    </span>
                    <span className="flex items-center gap-2 text-xs">
                      <button className="text-bifrost-700 hover:underline" onClick={() => setRoomModal({ categoryId: c.id, room: r })}>Edit</button>
                      <button className="text-slate-500 hover:underline" onClick={() => toggleRoomActive(r)}>{r.active === false ? 'Activate' : 'Hide'}</button>
                      <button className="text-slate-400 hover:text-red-600" onClick={() => deleteRoom(r)}>Delete</button>
                    </span>
                  </li>
                ))}
                {(roomsByCat.get(c.id)?.length ?? 0) === 0 && <li className="text-xs text-slate-400">No rooms yet.</li>}
              </ul>
              <button className="mt-2 text-xs font-medium text-bifrost-700 hover:underline" onClick={() => setRoomModal({ categoryId: c.id })}>+ Add room</button>
            </div>
          ))}
        </div>
          </div>
        )}
      </section>

      {/* ── The week grid — rooms × days, the old spreadsheet made live ────── */}
      <section className="rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-watch-900">
              {weekStart.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}
              {' – '}
              {weekDays[6].toLocaleDateString(
                undefined,
                weekDays[6].getMonth() === weekStart.getMonth()
                  ? { day: 'numeric', year: 'numeric' }
                  : { month: 'long', day: 'numeric', year: 'numeric' }
              )}
            </h2>
            <p className="text-xs text-slate-400">
              Classes book their rooms automatically — click any empty cell to hold a room.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Joined pager — one control, not three floating buttons. */}
            <div className="inline-flex overflow-hidden rounded-md ring-1 ring-watch-200">
              <button
                type="button"
                aria-label="Previous week"
                className="px-2.5 py-1.5 text-sm text-watch-700 hover:bg-watch-50"
                onClick={() => setWeekStart((w) => { const d = new Date(w); d.setDate(d.getDate() - 7); return d; })}
              >
                ←
              </button>
              <button
                type="button"
                className="border-x border-watch-200 px-3 py-1.5 text-sm font-medium text-watch-700 hover:bg-watch-50"
                onClick={() => setWeekStart(startOfWeek(new Date()))}
              >
                Today
              </button>
              <button
                type="button"
                aria-label="Next week"
                className="px-2.5 py-1.5 text-sm text-watch-700 hover:bg-watch-50"
                onClick={() => setWeekStart((w) => { const d = new Date(w); d.setDate(d.getDate() + 7); return d; })}
              >
                →
              </button>
            </div>
            {/* Fixed-width wrappers — the shared Input/Select are w-full and
                would otherwise each claim a whole flex line. */}
            <div className="w-40">
              <Input
                type="date"
                value={toDateInputValue(weekStart)}
                onChange={(e) => { if (e.target.value) setWeekStart(startOfWeek(new Date(`${e.target.value}T00:00:00`))); }}
                aria-label="Jump to week"
              />
            </div>
            {sortedCats.length > 1 && (
              <div className="w-44">
                <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Filter by location">
                  <option value="all">All locations</option>
                  {sortedCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>
            )}
            <Button variant="primary" disabled={rooms.length === 0} onClick={() => setResModal({})}>+ Reservation</Button>
          </div>
        </div>

        {rooms.length === 0 ? (
          <p className="text-sm text-slate-500">Add locations and rooms above — the week grid shows every room&apos;s bookings at a glance.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg ring-1 ring-watch-100">
            <table className="w-full min-w-[52rem] table-fixed border-separate border-spacing-0 text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 w-28 border-b border-watch-100 bg-watch-50 px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-watch-500">
                    Room
                  </th>
                  {weekDays.map((d) => {
                    const key = toDateInputValue(d);
                    const weekend = d.getDay() === 0 || d.getDay() === 6;
                    const today = key === todayKey;
                    return (
                      <th
                        key={key}
                        className={`border-b border-l border-watch-100 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider ${
                          today ? 'bg-bifrost-50 text-bifrost-800' : weekend ? 'bg-watch-50/70 text-watch-400' : 'bg-watch-50 text-watch-500'
                        }`}
                      >
                        {d.toLocaleDateString(undefined, { weekday: 'short' })}
                        <span className={`ml-1.5 rounded px-1 font-bold normal-case tabular-nums ${today ? 'bg-bifrost-500 text-white' : 'text-watch-400'}`}>
                          {d.getDate()}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              {sortedCats
                .filter((c) => categoryFilter === 'all' || c.id === categoryFilter)
                .map((c) => {
                  const catRooms = (roomsByCat.get(c.id) ?? []).filter((r) => r.active !== false);
                  if (catRooms.length === 0) return null;
                  return (
                    <tbody key={c.id}>
                      <tr>
                        <td
                          colSpan={8}
                          className="border-b border-watch-50 bg-watch-50/60 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-watch-600"
                          style={{ borderLeft: `4px solid ${catColor.get(c.id)}` }}
                        >
                          {c.name}
                          <span className="ml-2 font-medium normal-case tracking-normal text-watch-400">
                            {catRooms.length} room{catRooms.length === 1 ? '' : 's'}
                          </span>
                        </td>
                      </tr>
                      {catRooms.map((r) => (
                        <tr key={r.id} className="group/row">
                          <td className="sticky left-0 z-10 border-b border-watch-50 bg-white px-2.5 py-2 align-top group-hover/row:bg-watch-50/50">
                            <span className="flex items-center gap-1.5 font-semibold text-watch-900">
                              <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: r.color || catColor.get(c.id) }} />
                              <span className="truncate" title={r.capacity ? `${r.name} — ${r.capacity} seats` : r.name}>{r.name}</span>
                            </span>
                          </td>
                          {weekDays.map((d) => {
                            const dayKey = toDateInputValue(d);
                            const chips = cellChips.get(`${r.id}_${dayKey}`) ?? [];
                            const weekend = d.getDay() === 0 || d.getDay() === 6;
                            const today = dayKey === todayKey;
                            return (
                              <td
                                key={dayKey}
                                className={`group h-10 border-b border-l border-watch-50 p-1 align-top ${
                                  today ? 'bg-bifrost-50/40' : weekend ? 'bg-watch-50/40' : 'bg-white'
                                }`}
                              >
                                <div className="flex h-full flex-col gap-1">
                                  {chips.map((chip) => (
                                    <button
                                      key={chip.key}
                                      type="button"
                                      title={chip.title}
                                      onClick={() =>
                                        chip.kind === 'hold'
                                          ? setResModal({ reservation: chip.reservation })
                                          : chip.academyId && navigate(`/cadre/academies/${chip.academyId}`)
                                      }
                                      className="block w-full truncate rounded-md px-2 py-1 text-left text-[11px] font-semibold text-white shadow-sm transition hover:shadow hover:brightness-110"
                                      style={{ backgroundColor: chip.color }}
                                    >
                                      {chip.label}
                                    </button>
                                  ))}
                                  {/* Empty (or any) cell: one click starts a hold for THIS room+day. */}
                                  <button
                                    type="button"
                                    aria-label={`Reserve ${r.name} on ${dayKey}`}
                                    onClick={() => setResModal({ prefill: { roomId: r.id, date: dayKey } })}
                                    className={`w-full flex-1 rounded-md border border-dashed border-transparent px-2 text-left text-[11px] text-transparent transition group-hover:border-watch-200 group-hover:text-watch-400 group-hover:hover:border-bifrost-300 group-hover:hover:bg-bifrost-50 group-hover:hover:text-bifrost-700 ${chips.length === 0 ? 'py-1' : 'py-0.5'}`}
                                  >
                                    + hold
                                  </button>
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  );
                })}
            </table>
          </div>
        )}

        {/* Legend — this week's classes in their colors + the manual-hold style */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500">
          <span className="font-semibold uppercase tracking-wider text-watch-500">This week:</span>
          {weekAcademies.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: academyColorFor(a) }} />
              {a.shortName || a.name}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: '#475569' }} />
            🔒 manual hold
          </span>
          <span className="text-slate-400">· Classes fill in automatically from their schedules; click any empty cell to hold a room (renovations, outside groups, events…). Click a class to open it, a 🔒 to edit.</span>
        </div>
      </section>

      {roomModal && (
        <RoomModal
          orgId={orgId}
          categoryId={roomModal.categoryId}
          room={roomModal.room}
          onClose={() => setRoomModal(null)}
        />
      )}
      {resModal && (
        <ReservationModal
          rooms={rooms.filter((r) => r.active !== false)}
          reservation={resModal.reservation}
          prefill={resModal.prefill}
          onClose={() => setResModal(null)}
        />
      )}
    </div>
  );
}

function ReservationModal({
  rooms,
  reservation,
  prefill,
  onClose,
}: {
  rooms: WithId<RoomDoc>[];
  reservation?: WithId<RoomReservationDoc>;
  /** Week-grid cell click: start the form on that room + day. */
  prefill?: { roomId?: string; date?: string };
  onClose: () => void;
}) {
  const initialRoomId = reservation?.roomId ?? prefill?.roomId;
  const roomName = initialRoomId ? rooms.find((r) => r.id === initialRoomId)?.name ?? '' : '';
  const [room, setRoom] = useState(roomName);
  const [roomId, setRoomId] = useState<string | undefined>(initialRoomId);
  const [title, setTitle] = useState(reservation?.title ?? '');
  const [date, setDate] = useState(reservation ? toDateInputValue(reservation.start.toDate()) : prefill?.date ?? '');
  const [startTime, setStartTime] = useState(reservation ? toTimeInputValue(reservation.start.toDate()) : '08:00');
  const [endTime, setEndTime] = useState(reservation ? toTimeInputValue(reservation.end.toDate()) : '17:00');
  const [notes, setNotes] = useState(reservation?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!roomId) { setError('Pick a managed room to reserve.'); return; }
    if (!title.trim()) { setError('Give the reservation a title.'); return; }
    if (!date) { setError('Pick a date.'); return; }
    const start = combineDateTime(date, startTime);
    const end = combineDateTime(date, endTime);
    if (end <= start) { setError('End time must be after the start time.'); return; }
    setBusy(true);
    try {
      // Server callable does the conflict check + write in one transaction.
      await saveRoomReservationFn({ reservationId: reservation?.id, roomId, title: title.trim(), startMs: start.getTime(), endMs: end.getTime(), notes: notes.trim() });
      onClose();
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message.replace(/^FirebaseError:\s*/, '') : 'Could not save the reservation.');
    }
  }

  async function remove() {
    if (!reservation || !window.confirm('Delete this reservation?')) return;
    setBusy(true);
    try {
      await deleteRoomReservationFn({ reservationId: reservation.id });
      onClose();
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message.replace(/^FirebaseError:\s*/, '') : 'Could not delete the reservation.');
    }
  }

  return (
    <Modal open onClose={onClose} title={reservation ? 'Edit reservation' : 'New reservation'}>
      <form onSubmit={save} className="space-y-4">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
        <Field label="Room">
          <RoomSelect value={room} roomId={roomId} includeNone={false} onChange={(name, id) => { setRoom(name); setRoomId(id); }} />
        </Field>
        <Field label="Title" hint="e.g. Staff meeting, Maintenance, Outside agency">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Maintenance" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
          <Field label="Start"><Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required /></Field>
          <Field label="End"><Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required /></Field>
        </div>
        <Field label="Notes (optional)"><TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <div className="flex items-center justify-between gap-2">
          {reservation ? <Button type="button" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={remove}>Delete</Button> : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy}>{reservation ? 'Save' : 'Reserve'}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function RoomModal({
  orgId,
  categoryId,
  room,
  onClose,
}: {
  orgId: string | null | undefined;
  categoryId: string;
  room?: WithId<RoomDoc>;
  onClose: () => void;
}) {
  const [name, setName] = useState(room?.name ?? '');
  const [capacity, setCapacity] = useState(room?.capacity ? String(room.capacity) : '');
  const [notes, setNotes] = useState(room?.notes ?? '');
  const [diagramUrl, setDiagramUrl] = useState(room?.diagramUrl ?? '');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  async function uploadDiagram(file: File) {
    if (!orgId) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'png';
      const r = storageRef(storage, `rooms/${orgId}/${Date.now()}.${ext}`);
      await uploadBytes(r, file);
      setDiagramUrl(await getDownloadURL(r));
    } finally {
      setUploading(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !orgId) return;
    setBusy(true);
    const cap = parseInt(capacity, 10);
    const payload = {
      orgId,
      categoryId,
      name: name.trim(),
      active: room?.active ?? true,
      ...(Number.isFinite(cap) && cap > 0 ? { capacity: cap } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    if (room) await updateDoc(doc(db, 'rooms', room.id), { ...payload, diagramUrl: diagramUrl.trim() || deleteField() });
    else await addDoc(collection(db, 'rooms'), { ...payload, ...(diagramUrl.trim() ? { diagramUrl: diagramUrl.trim() } : {}), createdAt: serverTimestamp() });
    setBusy(false);
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={room ? `Edit room — ${room.name}` : 'Add room'}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Room name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="E-120 / Range A" autoFocus required />
        </Field>
        <Field label="Capacity (optional)" hint="Seats — used to warn when a class exceeds the room">
          <Input type="number" min={0} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </Field>
        <Field label="Notes (optional)">
          <TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Field label="Diagram / floor plan (optional)" hint="An image showing where this room is">
          <div className="flex items-center gap-3">
            {diagramUrl && <img src={diagramUrl} alt="" className="h-12 w-12 rounded border border-watch-100 object-cover" />}
            <label className="cursor-pointer text-sm font-medium text-bifrost-700 hover:underline">
              {uploading ? 'Uploading…' : diagramUrl ? 'Replace' : 'Upload'}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadDiagram(e.target.files[0])} />
            </label>
            {diagramUrl && <button type="button" className="text-xs text-slate-400 hover:text-red-600" onClick={() => setDiagramUrl('')}>Remove</button>}
          </div>
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy || uploading || !name.trim()}>{room ? 'Save' : 'Add room'}</Button>
        </div>
      </form>
    </Modal>
  );
}
