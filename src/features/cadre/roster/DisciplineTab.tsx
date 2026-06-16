/**
 * Discipline tracker — per-member warning + demerit tally. Each noted violation
 * carries a type, a level (warning, or demerit A/B/C/D worth 1/2/3/4 points),
 * a date and notes. Warnings tally separately; demerit points sum by weight.
 */
import React, { useState } from 'react';
import { doc, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { shortId, type WithId } from '../../../lib/firestore';
import type { DemeritLevel, RosterMemberDoc, ViolationEntry, ViolationType } from '../../../types';
import { Badge, Button, Field, Input, Select, TextArea } from '../../../components/ui';
import { Modal } from '../../../components/Modal';
import { agencyLabel, disciplineTally } from './rosterShared';

const TYPES: ViolationType[] = ['Tardy', 'Uniform', 'Grooming', 'Other'];
const LEVELS: { key: DemeritLevel; label: string }[] = [
  { key: 'warning', label: 'Warning (no points)' },
  { key: 'A', label: 'Demerit A (1 pt)' },
  { key: 'B', label: 'Demerit B (2 pts)' },
  { key: 'C', label: 'Demerit C (3 pts)' },
  { key: 'D', label: 'Demerit D (4 pts)' },
];
const levelLabel = (l: DemeritLevel) => (l === 'warning' ? 'Warning' : `Demerit ${l}`);

export function DisciplineTab({ academyId, members }: { academyId: string; members: WithId<RosterMemberDoc>[] }) {
  const [addFor, setAddFor] = useState<WithId<RosterMemberDoc> | null>(null);
  const roster = members.filter((m) => !m.blockTaker);

  async function removeViolation(m: WithId<RosterMemberDoc>, id: string) {
    const next = (m.violations ?? []).filter((v) => v.id !== id);
    await updateDoc(doc(db, 'academies', academyId, 'roster', m.id), { violations: next, updatedAt: serverTimestamp() });
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-watch-100 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-watch-50 text-xs uppercase tracking-wider text-watch-600">
            <tr>
              <th className="px-3 py-3">Name</th>
              <th className="px-3 py-3">Agency</th>
              <th className="px-3 py-3 text-center">Warnings</th>
              <th className="px-3 py-3 text-center">Demerits (pts)</th>
              <th className="px-3 py-3">History</th>
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-watch-50">
            {roster.map((m) => {
              const t = disciplineTally(m.violations);
              return (
                <tr key={m.id} className={m.status === 'withdrawn' ? 'text-slate-400' : ''}>
                  <td className="px-3 py-3 font-medium text-watch-900">{m.fullName}</td>
                  <td className="px-3 py-3">{agencyLabel(m)}</td>
                  <td className="px-3 py-3 text-center">
                    {t.warnings > 0 ? <Badge tone="amber">{t.warnings}</Badge> : <span className="text-slate-300">0</span>}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {t.points > 0 ? (
                      <Badge tone={t.points >= 6 ? 'red' : 'navy'}>
                        {t.points}
                        <span className="ml-1 text-[10px] opacity-70">
                          ({(['A', 'B', 'C', 'D'] as const).filter((k) => t.counts[k]).map((k) => `${t.counts[k]}×${k}`).join(' ') || '—'})
                        </span>
                      </Badge>
                    ) : (
                      <span className="text-slate-300">0</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(m.violations ?? []).length === 0 && <span className="text-xs text-slate-400">clean</span>}
                      {(m.violations ?? [])
                        .slice()
                        .sort((a, b) => a.date.toMillis() - b.date.toMillis())
                        .map((v) => (
                          <span
                            key={v.id}
                            className="group inline-flex items-center gap-1 rounded-full bg-watch-50 px-2 py-0.5 text-xs ring-1 ring-inset ring-watch-200"
                            title={v.notes || ''}
                          >
                            <span className="text-slate-500">{v.date.toDate().toLocaleDateString()}</span>
                            <span className="font-medium text-watch-800">
                              {v.type === 'Other' ? v.typeOther || 'Other' : v.type}
                            </span>
                            <span className={v.level === 'warning' ? 'text-amber-700' : 'text-red-700'}>· {levelLabel(v.level)}</span>
                            <button className="text-slate-300 hover:text-red-600" onClick={() => removeViolation(m, v.id)} aria-label="Remove violation">✕</button>
                          </span>
                        ))}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Button variant="ghost" onClick={() => setAddFor(m)}>+ Add</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {addFor && <ViolationModal academyId={academyId} member={addFor} onClose={() => setAddFor(null)} />}
    </div>
  );
}

function ViolationModal({
  academyId, member, onClose,
}: {
  academyId: string; member: WithId<RosterMemberDoc>; onClose: () => void;
}) {
  const todayInput = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const [date, setDate] = useState(todayInput);
  const [type, setType] = useState<ViolationType>('Tardy');
  const [typeOther, setTypeOther] = useState('');
  const [level, setLevel] = useState<DemeritLevel>('warning');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const entry: ViolationEntry = {
      id: shortId(),
      date: Timestamp.fromDate(new Date(`${date}T12:00:00`)),
      type,
      ...(type === 'Other' ? { typeOther: typeOther.trim() } : {}),
      level,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    await updateDoc(doc(db, 'academies', academyId, 'roster', member.id), {
      violations: [...(member.violations ?? []), entry],
      updatedAt: serverTimestamp(),
    });
    setBusy(false);
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={`Note a violation — ${member.fullName}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Violation type">
            <Select value={type} onChange={(e) => setType(e.target.value as ViolationType)}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
        </div>
        {type === 'Other' && (
          <Field label="Describe the violation"><Input value={typeOther} onChange={(e) => setTypeOther(e.target.value)} placeholder="e.g. Insubordination" /></Field>
        )}
        <Field label="Level" hint="Escalate the level for repeat offenses of the same type.">
          <Select value={level} onChange={(e) => setLevel(e.target.value as DemeritLevel)}>
            {LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
          </Select>
        </Field>
        <Field label="Notes"><TextArea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy || (type === 'Other' && !typeOther.trim())}>
            {busy ? 'Saving…' : 'Save violation'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
