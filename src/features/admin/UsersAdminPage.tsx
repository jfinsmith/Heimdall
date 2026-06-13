/**
 * Admin — Users & Roles: approve pending users, set roles (calls the
 * `setUserRole` callable, which writes the custom claim), verify
 * qualifications.
 */
import React, { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { doc, serverTimestamp, updateDoc, orderBy } from 'firebase/firestore';
import { db, functions } from '../../lib/firebase';
import { useCollection, type WithId } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import { ROLE_LABELS } from '../../lib/rbac';
import type { Role, UserDoc } from '../../types';
import { Badge, Button, PageHeader, Select } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { logAudit } from '../sessions/audit';

const setUserRole = httpsCallable<{ uid: string; role: Role }, { ok: boolean }>(functions, 'setUserRole');

export function UsersAdminPage() {
  const { firebaseUser } = useAuth();
  const { data: users } = useCollection<UserDoc>('users', [orderBy('displayName')]);

  /** "Dep. Sofia Vargas" → "Vargas, Dep. Sofia"; sort key is the last name. */
  const lastFirst = (name: string) => {
    const parts = (name ?? '').trim().split(/\s+/);
    if (parts.length < 2) return name;
    const last = parts.pop()!;
    return `${last}, ${parts.join(' ')}`;
  };
  const lastNameKey = (name: string) => (name ?? '').trim().split(/\s+/).pop()?.toLowerCase() ?? '';

  // Instructors at top, most-permissive roles at the bottom.
  const GROUP_ORDER: Role[] = ['instructor', 'coordinator', 'sergeant', 'lieutenant', 'director'];
  const [qualUser, setQualUser] = useState<WithId<UserDoc> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = users.filter((u) => u.status === 'pending');
  const active = users.filter((u) => u.status !== 'pending');

  async function approve(u: WithId<UserDoc>) {
    setBusy(u.id);
    setError(null);
    try {
      await updateDoc(doc(db, 'users', u.id), { status: 'active', updatedAt: serverTimestamp() });
      // Ensure the custom claim exists even at default role.
      await setUserRole({ uid: u.id, role: u.role });
      await logAudit(firebaseUser!.uid, 'user.approve', 'user', u.id, `Approved ${u.displayName}`);
    } catch (err) {
      setError(`Approving ${u.displayName} failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  async function changeRole(u: WithId<UserDoc>, role: Role) {
    setBusy(u.id);
    setError(null);
    try {
      await setUserRole({ uid: u.id, role }); // callable updates doc + claim atomically
      await logAudit(firebaseUser!.uid, 'user.set_role', 'user', u.id, `Set ${u.displayName} to ${role}`);
    } catch (err) {
      setError(`Changing ${u.displayName}'s role failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  async function deactivate(u: WithId<UserDoc>) {
    if (!window.confirm(`Deactivate ${u.displayName}? They will lose access.`)) return;
    await updateDoc(doc(db, 'users', u.id), { status: 'inactive', updatedAt: serverTimestamp() });
    await logAudit(firebaseUser!.uid, 'user.deactivate', 'user', u.id, `Deactivated ${u.displayName}`);
  }

  return (
    <div>
      <PageHeader back kicker="Admin" title="Users & Roles" />
      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

      {pending.length > 0 && (
        <section className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-amber-800">
            Pending approval ({pending.length})
          </h2>
          <ul className="space-y-2">
            {pending.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  <span className="font-medium text-watch-900">{u.displayName}</span>{' '}
                  <span className="text-slate-500">
                    {u.email} · {u.rank || 'no rank'} · {u.agency || 'no agency'}
                  </span>
                </span>
                <Button variant="primary" disabled={busy === u.id} onClick={() => approve(u)}>
                  Approve
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="overflow-x-auto rounded-lg border border-watch-100 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-watch-50 text-xs uppercase tracking-wider text-watch-600">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Qualifications</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          {GROUP_ORDER.map((groupRole) => {
            const group = active
              .filter((u) => u.role === groupRole)
              .sort((a, b) => lastNameKey(a.displayName).localeCompare(lastNameKey(b.displayName)));
            if (group.length === 0) return null;
            return (
              <tbody key={groupRole} className="divide-y divide-watch-50">
                <tr className="bg-watch-100/60">
                  <td colSpan={5} className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-watch-600">
                    {ROLE_LABELS[groupRole]}s ({group.length})
                  </td>
                </tr>
                {group.map((u) => {
                  const claimed = u.qualifications.length;
                  const verified = u.qualifications.filter((q) => q.verified).length;
                  // Green = everything claimed is verified; orange = pending claims.
                  const qualTone =
                    claimed === 0 ? '' : verified === claimed ? 'bg-green-50' : 'bg-amber-50';
                  return (
                    <tr key={u.id}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-watch-900">{lastFirst(u.displayName)}</div>
                        <div className="text-xs text-slate-500">{u.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Select
                          value={u.role}
                          disabled={busy === u.id}
                          onChange={(e) => changeRole(u, e.target.value as Role)}
                          aria-label={`Role for ${u.displayName}`}
                        >
                          {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={u.status === 'active' ? 'green' : 'slate'}>{u.status}</Badge>
                      </td>
                      <td className={`px-4 py-3 ${qualTone}`}>
                        <button className="text-bifrost-700 hover:underline" onClick={() => setQualUser(u)}>
                          {verified} verified / {claimed} claimed
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {u.status === 'active' && (
                          <Button variant="ghost" onClick={() => deactivate(u)}>
                            Deactivate
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>

      {qualUser && <QualificationsModal user={qualUser} onClose={() => setQualUser(null)} />}
    </div>
  );
}

/** Verify / unverify a user's claimed qualifications. */
function QualificationsModal({ user, onClose }: { user: WithId<UserDoc>; onClose: () => void }) {
  const { firebaseUser } = useAuth();
  const [quals, setQuals] = useState(user.qualifications);

  async function setVerified(key: string, verified: boolean) {
    const next = quals.map((q) =>
      q.key === key ? { ...q, verified, verifiedBy: verified ? firebaseUser!.uid : '' } : q
    );
    setQuals(next);
    // verifiedQualKeys is the rule-protected source of truth for sign-ups.
    const verifiedQualKeys = next.filter((q) => q.verified).map((q) => q.key);
    await updateDoc(doc(db, 'users', user.id), {
      qualifications: next,
      verifiedQualKeys,
      updatedAt: serverTimestamp(),
    });
    await logAudit(
      firebaseUser!.uid,
      verified ? 'qualification.verify' : 'qualification.unverify',
      'user',
      user.id,
      `${verified ? 'Verified' : 'Unverified'} ${key} for ${user.displayName}`
    );
  }

  return (
    <Modal open onClose={onClose} title={`Qualifications — ${user.displayName}`}>
      {quals.length === 0 ? (
        <p className="text-sm text-slate-500">No qualifications claimed.</p>
      ) : (
        <ul className="space-y-2">
          {quals.map((q) => (
            <li key={q.key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-watch-100 px-3 py-2 text-sm">
              <span className="text-watch-800">
                {q.label}
                <span className="ml-2 text-xs text-slate-500">
                  {q.attendedOn ? `attended ${q.attendedOn.toDate().toLocaleDateString()}` : 'no course date given'}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {q.verified ? (
                  <Button variant="ghost" onClick={() => setVerified(q.key, false)}>
                    Unverify
                  </Button>
                ) : (
                  <Button variant="primary" onClick={() => setVerified(q.key, true)}>
                    Verify
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
