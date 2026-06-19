/**
 * Compliance (Phase 13) — the org admin's posture page:
 *  - data-residency + PII inventory (what we hold; what we deliberately don't),
 *  - Data Processing Agreement review + acceptance (recorded server-side),
 *  - FERPA right-to-access: one-click export of THIS org's records (client-side,
 *    so it can only ever pull data the admin is already allowed to read).
 *
 * The DPA text is a DRAFT template for your counsel (see src/lib/compliance.ts);
 * nothing here asserts a CJIS/FERPA certification.
 */
import React, { useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where, type QueryConstraint } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useOrg } from '../../lib/useOrg';
import { DPA_VERSION, COMPUTE_REGION, PII_INVENTORY, DPA_CLAUSES } from '../../lib/compliance';
import { Badge, Button, PageHeader, Spinner } from '../../components/ui';

const acceptOrgDpa = httpsCallable<{ version: string }, { ok: boolean }>(functions, 'acceptOrgDpa');

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Gather this org's records the admin can read (org-scoped queries so the list
 *  rules are satisfied). FERPA right-to-access. Each collection is fetched
 *  independently so one permission hiccup can't abort the whole export — any
 *  skips are recorded in `_warnings`. Cross-tenant is impossible: every query is
 *  pinned to the caller's own orgId and rules enforce it. */
