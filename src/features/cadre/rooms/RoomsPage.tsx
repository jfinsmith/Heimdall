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
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
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

// Ad-hoc reservations are SERVER-owned (transactional conflict check); the rules
// forbid client writes to roomReservations.
const saveRoomReservationFn = httpsCallable<{ reservationId?: string; roomId: string; title: string; startMs: number; endMs: number; notes?: string }, { id: string }>(functions, 'saveRoomReservation');
const deleteRoomReservationFn = httpsCallable<{ reservationId: string }, { ok: boolean }>(functions, 'deleteRoomReservation');

const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#db2777', '#65a30d'];

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
  const [resModal, setResModal] = useState<{ reservation?: WithId<RoomReservationDoc> } | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [roomFilter, setRoomFilter] = useState('all');
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
  const templateIds = useMemo(() => new Set(academies.filter((a) => a.isTemplate).map((a) => a.id)), [academies]);

  // Rooms available in the room filter, narrowed by the chosen category.
  const filterRooms = useMemo(
    () => rooms.filter((r) => categoryFilter === 'all' || r.categoryId === categoryFilter).sort((a, b) => a.name.localeCompare(b.name)),
    [rooms, categoryFilter]
  );

  // Bookings → calendar events (managed rooms only; skip cancelled + templates).
  const events = useMemo(() => {
    return sessions
      .filter((s) => s.roomId && roomById.has(s.roomId) && s.status !== 'cancelled' && !templateIds.has(s.academyId))
      .filter((s) => roomFilter === 'all' || s.roomId === roomFilter)
      .filter((s) => categoryFilter === 'all' || roomById.get(s.roomId!)?.categoryId === categoryFilter)
      .map((s) => {
        const r = roomById.get(s.roomId!)!;
        const acad = academyById.get(s.academyId);
        const color = r.color || catColor.get(r.categoryId) || '#64748b';
        return {
          id: s.id,
          title: `${r.name} · ${acad?.shortName ?? ''} — ${s.title || s.courseName}`.replace(' ·  —', ' —'),
          start: s.start.toDate(),
          end: s.end.toDate(),
          backgroundColor: color,
          borderColor: color,
          extendedProps: { academyId: s.academyId },
        };
      });
  }, [sessions, roomById, templateIds, roomFilter, categoryFilter, academyById, catColor]);

  // Ad-hoc reservations → calendar events (distinct slate style + lock icon).
  const resEvents = useMemo(() => {
    return reservations
      .filter((r) => roomById.has(r.roomId))
      .filter((r) => roomFilter === 'all' || r.roomId === roomFilter)
      .filter((r) => categoryFilter === 'all' || roomById.get(r.roomId)?.categoryId === categoryFilter)
      .map((r) => ({
        id: `res-${r.id}`,
        title: `🔒 ${roomById.get(r.roomId)!.name} · ${r.title}`,
        start: r.start.toDate(),
        end: r.end.toDate(),
        backgroundColor: '#475569',
        borderColor: '#475569',
        extendedProps: { reservationId: r.id },
      }));
  }, [reservations, roomById, roomFilter, categoryFilter]);
  const reservationById = useMemo(() => new Map(reservations.map((r) => [r.id, r])), [reservations]);

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

      {/* ── Booking calendar ───────────────────────────────────────────────── */}
      <section className="rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <h2 className="mr-auto text-sm font-semibold uppercase tracking-wider text-watch-600">Booking calendar</h2>
          <Button variant="ghost" disabled={rooms.length === 0} onClick={() => setResModal({})}>+ Reservation</Button>
          <Field label="Location">
            <Select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setRoomFilter('all'); }}>
              <option value="all">All locations</option>
              {sortedCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Room">
            <Select value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)}>
              <option value="all">All rooms</option>
              {filterRooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </Field>
        </div>
        <FullCalendar
          plugins={[dayGridPlugin]}
          initialView="dayGridMonth"
          firstDay={1}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
          events={[...events, ...resEvents]}
          eventClick={(arg) => {
            const resId = arg.event.extendedProps.reservationId as string | undefined;
            if (resId) { const r = reservationById.get(resId); if (r) setResModal({ reservation: r }); return; }
            const aid = arg.event.extendedProps.academyId as string | undefined;
            if (aid) navigate(`/cadre/academies/${aid}`);
          }}
          dayMaxEvents={4}
          height="auto"
        />
        <p className="mt-3 text-xs text-slate-400">Each block shows <strong>room · class · course</strong> (🔒 = an ad-hoc reservation). Filter by location or room to check availability. Click a booking to open its class, or a 🔒 to edit the reservation.</p>
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
          onClose={() => setResModal(null)}
        />
      )}
    </div>
  );
}

function ReservationModal({
  rooms,
  reservation,
  onClose,
}: {
  rooms: WithId<RoomDoc>[];
  reservation?: WithId<RoomReservationDoc>;
  onClose: () => void;
}) {
  const roomName = reservation ? rooms.find((r) => r.id === reservation.roomId)?.name ?? '' : '';
  const [room, setRoom] = useState(roomName);
  const [roomId, setRoomId] = useState<string | undefined>(reservation?.roomId);
  const [title, setTitle] = useState(reservation?.title ?? '');
  const [date, setDate] = useState(reservation ? toDateInputValue(reservation.start.toDate()) : '');
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
        <div className="grid grid-cols-3 gap-4">
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
