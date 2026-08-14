/**
 * Platform owner — Document Library. ONE list of every document in the code
 * registry (academic letters + general/conduct docs + read-and-sign forms).
 *
 * Documents are ADDED in code (src/features/cadre/reports/{reportTypes,
 * documentTypes}.tsx — each entry carries an `updated` stamp) and appear here
 * automatically. What the owner controls here is AVAILABILITY: each document
 * is offered to ALL organizations by default, or scoped to selected orgs via
 * documentAssignments/{id} (owner-write, member-read — AcademyReports filters
 * each org's offering with it). Preview renders the real document with sample
 * data. The old in-app "specialized document" builder UI was retired Aug 2026 —
 * new documents go through engineering (the registry) instead.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useCollection } from '../../lib/firestore';
import { Badge, Button, PageHeader } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { logAudit } from '../sessions/audit';
import { REPORT_TYPES, type DocumentAssignmentDoc, type ReportField, type ReportType } from '../cadre/reports/reportTypes';
import { ReportLetter } from '../cadre/reports/ReportLetter';

const ownerListOrgs = httpsCallable<void, { orgs: { orgId: string; legalName: string }[] }>(functions, 'ownerListOrgs');

/** Plausible fake value for a form field — preview only, never persisted. */
function sampleValue(f: ReportField): string {
  const k = f.key.toLowerCase();
  if (f.default) return f.default;
  if (f.type === 'course') return 'CJK 0002 — Introduction to Law Enforcement';
  if (f.type === 'date') return new Date().toISOString().slice(0, 10);
  if (f.type === 'time') return '13:30';
  if (f.type === 'select') return f.options?.[0] ?? 'Sample';
  if (f.type === 'cadet') return 'John Q. Sample';
  if (f.type === 'number') {
    if (k.includes('question')) return '50';
    if (k.includes('minute')) return '90';
    if (k.includes('score')) return '85';
    if (k.includes('hour')) return '40';
    return '12';
  }
  if (f.type === 'textarea') return 'Sample narrative text shown for preview purposes only — the issuing authority replaces this with the actual details when the document is filed.';
  if (k.includes('sequence')) return '65-2026-2010-3';
  if (k.includes('classname') || k.includes('class')) return 'LE 132 65-2026-2010-3';
  if (k.includes('agency')) return "Sample County Sheriff's Office";
  if (k.includes('name') || k.includes('recipient')) return 'John Q. Sample';
  if (k.includes('subject')) return 'Sample subject line';
  return 'Sample';
}
const sampleData = (t: ReportType): Record<string, string> => ({
  ...Object.fromEntries(t.fields.map((f) => [f.key, sampleValue(f)])),
  _memoDate: new Date().toISOString().slice(0, 10),
});

