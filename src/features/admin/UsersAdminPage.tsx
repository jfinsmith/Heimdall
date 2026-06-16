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
import type { Qualification, QualificationKey, Role, UserDoc } from '../../types';
import { QUALIFICATION_LABELS, isInstructorQual } from '../../types';
import { certYearOf, march31, tsFromDate } from '../../lib/time';
import { Badge, Button, Field, Input, PageHeader, Select, TextArea } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { logAudit } from '../sessions/audit';

const setUserRole = httpsCallable<{ uid: string; role: Role }, { ok: boolean }>(functions, 'setUserRole');
const createUserAccount = httpsCallable<
  { email: string; displayName: string; role: Role; rank?: string; agency?: string; phone?: string; password?: string },
  { ok: boolean; uid: string }
>(functions, 'createUserAccount');
const sendActivationEmail = httpsCallable<{ uid: string; password: string }, { ok: boolean }>(functions, 'sendActivationEmail');
const setUserSuspension = httpsCallable<{ uid: string; suspended: boolean; reason?: string }, { ok: boolean }>(functions, 'setUserSuspension');

// Memorable temp passwords in the style "Forest-Tango-Beacon-656": three distinct
// words plus a 3-digit number, dash-separated — easy to read aloud or type.
const PASSWORD_WORDS = [
  'Anchor', 'Bake', 'Beacon', 'Bravo', 'Cedar', 'Cobalt', 'Compass', 'Delta', 'Echo', 'Ember',
  'Falcon', 'Forest', 'Frost', 'Glacier', 'Granite', 'Harbor', 'Indigo', 'Juniper', 'Kestrel',
  'Lagoon', 'Lumen', 'Maple', 'Meadow', 'Nimbus', 'Orchid', 'Pioneer', 'Quartz', 'Quill', 'Ranger',
  'River', 'Sierra', 'Summit', 'Tango', 'Timber', 'Umber', 'Valley', 'Vector', 'Willow', 'Yonder', 'Zephyr',
];
function randomPassword(): string {
  const words = new Set<string>();
  while (words.size < 3) words.add(PASSWORD_WORDS[Math.floor(Math.random() * PASSWORD_WORDS.length)]);
  const num = Math.floor(100 + Math.random() * 900);
  return [...words, num].join('-');
}

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
  const [suspendTarget, setSuspendTarget] = useState<WithId<UserDoc> | null>(null);
  const [addOpen, setAddOpen] = useState(false);
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

  async function liftSuspension(u: WithId<UserDoc>) {
    if (!window.confirm(`Lift the suspension on ${u.displayName}? They regain full access and are emailed.`)) return;
    setBusy(u.id);
    setError(null);
    try {
      await setUserSuspension({ uid: u.id, suspended: false });
    } catch (err) {
      setError(`Lifting ${u.displayName}'s suspension failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader back kicker="Admin" title="Users & Roles" />
      <div className="-mt-2 mb-4 flex justify-end">
        <Button variant="primary" onClick={() => setAddOpen(true)}>
          + Add user
        </Button>
      </div>
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
                        {u.status === 'suspended' && u.suspensionReason && (
                          <div className="mt-0.5 text-xs text-red-700">Suspended: {u.suspensionReason}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Select
                          value={u.role}
                          disabled={busy === u.id}
                          onChange={(e) => changeRole(u, e.target.value as Role)}
                          aria-label={`Role for ${u.displayName}`}
                        >
                          {(Object.keys(ROLE_LABELS) as Role[]).sort((a, b) => ROLE_LABELS[a].localeCompare(ROLE_LABELS[b])).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={u.status === 'active' ? 'green' : u.status === 'suspended' ? 'red' : 'slate'}>
                          {u.status}
                        </Badge>
                      </td>
                      <td className={`px-4 py-3 ${qualTone}`}>
                        <button className="text-bifrost-700 hover:underline" onClick={() => setQualUser(u)}>
                          {verified} verified / {claimed} claimed
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {u.status === 'suspended' ? (
                          <Button variant="ghost" disabled={busy === u.id} onClick={() => liftSuspension(u)}>
                            Lift suspension
                          </Button>
                        ) : (
                          u.status === 'active' && (
                            <>
                              <Button variant="ghost" className="text-amber-700" disabled={busy === u.id} onClick={() => setSuspendTarget(u)}>
                                Suspend
                              </Button>
                              <Button variant="ghost" onClick={() => deactivate(u)}>
                                Deactivate
                              </Button>
                            </>
                          )
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
      {addOpen && <AddUserModal onClose={() => setAddOpen(false)} />}
      {suspendTarget && <SuspendUserModal user={suspendTarget} onClose={() => setSuspendTarget(null)} />}
    </div>
  );
}

/**
 * Suspend a member with a reason. The member keeps the ability to sign in but
 * sees a site-wide banner telling them to contact Academy Leadership, and is
 * emailed the reason. Reinstating (from the table) clears it.
 */
function SuspendUserModal({ user, onClose }: { user: WithId<UserDoc>; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await setUserSuspension({ uid: user.id, suspended: true, reason: reason.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not suspend the account.');
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={busy ? () => {} : onClose} title={`Suspend ${user.displayName}`}>
      <form onSubmit={submit} className="space-y-4 text-sm">
        <div className="rounded-md bg-amber-50 px-3 py-2 text-amber-800">
          They’ll still be able to sign in, but every page shows a banner telling them to contact Academy
          Leadership. They’re emailed the reason below, and can be reinstated any time.
        </div>
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-red-800">{error}</div>}
        <Field label="Reason for suspension" hint="Shown to the member (on-site and by email) and to leadership.">
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus required />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={busy || !reason.trim()}>
            {busy ? 'Suspending…' : 'Suspend account'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Create a new account (admin only). Runs the createUserAccount callable, which
 * makes the Firebase Auth user + profile server-side, so the admin stays signed
 * in. New users get a temporary password and are forced to change it on first
 * sign-in. On success we surface the credentials so the admin can hand them off.
 */
function AddUserModal({ onClose }: { onClose: () => void }) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('instructor');
  const [rank, setRank] = useState('');
  const [agency, setAgency] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('123456');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ uid: string; email: string; password: string; displayName: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);

  function reset() {
    setDisplayName('');
    setEmail('');
    setRole('instructor');
    setRank('');
    setAgency('');
    setPhone('');
    setPassword('123456');
    setError(null);
    setCreated(null);
    setSending(false);
    setSentTo(null);
    setSendErr(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await createUserAccount({ email, displayName, role, rank, agency, phone, password });
      setCreated({ uid: res.data.uid, email: email.trim().toLowerCase(), password: password.trim() || '123456', displayName: displayName.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account.');
    } finally {
      setBusy(false);
    }
  }

  async function sendActivation() {
    if (!created) return;
    setSending(true);
    setSendErr(null);
    try {
      await sendActivationEmail({ uid: created.uid, password: created.password });
      setSentTo(created.email);
    } catch (err) {
      setSendErr(err instanceof Error ? err.message : 'Could not send the activation email.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Add user">
      {created ? (
        <div className="space-y-4 text-sm">
          <div className="rounded-md bg-green-50 px-3 py-2 text-green-800">
            <strong>{created.displayName}</strong> was created. Share these sign-in details:
          </div>
          <dl className="rounded-md border border-watch-100 bg-watch-50 px-3 py-2">
            <div className="flex justify-between py-0.5">
              <dt className="text-slate-500">Email</dt>
              <dd className="font-medium text-watch-900">{created.email}</dd>
            </div>
            <div className="flex justify-between py-0.5">
              <dt className="text-slate-500">Temporary password</dt>
              <dd className="font-mono font-medium text-watch-900">{created.password}</dd>
            </div>
          </dl>
          <p className="text-xs text-slate-500">
            They’ll be prompted to set their own password the first time they sign in.
          </p>

          {/* Activation email — SignUpGenius migration message + this temp password */}
          <div className="rounded-md border border-watch-100 bg-watch-50 px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-watch-800">
                Email <strong>{created.email}</strong> an activation message with these credentials.
              </div>
              <Button variant="primary" onClick={sendActivation} disabled={sending || !!sentTo}>
                {sentTo ? 'Sent ✓' : sending ? 'Sending…' : 'Send activation email'}
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              Explains the SignUpGenius migration and that they must sign in to set a new password.
            </p>
            {sentTo && <p className="mt-1 text-xs text-green-700">Activation email sent to {sentTo}.</p>}
            {sendErr && <p className="mt-1 text-xs text-red-700">{sendErr}</p>}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={reset}>Add another</Button>
            <Button variant="primary" onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
          <Field label="Full name">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Role">
              <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {(Object.keys(ROLE_LABELS) as Role[]).sort((a, b) => ROLE_LABELS[a].localeCompare(ROLE_LABELS[b])).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Rank" hint='e.g. "Deputy"'>
              <Input value={rank} onChange={(e) => setRank(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Agency">
              <Input value={agency} onChange={(e) => setAgency(e.target.value)} />
            </Field>
            <Field label="Phone">
              <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
          </div>
          <Field label="Temporary password" hint="At least 6 characters — they’ll change it on first sign-in. Default is 123456; Generate makes a memorable random one.">
            <div className="flex gap-2">
              <Input value={password} onChange={(e) => setPassword(e.target.value)} required className="flex-1" />
              <Button type="button" variant="secondary" onClick={() => setPassword(randomPassword())}>
                Generate
              </Button>
            </div>
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Creating…' : 'Create user'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/**
 * Manage a member's qualifications. Admins can verify/add or remove ANY
 * qualification regardless of whether the member claimed it. All instructor
 * certs share one FDLE expiration (3/31 of the cert year) — verifying an
 * instructor cert requires that year to be set. Role Player is dateless and
 * needs no verification (just present/absent).
 */
function QualificationsModal({ user, onClose }: { user: WithId<UserDoc>; onClose: () => void }) {
  const { firebaseUser } = useAuth();
  const [quals, setQuals] = useState<Qualification[]>(user.qualifications);
  const [certYear, setCertYear] = useState<string>(
    user.instructorCertExpires ? String(certYearOf(user.instructorCertExpires)) : ''
  );
  const [error, setError] = useState<string | null>(null);
  const [savedCert, setSavedCert] = useState(false);

  const yearNum = parseInt(certYear, 10);
  const certValid = yearNum >= 2000 && yearNum <= 2100;

  async function persist(next: Qualification[], alsoSetCert: boolean) {
    const verifiedQualKeys = next.filter((q) => q.verified).map((q) => q.key);
    const patch: Record<string, unknown> = { qualifications: next, verifiedQualKeys, updatedAt: serverTimestamp() };
    if (alsoSetCert && certValid) patch.instructorCertExpires = tsFromDate(march31(yearNum));
    await updateDoc(doc(db, 'users', user.id), patch);
    setQuals(next);
  }

  async function saveCert() {
    if (!certValid) {
      setError('Enter a valid 4-digit cert year (expiration is 3/31 of that year).');
      return;
    }
    setError(null);
    await updateDoc(doc(db, 'users', user.id), {
      instructorCertExpires: tsFromDate(march31(yearNum)),
      updatedAt: serverTimestamp(),
    });
    await logAudit(firebaseUser!.uid, 'qualification.set_expiration', 'user', user.id, `Cert expiration 3/31/${yearNum} for ${user.displayName}`);
    setSavedCert(true);
    setTimeout(() => setSavedCert(false), 2000);
  }

  async function setQual(key: QualificationKey, on: boolean) {
    const instructor = isInstructorQual(key);
    if (on && instructor && !certValid) {
      setError('Set the certification expiration year first — instructor certs need it.');
      return;
    }
    setError(null);
    const existing = quals.find((q) => q.key === key);
    const next: Qualification[] = on
      ? existing
        ? quals.map((q) => (q.key === key ? { ...q, verified: true, verifiedBy: firebaseUser!.uid } : q))
        : [...quals, { key, label: QUALIFICATION_LABELS[key], verified: true, verifiedBy: firebaseUser!.uid }]
      : quals.filter((q) => q.key !== key);
    await persist(next, on && instructor);
    await logAudit(
      firebaseUser!.uid,
      on ? 'qualification.verify' : 'qualification.remove',
      'user',
      user.id,
      `${on ? 'Verified' : 'Removed'} ${QUALIFICATION_LABELS[key]} for ${user.displayName}`
    );
  }

  return (
    <Modal open onClose={onClose} title={`Qualifications — ${user.displayName}`}>
      <div className="space-y-4">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

        {/* Single FDLE instructor-cert expiration (governs every instructor cert below) */}
        <div className="rounded-md border border-watch-100 bg-watch-50 px-3 py-3">
          <div className="text-sm font-medium text-watch-800">FDLE instructor certification expiration</div>
          <p className="mt-0.5 text-xs text-slate-500">
            Always 3/31 of the cert year, renewed every four years. Required to verify any instructor cert.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-600">
              Current:{' '}
              <strong className="text-watch-900">
                {user.instructorCertExpires ? `3/31/${certYearOf(user.instructorCertExpires)}` : 'not set'}
              </strong>
            </span>
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              Cert year
              <Input type="number" min={2000} max={2100} placeholder="2027" value={certYear} onChange={(e) => setCertYear(e.target.value)} style={{ width: '6rem' }} />
            </label>
            <Button variant="secondary" disabled={!certYear} onClick={saveCert}>
              Save
            </Button>
            {savedCert && <span className="text-xs text-green-700">Saved.</span>}
          </div>
        </div>

        <ul className="space-y-2">
          {(Object.keys(QUALIFICATION_LABELS) as QualificationKey[]).map((key) => {
            const q = quals.find((x) => x.key === key);
            const instructor = isInstructorQual(key);
            return (
              <li key={key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-watch-100 px-3 py-2 text-sm">
                <span className="text-watch-800">
                  {QUALIFICATION_LABELS[key]}
                  {!instructor && <span className="ml-2 text-xs text-slate-400">(dateless)</span>}
                  {instructor && q?.verified && user.instructorCertExpires && (
                    <span className="ml-2 text-xs text-slate-500">expires 3/31/{certYearOf(user.instructorCertExpires)}</span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  {q ? (
                    instructor && q.verified ? (
                      <Badge tone="green">Verified</Badge>
                    ) : instructor ? (
                      <Badge tone="amber">Claimed — pending</Badge>
                    ) : (
                      <Badge tone="green">Active</Badge>
                    )
                  ) : (
                    <Badge tone="slate">Not on file</Badge>
                  )}
                  {!(q && (q.verified || !instructor)) && (
                    <Button variant="primary" onClick={() => setQual(key, true)}>
                      {instructor ? 'Verify' : 'Add'}
                    </Button>
                  )}
                  {q && (
                    <Button variant="ghost" onClick={() => setQual(key, false)}>
                      Remove
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}
