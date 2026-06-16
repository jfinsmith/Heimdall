/**
 * Admin — Roster & Certifications. One screen to see every member with their
 * profile and qualifications, find who's expiring (all FDLE instructor certs
 * share one 3/31 expiration on a 4-year cycle), and bulk-act: roll the selected
 * members' certs forward four years, or suspend them until conditions are met.
 */
import React, { useMemo, useState } from 'react';
import { doc, orderBy, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../lib/firebase';
import { useCollection, type WithId } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import { ROLE_LABELS } from '../../lib/rbac';
import type { QualificationKey, UserDoc } from '../../types';
import { QUALIFICATION_LABELS } from '../../types';
import { certYearOf, march31, tsFromDate } from '../../lib/time';
import { Badge, Button, Field, Input, PageHeader, Select, TextArea } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { logAudit } from '../sessions/audit';

const setUserSuspension = httpsCallable<{ uid: string; suspended: boolean; reason?: string }, { ok: boolean }>(
  functions,
  'setUserSuspension'
);

const shortQual = (key: QualificationKey) => QUALIFICATION_LABELS[key].replace(/ Instructor$/, '');

export function RosterPage() {
  const { firebaseUser } = useAuth();
  const { data: users } = useCollection<UserDoc>('users', [orderBy('displayName')]);

  const [search, setSearch] = useState('');
  const [expFilter, setExpFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSuspendOpen, setBulkSuspendOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // "Now" / windows for expiration coloring. (Plain Date is fine in the browser.)
  const now = new Date();
  const nextYear = now.getFullYear() + 1;
  const soonCutoff = march31(nextYear); // "within the next calendar year" → by 3/31 of next year

  function expStatus(u: WithId<UserDoc>): 'none' | 'expired' | 'soon' | 'ok' {
    if (!u.instructorCertExpires) return 'none';
    const d = u.instructorCertExpires.toDate();
    if (d < now) return 'expired';
    if (d <= soonCutoff) return 'soon';
    return 'ok';
  }

  // Distinct cert years present, for the per-year quick filter.
  const years = useMemo(
    () => [...new Set(users.filter((u) => u.instructorCertExpires).map((u) => certYearOf(u.instructorCertExpires!)))].sort(),
    [users]
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return users.filter((u) => {
      if (needle && !`${u.displayName} ${u.email} ${u.agency ?? ''} ${u.rank ?? ''}`.toLowerCase().includes(needle)) return false;
      if (!expFilter) return true;
      const st = expStatus(u);
      if (expFilter === 'soon') return st === 'soon' || st === 'expired';
      if (expFilter === 'expired') return st === 'expired';
      if (expFilter === 'none') return st === 'none';
      if (expFilter.startsWith('y')) return u.instructorCertExpires && certYearOf(u.instructorCertExpires) === Number(expFilter.slice(1));
      return true;
    });
  }, [users, search, expFilter]);

  const selectedUsers = users.filter((u) => selected.has(u.id));
  const allFilteredSelected = filtered.length > 0 && filtered.every((u) => selected.has(u.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => {
      if (filtered.every((u) => prev.has(u.id))) {
        const next = new Set(prev);
        filtered.forEach((u) => next.delete(u.id));
        return next;
      }
      return new Set([...prev, ...filtered.map((u) => u.id)]);
    });
  }

  async function rollOverSelected() {
    const targets = selectedUsers.filter((u) => u.instructorCertExpires);
    if (targets.length === 0) {
      setNotice('None of the selected members have a certification expiration to roll over.');
      return;
    }
    if (!window.confirm(`Roll forward ${targets.length} member${targets.length === 1 ? '' : 's'} by four years (next 3/31 cycle)?`)) return;
    setBusy(true);
    try {
      for (let i = 0; i < targets.length; i += 400) {
        const batch = writeBatch(db);
        targets.slice(i, i + 400).forEach((u) => {
          const nextYr = certYearOf(u.instructorCertExpires!) + 4;
          batch.update(doc(db, 'users', u.id), { instructorCertExpires: tsFromDate(march31(nextYr)), updatedAt: serverTimestamp() });
        });
        await batch.commit();
      }
      await logAudit(firebaseUser!.uid, 'qualification.rollover_bulk', 'user', 'multiple', `Rolled over ${targets.length} certifications (+4 yrs)`);
      setNotice(`Rolled forward ${targets.length} certification${targets.length === 1 ? '' : 's'} by four years.`);
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader back kicker="Admin" title="Roster & Certifications" />
      <p className="-mt-2 mb-4 max-w-3xl text-sm text-slate-500">
        Every member with their profile and qualifications. Instructor certs share one FDLE expiration
        (3/31 of the cert year, renewed every four years). Filter to who’s expiring, then roll the selected
        members forward four years or suspend them until they recertify.
      </p>

      {notice && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-md bg-bifrost-50 px-3 py-2 text-sm text-bifrost-900">
          <span>{notice}</span>
          <button className="text-bifrost-700 hover:underline" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Search" className="w-64">
          <Input placeholder="Name, email, agency…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        <Field label="Certification" className="w-72">
          <Select value={expFilter} onChange={(e) => setExpFilter(e.target.value)}>
            <option value="">All members</option>
            <option value="soon">Expiring within next calendar year (by 3/31/{nextYear})</option>
            <option value="expired">Expired</option>
            <option value="none">No expiration on file</option>
            {years.map((y) => (
              <option key={y} value={`y${y}`}>Expires 3/31/{y}</option>
            ))}
          </Select>
        </Field>
        <span className="pb-2 text-sm text-slate-400">{filtered.length} shown</span>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-bifrost-200 bg-bifrost-50 px-3 py-2 text-sm">
          <span className="font-medium text-watch-800">{selected.size} selected</span>
          <Button variant="secondary" disabled={busy} onClick={rollOverSelected}>
            Roll over +4 years
          </Button>
          <Button variant="ghost" className="text-amber-700" disabled={busy} onClick={() => setBulkSuspendOpen(true)}>
            Suspend selected…
          </Button>
          <button className="text-slate-500 hover:underline" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-watch-100 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-watch-50 text-xs uppercase tracking-wider text-watch-600">
            <tr>
              <th className="px-3 py-3">
                <input type="checkbox" checked={allFilteredSelected} onChange={toggleAll} aria-label="Select all shown" />
              </th>
              <th className="px-3 py-3">Member</th>
              <th className="px-3 py-3">Agency</th>
              <th className="px-3 py-3">Role</th>
              <th className="px-3 py-3">Contact</th>
              <th className="px-3 py-3">Qualifications</th>
              <th className="px-3 py-3">Cert expires</th>
              <th className="px-3 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-watch-50">
            {filtered.map((u) => {
              const st = expStatus(u);
              return (
                <tr key={u.id} className={selected.has(u.id) ? 'bg-bifrost-50/40' : 'hover:bg-watch-50/50'}>
                  <td className="px-3 py-3">
                    <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} aria-label={`Select ${u.displayName}`} />
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-medium text-watch-900">{u.displayName}</div>
                    {u.rank && <div className="text-xs text-slate-500">{u.rank}</div>}
                  </td>
                  <td className="px-3 py-3 text-slate-600">{u.agency || '—'}</td>
                  <td className="px-3 py-3 text-slate-600">{ROLE_LABELS[u.role]}</td>
                  <td className="px-3 py-3 text-xs text-slate-500">
                    <div>{u.email}</div>
                    {u.phone && <div>{u.phone}</div>}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1">
                      {u.qualifications.length === 0 && <span className="text-xs text-slate-400">none</span>}
                      {u.qualifications.map((q) => (
                        <Badge key={q.key} tone={q.verified ? 'green' : 'amber'}>
                          {shortQual(q.key)}
                          {q.verified ? '' : ' ⏳'}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    {u.instructorCertExpires ? (
                      <span
                        className={
                          st === 'expired' ? 'font-medium text-red-700' : st === 'soon' ? 'font-medium text-amber-700' : 'text-slate-600'
                        }
                      >
                        3/31/{certYearOf(u.instructorCertExpires)}
                        {st === 'expired' ? ' · expired' : st === 'soon' ? ' · soon' : ''}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={u.status === 'active' ? 'green' : u.status === 'suspended' ? 'red' : 'slate'}>{u.status}</Badge>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-slate-400">No members match these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {bulkSuspendOpen && (
        <BulkSuspendModal
          users={selectedUsers.filter((u) => u.id !== firebaseUser?.uid && u.status !== 'suspended')}
          onClose={() => setBulkSuspendOpen(false)}
          onDone={(n) => {
            setBulkSuspendOpen(false);
            setSelected(new Set());
            setNotice(`Suspended ${n} member${n === 1 ? '' : 's'}.`);
          }}
        />
      )}
    </div>
  );
}

/** Suspend every selected member with one shared reason (emails each). */
function BulkSuspendModal({
  users,
  onClose,
  onDone,
}: {
  users: WithId<UserDoc>[];
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim() || users.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const u of users) {
        await setUserSuspension({ uid: u.id, suspended: true, reason: reason.trim() });
      }
      onDone(users.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not suspend one or more members.');
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} title={`Suspend ${users.length} member${users.length === 1 ? '' : 's'}`}>
      <form onSubmit={submit} className="space-y-4 text-sm">
        {users.length === 0 ? (
          <p className="text-slate-500">
            No eligible members in the selection (already suspended or yourself are skipped). Close and adjust your selection.
          </p>
        ) : (
          <>
            <div className="rounded-md bg-amber-50 px-3 py-2 text-amber-800">
              Each will be emailed the reason and see the suspension banner until reinstated. Applies to:{' '}
              <strong>{users.map((u) => u.displayName).join(', ')}</strong>.
            </div>
            {error && <div className="rounded-md bg-red-50 px-3 py-2 text-red-800">{error}</div>}
            <Field label="Reason for suspension" hint="Shown to each member (on-site and by email).">
              <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus required />
            </Field>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {users.length > 0 && (
            <Button type="submit" variant="danger" disabled={busy || !reason.trim()}>
              {busy ? 'Suspending…' : `Suspend ${users.length}`}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}
