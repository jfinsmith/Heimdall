/**
 * Platform owner — Document Library. One owner-managed library for every org's
 * documents:
 *   - GENERAL forms (built-in FDLE letters + conduct docs, plus owner-created
 *     general documents) are available to every organization.
 *   - SPECIALIZED forms are assigned to specific orgs and swapped in per
 *     discipline under each org's Curriculum & Hours.
 * Forms are stored in the owner-only `documentLibrary` collection.
 */
import React, { useEffect, useState } from 'react';
import { deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import type { WithId } from '../../lib/firestore';
import { Badge, Button, PageHeader } from '../../components/ui';
import { logAudit } from '../sessions/audit';
import { REPORT_TYPES } from '../cadre/reports/reportTypes';
import { useOwnerLibrary, type LibraryFormDoc } from '../cadre/reports/documentLibrary';
import { DocumentBuilderModal } from './DocumentBuilderModal';

const ownerListOrgs = httpsCallable<void, { orgs: { orgId: string; legalName: string }[] }>(functions, 'ownerListOrgs');

export function ReportFormsAdminPage() {
  const { firebaseUser } = useAuth();
  const { forms } = useOwnerLibrary();
  const [orgs, setOrgs] = useState<{ orgId: string; legalName: string }[]>([]);
  const [builder, setBuilder] = useState<{ editing: WithId<LibraryFormDoc> | null; availability: 'general' | 'specialized' } | null>(null);
  const [manageOrgsFor, setManageOrgsFor] = useState<string | null>(null);

  useEffect(() => {
    ownerListOrgs().then((r) => setOrgs(r.data.orgs)).catch(() => {});
  }, []);

  const generalLib = forms.filter((f) => f.availability === 'general');
  const specialized = forms.filter((f) => f.availability === 'specialized');
  const orgName = (id: string) => orgs.find((o) => o.orgId === id)?.legalName ?? id;

  async function removeForm(f: WithId<LibraryFormDoc>) {
    if (!window.confirm(`Delete the document “${f.name}”? Filed reports that used it stay, but it can no longer be selected.`)) return;
    await deleteDoc(doc(db, 'documentLibrary', f.id));
    if (firebaseUser) await logAudit(firebaseUser.uid, 'documentLibrary.delete', 'documentLibrary', f.id, f.name);
  }

  async function toggleOrg(f: WithId<LibraryFormDoc>, orgId: string) {
    const current = f.orgIds ?? [];
    const next = current.includes(orgId) ? current.filter((o) => o !== orgId) : [...current, orgId];
    await updateDoc(doc(db, 'documentLibrary', f.id), { orgIds: next });
  }

  return (
    <div className="max-w-4xl">
      <PageHeader kicker="Platform Owner" title="Document Library" />
      <p className="mb-6 max-w-2xl text-sm text-slate-500">
        One library for every organization’s documents. <strong>General</strong> forms are available to all orgs;
        {' '}<strong>Specialized</strong> forms are assigned to specific orgs and can be swapped in per discipline under
        each org’s <strong>Curriculum &amp; Hours</strong>. The official FDLE letters + conduct documents are built in.
      </p>

      {/* General */}
      <section className="mb-8 rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-watch-600">General forms · available to all orgs</h2>
          <Button variant="primary" onClick={() => setBuilder({ editing: null, availability: 'general' })}>+ New general document</Button>
        </div>
        <div className="divide-y divide-watch-50">
          {REPORT_TYPES.map((t) => (
            <div key={t.id} className="py-2">
              <div className="font-medium text-watch-900">{t.name} <Badge tone="slate">Built-in</Badge></div>
              <div className="text-xs text-slate-500">{t.purpose}</div>
            </div>
          ))}
          {generalLib.map((f) => (
            <div key={f.id} className="flex items-center justify-between py-2">
              <div>
                <div className="font-medium text-watch-900">{f.name} {f.active === false && <Badge tone="amber">Inactive</Badge>}</div>
                <div className="text-xs text-slate-500">{f.purpose || '—'}</div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="ghost" onClick={() => setBuilder({ editing: f, availability: 'general' })}>Edit</Button>
                <Button variant="ghost" className="text-red-700" onClick={() => removeForm(f)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Specialized */}
      <section className="rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-watch-600">Specialized forms · assigned to specific orgs</h2>
          <Button variant="primary" onClick={() => setBuilder({ editing: null, availability: 'specialized' })}>+ New specialized document</Button>
        </div>
        {specialized.length === 0 ? (
          <p className="text-sm text-slate-400">No specialized documents yet.</p>
        ) : (
          <div className="divide-y divide-watch-50">
            {specialized.map((f) => (
              <div key={f.id} className="py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-watch-900">{f.name} {f.active === false && <Badge tone="amber">Inactive</Badge>}</div>
                    <div className="text-xs text-slate-500">{f.purpose || '—'}</div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="ghost" onClick={() => setManageOrgsFor(manageOrgsFor === f.id ? null : f.id)}>
                      Assign orgs ({(f.orgIds ?? []).length})
                    </Button>
                    <Button variant="ghost" onClick={() => setBuilder({ editing: f, availability: 'specialized' })}>Edit</Button>
                    <Button variant="ghost" className="text-red-700" onClick={() => removeForm(f)}>Delete</Button>
                  </div>
                </div>
                {(f.orgIds ?? []).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(f.orgIds ?? []).map((id) => <Badge key={id} tone="navy">{orgName(id)}</Badge>)}
                  </div>
                )}
                {manageOrgsFor === f.id && (
                  <div className="mt-2 grid gap-1 rounded-md border border-watch-100 bg-watch-50 p-3 sm:grid-cols-2">
                    {orgs.map((o) => (
                      <label key={o.orgId} className="flex items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" checked={(f.orgIds ?? []).includes(o.orgId)} onChange={() => toggleOrg(f, o.orgId)} />
                        {o.legalName}
                      </label>
                    ))}
                    {orgs.length === 0 && <p className="text-sm text-slate-400">No organizations found.</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {builder && firebaseUser && (
        <DocumentBuilderModal
          editing={builder.editing}
          availability={builder.availability}
          createdBy={firebaseUser.uid}
          onClose={() => setBuilder(null)}
        />
      )}
    </div>
  );
}
