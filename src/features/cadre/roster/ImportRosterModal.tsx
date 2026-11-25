/**
 * Import cadets from another class's roster and keep the two tied. The user
 * picks WHO: by agency, by name, or both. Withdrawn and dismissed cadets are
 * never offered. Anyone already on this roster is linked, not duplicated.
 * The server (rosterImportMembers) re-checks everything.
 */
import React, { useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../../lib/firebase';
import { useCollection, type WithId } from '../../../lib/firestore';
import type { AcademyDoc, RosterMemberDoc } from '../../../types';
import { Badge, Button, Field, Select } from '../../../components/ui';
import { Modal } from '../../../components/Modal';
import { fmtDate } from '../../../lib/time';
import { friendlyError } from '../../../lib/callableError';
import { agencyLabel, lastFirst, rosterCompare, sameCadet } from './rosterShared';

interface ImportResult { ok: boolean; added: number; linked: number; alreadyLinked: number; leftOut: number }
const rosterImportMembers = httpsCallable<{ academyId: string; sourceAcademyId: string; memberIds: string[] }, ImportResult>(
  functions, 'rosterImportMembers'
);

const classLabel = (a: WithId<AcademyDoc>) => `${a.shortName || a.name} (${fmtDate(a.startDate)})${a.status === 'archived' ? ' — archived' : ''}`;

export function ImportRosterModal({
  academy, members, onClose,
}: {
  academy: WithId<AcademyDoc>;
  /** The whole destination roster, hidden members included. */
  members: WithId<RosterMemberDoc>[];
  onClose: () => void;
}) {
  const { data: academies, loading: aLoading } = useCollection<AcademyDoc>('academies');
  const classes = useMemo(
    () => academies.filter((a) => !a.isTemplate && a.id !== academy.id).sort((a, b) => b.startDate.toMillis() - a.startDate.toMillis()),
    [academies, academy.id]
  );
  const linkedIds = academy.rosterSources ?? [];
  // Opens on the class this roster is already tied to.
  const [sourceId, setSourceId] = useState(linkedIds[linkedIds.length - 1] ?? '');
  const { data: source, loading, error: loadError } = useCollection<RosterMemberDoc>(sourceId ? `academies/${sourceId}/roster` : null, [], [sourceId]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const cadets = useMemo(
    () => source.filter((m) => !m.blockTaker && m.status !== 'withdrawn' && m.status !== 'dismissed').sort(rosterCompare),
    [source]
  );
  const separated = source.filter((m) => m.status === 'withdrawn' || m.status === 'dismissed').length;
  /** 'linked' = nothing to do; 'here' = on this roster already, will be linked; 'new'. */
  const state = useMemo(() => {
    const out = new Map<string, 'linked' | 'here' | 'new'>();
    const claimed = new Set<string>();
    for (const m of cadets) {
      const own = members.find((d) => d.importedFrom?.academyId === sourceId && d.importedFrom.memberId === m.id);
      const match = own ?? members.find((d) => !claimed.has(d.id) && sameCadet(d, m));
      if (match) claimed.add(match.id);
      out.set(m.id, own || match?.importedFrom ? 'linked' : match ? 'here' : 'new');
    }
    return out;
  }, [cadets, members, sourceId]);

  const pickable = cadets.filter((m) => state.get(m.id) !== 'linked');
  const chosen = pickable.filter((m) => picked.has(m.id));
  const agencies = useMemo(() => [...new Set(cadets.map(agencyLabel))].sort(), [cadets]);

  function setMany(list: WithId<RosterMemberDoc>[], on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const m of list) on ? next.add(m.id) : next.delete(m.id);
      return next;
    });
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await rosterImportMembers({ academyId: academy.id, sourceAcademyId: sourceId, memberIds: chosen.map((m) => m.id) });
      setResult(res.data);
    } catch (err) {
      setError(friendlyError(err, 'Could not import the cadets.'));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const line = (n: number, text: string) => (n > 0 ? <li>{n} {text}</li> : null);
    return (
      <Modal open onClose={onClose} title="Import finished">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          {line(result.added, 'added to this roster')}
          {line(result.linked, 'already on this roster, now linked')}
          {line(result.alreadyLinked, 'already linked')}
          {line(result.leftOut, 'left out (no longer active in that class)')}
        </ul>
        <div className="mt-4 flex justify-end"><Button variant="primary" onClick={onClose}>Done</Button></div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} title={`Import cadets into ${academy.shortName || academy.name}`}>
      <div className="space-y-4 text-sm">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-red-800" role="alert">{error}</div>}
        <Field label="Import from" hint="Names and contact details copy over. Grades, discipline, and attendance stay with the class they happened in.">
          <Select value={sourceId} disabled={busy} onChange={(e) => { setSourceId(e.target.value); setPicked(new Set()); setError(null); }}>
            <option value="">{aLoading ? 'Loading classes…' : '— choose a class —'}</option>
            {classes.map((a) => <option key={a.id} value={a.id}>{classLabel(a)}{linkedIds.includes(a.id) ? ' — linked' : ''}</option>)}
          </Select>
        </Field>

        {sourceId && loadError && <p className="text-red-700">Couldn’t load that roster — try again.</p>}
        {sourceId && loading && <p className="text-slate-500">Loading roster…</p>}
        {sourceId && !loading && !loadError && cadets.length === 0 && <p className="text-slate-500">No active or graduated cadets on that roster.</p>}

        {cadets.length > 0 && (
          <>
            <div>
              <div className="mb-1 font-medium text-watch-800">Pick by agency</div>
              <div className="flex flex-wrap gap-2">
                {agencies.map((ag) => {
                  const group = pickable.filter((m) => agencyLabel(m) === ag);
                  const all = group.length > 0 && group.every((m) => picked.has(m.id));
                  return (
                    <label key={ag} className={`flex items-center gap-2 rounded-full border px-3 py-1 ${all ? 'border-bifrost-400 bg-bifrost-50' : 'border-watch-200'} ${group.length ? '' : 'opacity-50'}`}>
                      <input type="checkbox" disabled={busy || group.length === 0} checked={all} onChange={(e) => setMany(group, e.target.checked)} />
                      {ag} ({group.length})
                    </label>
                  );
                })}
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium text-watch-800">Or pick by name</span>
                <span className="space-x-3 text-xs">
                  <button type="button" className="text-bifrost-700 hover:underline" disabled={busy} onClick={() => setMany(pickable, true)}>Select all</button>
                  <button type="button" className="text-bifrost-700 hover:underline" disabled={busy} onClick={() => setPicked(new Set())}>Clear</button>
                </span>
              </div>
              <ul className="max-h-72 divide-y divide-watch-50 overflow-y-auto rounded-md border border-watch-100">
                {cadets.map((m) => {
                  const st = state.get(m.id);
                  return (
                    <li key={m.id}>
                      <label className={`flex items-center gap-3 px-3 py-1.5 ${st === 'linked' ? 'text-slate-400' : ''}`}>
                        <input type="checkbox" disabled={busy || st === 'linked'} checked={st !== 'linked' && picked.has(m.id)} onChange={(e) => setMany([m], e.target.checked)} />
                        <span className="flex-1">{lastFirst(m.fullName)} <span className="text-xs text-slate-500">{agencyLabel(m)}</span></span>
                        {st === 'linked' && <Badge tone="slate">linked</Badge>}
                        {st === 'here' && <Badge tone="amber">on this roster — will link</Badge>}
                        {m.status === 'graduated' && <Badge tone="navy">graduated</Badge>}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}
        {separated > 0 && <p className="text-xs text-slate-500">{separated} withdrawn or dismissed cadet{separated === 1 ? ' is' : 's are'} not offered.</p>}
        <p className="rounded-md bg-watch-50 px-3 py-2 text-xs text-slate-600">
          Linked cadets stay tied: if one is later withdrawn or dismissed from that class, they come off this roster automatically. Reinstating them there brings them back.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={run} disabled={busy || chosen.length === 0}>{busy ? 'Importing…' : `Import ${chosen.length || ''}`.trim()}</Button>
        </div>
      </div>
    </Modal>
  );
}
