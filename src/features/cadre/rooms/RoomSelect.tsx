/**
 * Room picker used anywhere a room is attached to a course/session. Shows the
 * org's managed rooms grouped by category, plus a "Custom room…" option that
 * reveals a free-text field — a custom entry saves to `room` only (no `roomId`,
 * no category), exactly as requested. onChange reports (roomName, roomId|undefined).
 */
import React, { useMemo, useState } from 'react';
import { useCollection } from '../../../lib/firestore';
import type { RoomCategoryDoc, RoomDoc } from '../../../types';
import { Input, Select } from '../../../components/ui';

const CUSTOM = '__custom__';

export function RoomSelect({
  value,
  roomId,
  onChange,
  placeholder = 'E-120 / Range A',
  includeNone = true,
}: {
  value: string;
  roomId?: string;
  onChange: (room: string, roomId: string | undefined) => void;
  placeholder?: string;
  includeNone?: boolean;
}) {
  const { data: rooms } = useCollection<RoomDoc>('rooms');
  const { data: cats } = useCollection<RoomCategoryDoc>('roomCategories');
  const activeRooms = useMemo(() => rooms.filter((r) => r.active !== false), [rooms]);
  const matched = useMemo(() => (roomId ? activeRooms.find((r) => r.id === roomId) : undefined), [activeRooms, roomId]);
  // Custom mode: free text with no managed room behind it (legacy / custom / a
  // room that was since deleted).
  const [custom, setCustom] = useState<boolean>(() => !roomId && !!value);

  const selectValue = custom ? CUSTOM : matched ? matched.id : roomId ? CUSTOM : '';
  const showCustomInput = selectValue === CUSTOM;

  const groups = useMemo(() => {
    const catIds = new Set(cats.map((c) => c.id));
    const ordered = [...cats].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
    const byCat = new Map<string, (RoomDoc & { id: string })[]>();
    for (const r of activeRooms) {
      const key = catIds.has(r.categoryId) ? r.categoryId : '__other__';
      (byCat.get(key) ?? byCat.set(key, []).get(key)!).push(r);
    }
    const out = ordered
      .filter((c) => byCat.has(c.id))
      .map((c) => ({ key: c.id, label: c.name, rooms: byCat.get(c.id)!.sort((a, b) => a.name.localeCompare(b.name)) }));
    if (byCat.has('__other__')) out.push({ key: '__other__', label: 'Other', rooms: byCat.get('__other__')!.sort((a, b) => a.name.localeCompare(b.name)) });
    return out;
  }, [activeRooms, cats]);

  function handleSelect(v: string) {
    if (v === '') { setCustom(false); onChange('', undefined); return; }
    if (v === CUSTOM) { setCustom(true); onChange(custom ? value : '', undefined); return; }
    const r = activeRooms.find((x) => x.id === v);
    if (r) { setCustom(false); onChange(r.name, r.id); }
  }

  return (
    <div className="space-y-2">
      <Select value={selectValue} onChange={(e) => handleSelect(e.target.value)}>
        {includeNone && <option value="">— none —</option>}
        {groups.map((g) => (
          <optgroup key={g.key} label={g.label}>
            {g.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </optgroup>
        ))}
        <option value={CUSTOM}>➕ Custom room…</option>
      </Select>
      {showCustomInput && (
        <Input value={value} onChange={(e) => onChange(e.target.value, undefined)} placeholder={placeholder} autoFocus />
      )}
    </div>
  );
}
