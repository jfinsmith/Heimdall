/**
 * Platform-owner console (HEIMDALL operator only). Cross-org control surface:
 *   • Organizations  — list every org; drill into one to see its members + config.
 *   • Onboard        — create an organization (+ seed settings) and its first
 *                      administrator account (the licensing → setup flow).
 *   • Owner queue    — accounts with no org (no domain/code match, or denied):
 *                      assign to an org's PENDING queue (the org admin sets the
 *                      role), or delete the account.
 * Every cross-org read/write goes through platformOwner-gated callables — the
 * owner's own token only sees their own org through the normal app.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import type { Role } from '../../types';
import { RANKS } from '../../lib/rbac';
import { Badge, Button, Field, Input, PageHeader, Select, Spinner } from '../../components/ui';
import { Modal } from '../../components/Modal';

interface QueueAccount { uid: string; email: string; displayName: string; status: string; deniedFromOrgName: string | null; createdAtMs: number | null }
interface OrgSummary { orgId: string; legalName: string; userCount: number }
interface Member { uid: string; displayName: string; email: string; role: string; status: string; rank: string }
interface OrgDetail {
  org: { orgId: string; legalName: string; status: string; shortCode: string; dataRegion: string; dpaAcceptedAt: number | null; dpaAcceptedByName: string; dpaVersion: string; complimentary: boolean; billingEnabled: boolean; subscriptionStatus: string };
  settings: { orgName: string; allowedEmailDomains: string[]; siteCode: string; jurisdiction: string };
  members: Member[];
  memberCount: number;
  pendingCount: number;
}

const listOwnerQueue = httpsCallable<void, { queue: QueueAccount[]; orgs: OrgSummary[] }>(functions, 'listOwnerQueue');
const getOrgDetail = httpsCallable<{ orgId: string }, OrgDetail>(functions, 'getOrgDetail');
const createOrg = httpsCallable<{ shortCode: string; legalName: string; allowedEmailDomains: string[]; jurisdiction: 'FL' | 'neutral' }, { ok: boolean; orgId: string }>(functions, 'createOrg');
const createOrgAdmin = httpsCallable<{ orgId: string; email: string; displayName: string; role: Role }, { ok: boolean; uid: string; tempPassword: string }>(functions, 'createOrgAdmin');
const assignUserToOrg = httpsCallable<{ uid: string; orgId: string }, { ok: boolean }>(functions, 'assignUserToOrg');
const deleteUnassignedAccount = httpsCallable<{ uid: string }, { ok: boolean }>(functions, 'deleteUnassignedAccount');
const setOrgComplimentaryFn = httpsCallable<{ orgId: string; complimentary: boolean }, { ok: boolean; complimentary: boolean }>(functions, 'setOrgComplimentary');

const ROLE_LABEL: Record<string, string> = Object.fromEntries(RANKS.map((r) => [r.key, r.defaultLabel]));
const ADMIN_ROLE_OPTIONS = RANKS.filter((r) => r.key === 'director' || r.key === 'lieutenant');

export function OwnerConsolePage() {
  const [queue, setQueue] = useState<QueueAccount[]>([]);
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [newOrgOpen, setNewOrgOpen] = useState(false);
  const [addAdminOrg, setAddAdminOrg] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listOwnerQueue()
      .then((r) => { setQueue(r.data.queue); setOrgs(r.data.orgs); })
      .catch((e) => setError((e as Error).message || 'Could not load the owner console.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const openOrg = useCallback((orgId: string) => {
    setSelectedOrgId(orgId);
    setDetail(null);
    setDetailLoading(true);
    setError(null);
    getOrgDetail({ orgId })
      .then((r) => setDetail(r.data))
      .catch((e) => setError((e as Error).message || 'Could not load that organization.'))
      .finally(() => setDetailLoading(false));
  }, []);

  async function assign(uid: string, orgId: string) {
    if (!orgId) return;
    setBusy(uid);
    setError(null);
    try { await assignUserToOrg({ uid, orgId }); load(); }
    catch (e) { setError((e as Error).message || 'Could not assign the account.'); }
    finally { setBusy(null); }
  }

  async function del(uid: string, label: string) {
    if (!window.confirm(`Permanently delete the account for ${label}? This removes their login and cannot be undone.`)) return;
    setBusy(uid);
    setError(null);
    try { await deleteUnassignedAccount({ uid }); load(); }
    catch (e) { setError((e as Error).message || 'Could not delete the account.'); }
    finally { setBusy(null); }
  }

  return (
    <div>
      <PageHeader
        kicker="Platform Owner"
        title="Owner Console"
        actions={
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => setNewOrgOpen(true)}>+ New organization</Button>
            <Button onClick={() => { load(); if (selectedOrgId) openOrg(selectedOrgId); }}>Refresh</Button>
          </div>
        }
      />
      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {selectedOrgId ? (
        <OrgDetailPanel
          detail={detail}
          loading={detailLoading}
          busy={busy === selectedOrgId}
          onBack={() => { setSelectedOrgId(null); setDetail(null); }}
          onAddAdmin={() => setAddAdminOrg(selectedOrgId)}
          onToggleComplimentary={async (complimentary) => {
            setBusy(selectedOrgId);
            try { await setOrgComplimentaryFn({ orgId: selectedOrgId, complimentary }); openOrg(selectedOrgId); load(); }
            catch (e) { setError((e as Error).message || 'Failed to update complimentary status.'); }
            finally { setBusy(null); }
          }}
        />
      ) : (
        <>
          <section className="mb-6 rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-watch-600">Organizations</h2>
            {loading ? (
              <div className="py-6 text-center"><Spinner className="text-bifrost-400" /></div>
            ) : orgs.length === 0 ? (
              <p className="text-sm text-slate-400">No organizations yet — create one above.</p>
            ) : (
              <ul className="divide-y divide-watch-50">
                {orgs.map((o) => (
                  <li key={o.orgId}>
                    <button
                      onClick={() => openOrg(o.orgId)}
                      className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-sm hover:bg-watch-50"
                    >
                      <span className="font-medium text-watch-900">{o.legalName}</span>
                      <span className="flex items-center gap-3 text-slate-500">
                        {o.userCount} member{o.userCount === 1 ? '' : 's'} · {o.orgId}
                        <i className="ti ti-chevron-right" aria-hidden="true" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-watch-600">
              Unassigned accounts {queue.length > 0 && <Badge tone="amber">{queue.length}</Badge>}
            </h2>
            <p className="mb-3 text-xs text-slate-500">
              Accounts with no organization — they never matched an email domain or join code, or an org denied them.
              Assign each to an organization (they land in that org’s pending queue for the admin to set a role), or delete.
            </p>
            {loading ? (
              <div className="py-8 text-center"><Spinner className="text-bifrost-400" /></div>
            ) : queue.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">No accounts waiting.</p>
            ) : (
              <ul className="space-y-2">
                {queue.map((a) => (
                  <QueueRow key={a.uid} a={a} orgs={orgs} busy={busy === a.uid} onAssign={assign} onDelete={del} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {newOrgOpen && (
        <NewOrgModal
          onClose={() => setNewOrgOpen(false)}
          onDone={(orgId) => { setNewOrgOpen(false); load(); setAddAdminOrg(orgId); }}
        />
      )}
      {addAdminOrg && (
        <AddAdminModal
          orgId={addAdminOrg}
          orgLabel={detail?.org.legalName ?? orgs.find((o) => o.orgId === addAdminOrg)?.legalName ?? addAdminOrg}
          onClose={() => setAddAdminOrg(null)}
          onDone={() => { setAddAdminOrg(null); if (selectedOrgId) openOrg(selectedOrgId); load(); }}
        />
      )}
    </div>
  );
}

function QueueRow({ a, orgs, busy, onAssign, onDelete }: {
  a: QueueAccount; orgs: OrgSummary[]; busy: boolean;
  onAssign: (uid: string, orgId: string) => void; onDelete: (uid: string, label: string) => void;
}) {
  const [org, setOrg] = useState('');
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-watch-100 px-3 py-2 text-sm">
      <div className="min-w-[12rem] flex-1">
        <div className="font-medium text-watch-900">{a.displayName || a.email || a.uid}</div>
        <div className="text-xs text-slate-500">
          {a.email}
          {a.deniedFromOrgName ? <span className="text-amber-700"> · denied by {a.deniedFromOrgName}</span> : ''}
        </div>
      </div>
      <Select value={org} onChange={(e) => setOrg(e.target.value)} className="w-44">
        <option value="">Choose org…</option>
        {orgs.map((o) => <option key={o.orgId} value={o.orgId}>{o.legalName}</option>)}
      </Select>
      <Button variant="primary" disabled={!org || busy} onClick={() => onAssign(a.uid, org)}>
        {busy ? 'Working…' : 'Assign to queue'}
      </Button>
      <Button variant="ghost" className="text-red-600 hover:bg-red-50" disabled={busy} onClick={() => onDelete(a.uid, a.displayName || a.email || a.uid)}>
        Delete
      </Button>
    </li>
  );
}

function OrgDetailPanel({ detail, loading, busy, onBack, onAddAdmin, onToggleComplimentary }: {
  detail: OrgDetail | null; loading: boolean; busy: boolean; onBack: () => void; onAddAdmin: () => void;
  onToggleComplimentary: (complimentary: boolean) => void;
}) {
  return (
    <div>
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm text-bifrost-700 hover:underline">
        <i className="ti ti-arrow-left" aria-hidden="true" /> All organizations
      </button>
      {loading || !detail ? (
        <div className="py-10 text-center"><Spinner className="text-bifrost-400" /></div>
      ) : (
        <>
          <section className="mb-5 rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-watch-900">{detail.org.legalName}</div>
                <div className="text-xs text-slate-500">{detail.org.orgId} · {detail.memberCount} member{detail.memberCount === 1 ? '' : 's'}{detail.pendingCount > 0 ? ` · ${detail.pendingCount} pending` : ''}</div>
              </div>
              <Button variant="primary" onClick={onAddAdmin}>+ Add administrator</Button>
            </div>
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Info label="Status" value={detail.org.status} />
              <Info label="Jurisdiction" value={detail.settings.jurisdiction || '—'} />
              <Info label="Data region" value={detail.org.dataRegion || '—'} />
              <Info
                label="DPA accepted"
                value={
                  detail.org.dpaAcceptedAt
                    ? `v${detail.org.dpaVersion} · ${new Date(detail.org.dpaAcceptedAt).toLocaleDateString()}${detail.org.dpaAcceptedByName ? ` · ${detail.org.dpaAcceptedByName}` : ''}`
                    : 'Not yet'
                }
              />
              <Info label="Site join code" value={detail.settings.siteCode || '(none set)'} />
              <Info label="Auto-join domains" value={detail.settings.allowedEmailDomains.length ? detail.settings.allowedEmailDomains.join(', ') : '(none)'} />
            </dl>
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-watch-50 pt-3">
              <span className="text-sm">
                <span className="font-medium text-watch-800">Billing:</span>{' '}
                {detail.org.complimentary
                  ? 'Complimentary — never billed or gated'
                  : detail.org.billingEnabled
                    ? `Commercial · ${detail.org.subscriptionStatus}`
                    : 'Not commercialized'}
              </span>
              <Button variant="ghost" disabled={busy} onClick={() => onToggleComplimentary(!detail.org.complimentary)}>
                {detail.org.complimentary ? 'Remove complimentary' : 'Mark complimentary'}
              </Button>
            </div>
          </section>

          <section className="rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-watch-600">Members ({detail.memberCount})</h2>
            {detail.members.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">No members yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-watch-50 text-xs uppercase tracking-wider text-watch-600">
                    <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Status</th></tr>
                  </thead>
                  <tbody className="divide-y divide-watch-50">
                    {detail.members.map((m) => (
                      <tr key={m.uid}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-watch-900">{m.displayName || '—'}</div>
                          <div className="text-xs text-slate-500">{m.email}</div>
                        </td>
                        <td className="px-3 py-2">{ROLE_LABEL[m.role] ?? m.role ?? '—'}</td>
                        <td className="px-3 py-2">
                          <Badge tone={m.status === 'active' ? 'green' : m.status === 'suspended' ? 'red' : 'amber'}>{m.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-watch-900">{value}</dd>
    </div>
  );
}

function NewOrgModal({ onClose, onDone }: { onClose: () => void; onDone: (orgId: string) => void }) {
  const [legalName, setLegalName] = useState('');
  const [shortCode, setShortCode] = useState('');
  const [domains, setDomains] = useState('');
  const [jurisdiction, setJurisdiction] = useState<'FL' | 'neutral'>('neutral');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await createOrg({
        legalName: legalName.trim(),
        shortCode: (shortCode || legalName).trim(),
        allowedEmailDomains: domains.split(',').map((d) => d.trim()).filter(Boolean),
        jurisdiction,
      });
      onDone(r.data.orgId);
    } catch (e) {
      setError((e as Error).message || 'Could not create the organization.');
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="New organization">
      <div className="space-y-4">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
        <p className="text-xs text-slate-500">Creates the organization and seeds its settings. You’ll add its first administrator next.</p>
        <Field label="Legal name" hint="e.g. Pasco-Hernando State College">
          <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} required />
        </Field>
        <Field label="Short code" hint="Letters/digits only; used as the org id prefix (e.g. phsc → phsc-7f3a9c). Defaults from the name.">
          <Input value={shortCode} onChange={(e) => setShortCode(e.target.value)} placeholder="phsc" />
        </Field>
        <Field label="Auto-join email domains (optional)" hint="Comma-separated; new sign-ups from these domains route to this org’s pending queue. Blank = manual/code only.">
          <Input value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="statecollege.edu" />
        </Field>
        <Field label="Document jurisdiction" className="max-w-xs">
          <Select value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value as 'FL' | 'neutral')}>
            <option value="neutral">Generic (state-neutral)</option>
            <option value="FL">Florida (FDLE / CJSTC)</option>
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={busy || !legalName.trim()}>
            {busy ? 'Creating…' : 'Create organization'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function AddAdminModal({ orgId, orgLabel, onClose, onDone }: {
  orgId: string; orgLabel: string; onClose: () => void; onDone: () => void;
}) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('director');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; tempPassword: string } | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await createOrgAdmin({ orgId, email: email.trim(), displayName: displayName.trim(), role });
      setCreated({ email: email.trim(), tempPassword: r.data.tempPassword });
    } catch (e) {
      setError((e as Error).message || 'Could not create the administrator.');
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={created ? onDone : onClose} title={`Add administrator — ${orgLabel}`}>
      {created ? (
        <div className="space-y-3">
          <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
            Administrator created and emailed activation instructions to {created.email}.
          </div>
          <div className="rounded-md border border-watch-100 bg-watch-50 px-3 py-2 text-sm">
            <div className="text-xs text-slate-500">Temporary password (also emailed — they set their own on first login)</div>
            <div className="font-mono text-watch-900">{created.tempPassword}</div>
          </div>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onDone}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
          <p className="text-xs text-slate-500">Creates an active admin login for this organization, emails a temporary password, and forces a password change on first sign-in.</p>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Full name">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </Field>
          <Field label="Role" className="max-w-xs">
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ADMIN_ROLE_OPTIONS.map((r) => <option key={r.key} value={r.key}>{r.defaultLabel}</option>)}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={busy || !email.trim() || !displayName.trim()}>
              {busy ? 'Creating…' : 'Create administrator'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