export function ReportFormsAdminPage() {
  const { firebaseUser } = useAuth();
  const [orgs, setOrgs] = useState<{ orgId: string; legalName: string }[]>([]);
  const { data: assignments } = useCollection<DocumentAssignmentDoc>('documentAssignments');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftScope, setDraftScope] = useState<'all' | 'orgs'>('all');
  const [draftOrgIds, setDraftOrgIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ReportType | null>(null);

  useEffect(() => {
    ownerListOrgs().then((r) => setOrgs(r.data.orgs)).catch(() => {});
  }, []);

  const asgById = useMemo(() => new Map(assignments.map((a) => [a.id, a])), [assignments]);
  const orgName = (id: string) => orgs.find((o) => o.orgId === id)?.legalName ?? id;
  const docs = useMemo(() => [...REPORT_TYPES].sort((a, b) => a.name.localeCompare(b.name)), []);

  function openEditor(t: ReportType) {
    const a = asgById.get(String(t.id));
    setDraftScope(a?.scope === 'orgs' ? 'orgs' : 'all');
    setDraftOrgIds(a?.orgIds ?? []);
    setEditingId(String(t.id));
  }

  async function saveAssignment(t: ReportType) {
    setBusy(true);
    try {
      await setDoc(doc(db, 'documentAssignments', String(t.id)), {
        scope: draftScope,
        orgIds: draftScope === 'orgs' ? draftOrgIds : [],
        name: t.name,
        updatedBy: firebaseUser!.uid,
        updatedAt: serverTimestamp(),
      });
      await logAudit(
        firebaseUser!.uid,
        'documentAssignment.set',
        'documentAssignments',
        String(t.id),
        `${t.name} → ${draftScope === 'all' ? 'all organizations' : draftOrgIds.map(orgName).join(', ') || 'NO organizations'}`
      );
      setEditingId(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-4xl">
      <PageHeader kicker="Platform Owner" title="Document Library" />
      <p className="mb-6 max-w-2xl text-sm text-slate-500">
        Every document in the registry, newest changes stamped. Documents are added and edited in code (ask
        HEIMDALL engineering) and appear here automatically. Each one is offered to <strong>all
        organizations</strong> unless you assign it to selected organizations below; orgs can still disable or
        swap forms per discipline under their own Curriculum &amp; Hours.
      </p>

      <section className="rounded-lg border border-watch-100 bg-white shadow-sm">
        <ul className="divide-y divide-watch-100">
          {docs.map((t) => {
            const id = String(t.id);
            const a = asgById.get(id);
            const scoped = a?.scope === 'orgs';
            return (
              <li key={id} className="px-5 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-watch-900">
                      {t.name}
                      {t.updated && <span className="ml-2 text-xs font-normal text-slate-400">Updated {t.updated}</span>}
                    </div>
                    <div className="mt-0.5 max-w-xl text-xs text-slate-500">{t.purpose}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {!scoped ? (
                        <Badge tone="green">All organizations</Badge>
                      ) : (a.orgIds ?? []).length === 0 ? (
                        <Badge tone="red">No organizations — hidden everywhere</Badge>
                      ) : (
                        (a.orgIds ?? []).map((o) => <Badge key={o} tone="navy">{orgName(o)}</Badge>)
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="ghost" onClick={() => setPreview(t)}>Preview example</Button>
                    <Button variant="secondary" onClick={() => (editingId === id ? setEditingId(null) : openEditor(t))}>
                      {editingId === id ? 'Cancel' : 'Assign orgs'}
                    </Button>
                  </div>
                </div>

                {editingId === id && (
                  <div className="mt-3 rounded-md border border-watch-100 bg-watch-50 p-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="radio" checked={draftScope === 'all'} onChange={() => setDraftScope('all')} />
                      Available to <strong>all organizations</strong> (including future ones)
                    </label>
                    <label className="mt-1.5 flex items-center gap-2 text-sm">
                      <input type="radio" checked={draftScope === 'orgs'} onChange={() => setDraftScope('orgs')} />
                      Only these organizations:
                    </label>
                    {draftScope === 'orgs' && (
                      <div className="mt-2 grid gap-1 pl-6 sm:grid-cols-2">
                        {orgs.map((o) => (
                          <label key={o.orgId} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={draftOrgIds.includes(o.orgId)}
                              onChange={() =>
                                setDraftOrgIds((p) =>
                                  p.includes(o.orgId) ? p.filter((x) => x !== o.orgId) : [...p, o.orgId]
                                )
                              }
                            />
                            {o.legalName}
                          </label>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 flex items-center gap-2">
                      <Button variant="primary" disabled={busy} onClick={() => saveAssignment(t)}>
                        Save assignment
                      </Button>
                      {draftScope === 'orgs' && draftOrgIds.length === 0 && (
                        <span className="text-xs font-medium text-red-700">No orgs selected — this hides the document everywhere.</span>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {preview && (
        <Modal open onClose={() => setPreview(null)} title={`Preview — ${preview.name}`} wide>
          <div className="mb-3 rounded-md border border-bifrost-200 bg-bifrost-50 px-3 py-2 text-xs font-medium text-bifrost-900">
            Example preview with sample data — nothing here is filed or saved. Fillable fields show plausible fakes.
          </div>
          <div className="max-h-[70vh] overflow-y-auto rounded border border-watch-100">
            <ReportLetter
              report={{ type: String(preview.id), cadetName: 'John Q. Sample', data: sampleData(preview) }}
              directorName="Pat Sample"
              fromName="Jane Sample"
              reportType={preview}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