async function gatherOrgData(orgId: string) {
  const byOrg: QueryConstraint = where('orgId', '==', orgId);
  const warnings: string[] = [];
  const list = async (path: string) => {
    try {
      return (await getDocs(query(collection(db, path), byOrg))).docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch {
      warnings.push(path);
      return [];
    }
  };
  const one = async (path: string) => {
    try {
      const s = await getDoc(doc(db, path));
      return s.exists() ? s.data() : null;
    } catch {
      warnings.push(path);
      return null;
    }
  };
  // The org's assigned specialized library forms (documentLibrary isn't orgId-scoped).
  const libraryForms = async () => {
    try {
      return (await getDocs(query(collection(db, 'documentLibrary'), where('orgIds', 'array-contains', orgId)))).docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch {
      warnings.push('documentLibrary');
      return [];
    }
  };

  const academies = await list('academies');
  const roster: Record<string, unknown[]> = {};
  const reports: Record<string, unknown[]> = {};
  for (const a of academies) {
    roster[a.id] = await list(`academies/${a.id}/roster`);
    reports[a.id] = await list(`academies/${a.id}/reports`);
  }
  return {
    exportedAt: new Date().toISOString(),
    orgId,
    org: await one(`orgs/${orgId}`),
    settings: await one(`settings/${orgId}`),
    users: await list('users'),
    academies,
    roster,
    reports,
    curricula: await list('curricula'),
    documentLibrary: await libraryForms(),
    sessions: await list('sessions'),
    assignments: await list('assignments'),
    feedbackReports: await list('feedbackReports'),
    bulkMessages: await list('bulkMessages'),
    auditLog: await list('auditLog'),
    _notIncluded: [
      'Per-session sign-up rows (sessions/{id}/signups)',
      'Uploaded files in Cloud Storage (bug-report screenshots, organization logos)',
    ],
    ...(warnings.length ? { _warnings: warnings } : {}),
  };
}

export function CompliancePage() {
  const { orgId } = useAuth();
  const { data: org, loading } = useOrg();
  const [busy, setBusy] = useState<null | 'accept' | 'export'>(null);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <div className="flex justify-center py-16"><Spinner className="text-bifrost-400" /></div>;

  const accepted = org?.dpaVersion === DPA_VERSION;
  const acceptedOld = !!org?.dpaVersion && org.dpaVersion !== DPA_VERSION;
  const acceptedOn = org?.dpaAcceptedAt?.toDate?.().toLocaleString();

  async function accept() {
    setBusy('accept');
    setError(null);
    try {
      await acceptOrgDpa({ version: DPA_VERSION });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record acceptance.');
    } finally {
      setBusy(null);
    }
  }

  async function exportData() {
    if (!orgId) return;
    setBusy('export');
    setError(null);
    try {
      const data = await gatherOrgData(orgId);
      downloadJson(`heimdall-${orgId}-export-${new Date().toISOString().slice(0, 10)}.json`, data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader kicker="Administration" title="Compliance & Data" />
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</div>}

      {/* Data residency */}
      <section className="rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-watch-600">Data residency</h2>
        <p className="mt-2 text-sm text-slate-600">
          Your organization’s data is stored and processed in the <strong>United States</strong>. The database
          (Firestore) and application compute (Cloud Functions) run in <code>{org?.dataRegion || COMPUTE_REGION}</code>.
          File storage (Cloud Storage, used for uploaded screenshots and logos) is configured for a US location —
          confirm the bucket location before relying on it for a CJIS-bound tenant.
        </p>
      </section>

      {/* PII inventory */}
      <section className="rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-watch-600">What we store</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-semibold text-watch-700">Stored</div>
            <ul className="space-y-1 text-sm text-slate-600">
              {PII_INVENTORY.stored.map((s) => <li key={s} className="flex gap-2"><span aria-hidden className="text-slate-400">•</span>{s}</li>)}
            </ul>
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold text-watch-700">Never stored</div>
            <ul className="space-y-1 text-sm text-slate-600">
              {PII_INVENTORY.notStored.map((s) => <li key={s} className="flex gap-2"><span aria-hidden className="text-green-600">✓</span>{s}</li>)}
            </ul>
          </div>
        </div>
      </section>

      {/* DPA */}
      <section className="rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-watch-600">Data Processing Agreement</h2>
          {accepted ? <Badge tone="green">Accepted</Badge> : acceptedOld ? <Badge tone="amber">Update required</Badge> : <Badge tone="red">Not accepted</Badge>}
        </div>
        <p className="mt-2 text-xs text-amber-700">
          Draft template — have your counsel review and replace the bracketed items before relying on it.
        </p>
        <dl className="mt-3 space-y-2 text-sm">
          {DPA_CLAUSES.map((c) => (
            <div key={c.heading}>
              <dt className="font-semibold text-watch-800">{c.heading}</dt>
              <dd className="text-slate-600">{c.body}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {accepted ? (
            <p className="text-sm text-green-700">
              Accepted (v{org?.dpaVersion}){acceptedOn ? ` on ${acceptedOn}` : ''}{org?.dpaAcceptedByName ? ` by ${org.dpaAcceptedByName}` : ''}.
            </p>
          ) : (
            <>
              <Button variant="primary" disabled={busy !== null} onClick={accept}>
                {busy === 'accept' ? 'Recording…' : acceptedOld ? `Accept updated agreement (v${DPA_VERSION})` : `Accept agreement (v${DPA_VERSION})`}
              </Button>
              {acceptedOld && <span className="text-xs text-slate-500">Previously accepted v{org?.dpaVersion}.</span>}
            </>
          )}
        </div>
      </section>

      {/* Export / deletion */}
      <section className="rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-watch-600">Export & deletion (FERPA)</h2>
        <p className="mt-2 text-sm text-slate-600">
          Download an export of your organization’s records — academies, roster, grades, academic-action
          documents, staff, scheduling (sessions &amp; assignments), curricula, feedback, and audit history — as a
          JSON file. <span className="text-slate-500">Not included: uploaded files in Cloud Storage (screenshots,
          logos) and per-session sign-up rows.</span> Only your own organization’s data is pulled.
        </p>
        <Button className="mt-3" variant="primary" disabled={busy !== null} onClick={exportData}>
          {busy === 'export' ? 'Gathering…' : 'Export organization data'}
        </Button>
        <p className="mt-4 text-xs text-slate-500">
          Deletion: individual cadet records are removed under <strong>Roster &amp; Certifications</strong> and staff
          accounts under <strong>Users &amp; Roles</strong>. To permanently purge your entire organization, contact the
          platform operator.
        </p>
      </section>
    </div>
  );
}
