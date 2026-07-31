/**
 * Admin — Bug & Feature Reports: triage member-submitted feedback. Filter by
 * status/kind, read full detail + screenshots, set status, and jot triage notes.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { doc, orderBy, serverTimestamp, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useCollection, type WithId } from '../../lib/firestore';
import type { FeedbackReportDoc, FeedbackStatus } from '../../types';
import { Badge, Button, Field, PageHeader, Select } from '../../components/ui';

/** Cross-org report shape from the platform-owner callable (screenshots for
 *  OTHER orgs are stripped server-side; timestamps arrive as millis). */
interface OwnerReport {
  id: string;
  orgId: string | null;
  orgName: string;
  kind: string;
  title: string;
  description: string;
  severity: string;
  area?: string;
  stepsToReproduce?: string;
  expected?: string;
  actual?: string;
  status: FeedbackStatus;
  submittedByName: string;
  submittedByRole?: string;
  submittedByEmail?: string;
  createdAtMs: number | null;
  screenshotUrls?: string[];
  screenshotsWithheld?: number;
}
const listAllFeedback = httpsCallable<void, { reports: OwnerReport[] }>(functions, 'listAllFeedback');
const setFeedbackStatusCallable = httpsCallable<
  { id: string; status: FeedbackStatus; comment?: string },
  { ok: boolean; emailed: boolean }
>(functions, 'setFeedbackStatus');

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: 'New',
  in_progress: 'In progress',
  resolved: 'Resolved',
  wont_fix: "Won't fix",
};
const STATUS_TONE: Record<FeedbackStatus, 'amber' | 'navy' | 'green' | 'slate'> = {
  new: 'amber',
  in_progress: 'navy',
  resolved: 'green',
  wont_fix: 'slate',
};
const SEV_TONE: Record<string, 'slate' | 'navy' | 'amber' | 'red'> = {
  low: 'slate',
  medium: 'navy',
  high: 'amber',
  critical: 'red',
};
const ta = 'w-full rounded-md border border-watch-200 px-2 py-1 text-sm';

export function FeedbackAdminPage() {
  const { platformOwner } = useAuth();
  const { data: reports } = useCollection<FeedbackReportDoc>('feedbackReports', [orderBy('createdAt', 'desc')]);
  const [statusFilter, setStatusFilter] = useState<'all' | FeedbackStatus>('all');
  const [kindFilter, setKindFilter] = useState<'all' | 'bug' | 'feature'>('all');
  // Platform-owner cross-org view (read-only; other orgs' screenshots redacted).
  // Owner-only page now — default to the all-organizations view.
  const [allOrgs, setAllOrgs] = useState(true);
  const [ownerReports, setOwnerReports] = useState<OwnerReport[] | null>(null);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const [ownerError, setOwnerError] = useState<string | null>(null);

  useEffect(() => {
    if (!allOrgs || !platformOwner || ownerReports) return;
    setOwnerLoading(true);
    setOwnerError(null);
    listAllFeedback()
      .then((res) => setOwnerReports(res.data.reports))
      .catch((e) => setOwnerError((e as Error).message || 'Could not load cross-org feedback.'))
      .finally(() => setOwnerLoading(false));
  }, [allOrgs, platformOwner, ownerReports]);

  const shown = useMemo(
    () =>
      reports.filter(
        (r) => (statusFilter === 'all' || r.status === statusFilter) && (kindFilter === 'all' || r.kind === kindFilter)
      ),
    [reports, statusFilter, kindFilter]
  );
  const ownerShown = useMemo(
    () =>
      (ownerReports ?? []).filter(
        (r) => (statusFilter === 'all' || r.status === statusFilter) && (kindFilter === 'all' || r.kind === kindFilter)
      ),
    [ownerReports, statusFilter, kindFilter]
  );
  // Count whichever list is actually displayed — the all-orgs view otherwise
  // shows the current org's count over a cross-org list.
  const openCount = (allOrgs && platformOwner ? (ownerReports ?? []) : reports).filter(
    (r) => r.status === 'new' || r.status === 'in_progress'
  ).length;

  async function saveNotes(r: WithId<FeedbackReportDoc>, adminNotes: string) {
    await updateDoc(doc(db, 'feedbackReports', r.id), { adminNotes, updatedAt: serverTimestamp() });
  }

  return (
    <div>
      <PageHeader kicker="Platform Owner" title="Bug & Feature Reports" />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Badge tone={openCount ? 'amber' : 'green'}>{openCount} open</Badge>
        <Field label="Status" className="w-44">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | FeedbackStatus)}>
            <option value="all">All statuses</option>
            {(Object.keys(STATUS_LABEL) as FeedbackStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Type" className="w-40">
          <Select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as 'all' | 'bug' | 'feature')}>
            <option value="all">All types</option>
            <option value="bug">Bugs</option>
            <option value="feature">Features</option>
          </Select>
        </Field>
        {platformOwner && (
          <label className="ml-auto flex items-center gap-2 self-center text-sm text-watch-700" title="Platform owner: view reports across all organizations (other orgs' screenshots are withheld)">
            <input type="checkbox" checked={allOrgs} onChange={(e) => setAllOrgs(e.target.checked)} />
            All organizations
          </label>
        )}
      </div>

      {allOrgs && platformOwner ? (
        <div className="space-y-3">
          <p className="rounded-md bg-watch-50 px-3 py-2 text-xs text-slate-500">
            Cross-organization view. Screenshots from other organizations are withheld — they may contain
            roster PII; only that organization's admins can view them.
          </p>
          {ownerLoading && <p className="px-3 py-8 text-center text-sm text-slate-400">Loading all organizations…</p>}
          {ownerError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{ownerError}</p>}
          {!ownerLoading && !ownerError && ownerShown.map((r) => (
            <OwnerFeedbackCard
              key={r.id}
              r={r}
              onStatusApplied={(status) =>
                setOwnerReports((prev) => (prev ?? []).map((x) => (x.id === r.id ? { ...x, status } : x)))
              }
            />
          ))}
          {!ownerLoading && !ownerError && ownerShown.length === 0 && (
            <p className="rounded-md bg-watch-50 px-3 py-8 text-center text-sm text-slate-400">No reports match these filters.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map((r) => (
            <FeedbackCard key={r.id} r={r} onNotes={saveNotes} />
          ))}
          {shown.length === 0 && (
            <p className="rounded-md bg-watch-50 px-3 py-8 text-center text-sm text-slate-400">No reports match these filters.</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The owner can change any report's status right on the card — a comment is
 * optional, and the reporter is emailed the change either way. Runs through
 * the setFeedbackStatus callable so it works across tenants (rules block
 * cross-org client writes) and so the email actually goes out.
 */
function StatusUpdater({
  id,
  current,
  reporterEmail,
  onApplied,
}: {
  id: string;
  current: FeedbackStatus;
  reporterEmail?: string;
  onApplied?: (status: FeedbackStatus) => void;
}) {
  const [status, setStatus] = useState<FeedbackStatus>(current);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function apply() {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await setFeedbackStatusCallable({ id, status, ...(comment.trim() ? { comment: comment.trim() } : {}) });
      setMsg(res.data.emailed ? `Updated — reporter emailed${reporterEmail ? ` (${reporterEmail})` : ''}.` : 'Updated (no email on file for the reporter).');
      setComment('');
      onApplied?.(status);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update the status.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t border-watch-50 pt-3">
      <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as FeedbackStatus)}>
            {(Object.keys(STATUS_LABEL) as FeedbackStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Comment for the reporter (optional — included in the email)">
          <textarea
            className={ta}
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder='e.g. "Block-hour coverage already shows on the builder calendar — see the n/hrs tag on each course."'
          />
        </Field>
        <div className="flex items-end">
          <Button variant="secondary" disabled={busy || (status === current && !comment.trim())} onClick={apply}>
            {busy ? 'Updating…' : 'Update status'}
          </Button>
        </div>
      </div>
      {msg && <p className="mt-1 text-xs text-green-700">{msg}</p>}
      {err && <p className="mt-1 text-xs text-red-700">{err}</p>}
    </div>
  );
}

/** Cross-org report card for the platform owner (screenshots may be withheld). */
function OwnerFeedbackCard({ r, onStatusApplied }: { r: OwnerReport; onStatusApplied: (s: FeedbackStatus) => void }) {
  return (
    <section className="rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-base">{r.kind === 'bug' ? '🐞' : '💡'}</span>
        <h3 className="font-semibold text-watch-900">{r.title}</h3>
        <Badge tone="navy">{r.orgName}</Badge>
        <Badge tone={SEV_TONE[r.severity] ?? 'slate'}>{r.severity}</Badge>
        <Badge tone={STATUS_TONE[r.status] ?? 'slate'}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
        {r.area && <span className="text-xs text-slate-400">· {r.area}</span>}
      </div>
      <div className="mb-2 text-xs text-slate-500">
        {r.submittedByName || 'Unknown'} {r.submittedByRole ? `(${r.submittedByRole})` : ''}
        {r.submittedByEmail ? ` · ${r.submittedByEmail}` : ''}
        {r.createdAtMs ? ` · ${new Date(r.createdAtMs).toLocaleString()}` : ''}
      </div>
      <p className="whitespace-pre-wrap text-sm text-watch-800">{r.description}</p>
      {(r.stepsToReproduce || r.expected || r.actual) && (
        <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
          {r.stepsToReproduce && <Detail label="Steps">{r.stepsToReproduce}</Detail>}
          {r.expected && <Detail label="Expected">{r.expected}</Detail>}
          {r.actual && <Detail label="Actual">{r.actual}</Detail>}
        </div>
      )}
      {r.screenshotUrls && r.screenshotUrls.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {r.screenshotUrls.map((u, i) => (
            <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="block">
              <img src={u} alt={`Screenshot ${i + 1}`} className="h-24 w-auto rounded-md border border-watch-100 object-cover" />
            </a>
          ))}
        </div>
      )}
      {!!r.screenshotsWithheld && (
        <div className="mt-3 rounded-md bg-watch-50 px-3 py-2 text-xs text-slate-500">
          🔒 {r.screenshotsWithheld} screenshot(s) withheld — viewable only by {r.orgName} admins (possible PII).
        </div>
      )}
      <StatusUpdater id={r.id} current={r.status} reporterEmail={r.submittedByEmail} onApplied={onStatusApplied} />
    </section>
  );
}

function FeedbackCard({
  r,
  onNotes,
}: {
  r: WithId<FeedbackReportDoc>;
  onNotes: (r: WithId<FeedbackReportDoc>, notes: string) => Promise<void>;
}) {
  const [notes, setNotes] = useState(r.adminNotes ?? '');
  const dirty = notes !== (r.adminNotes ?? '');

  return (
    <section className="rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-base">{r.kind === 'bug' ? '🐞' : '💡'}</span>
        <h3 className="font-semibold text-watch-900">{r.title}</h3>
        <Badge tone={SEV_TONE[r.severity] ?? 'slate'}>{r.severity}</Badge>
        <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
        {r.area && <span className="text-xs text-slate-400">· {r.area}</span>}
      </div>
      <div className="mb-2 text-xs text-slate-500">
        {r.submittedByName || 'Unknown'} {r.submittedByRole ? `(${r.submittedByRole})` : ''}
        {r.submittedByEmail ? ` · ${r.submittedByEmail}` : ''}
        {r.createdAt?.toDate ? ` · ${r.createdAt.toDate().toLocaleString()}` : ''}
      </div>

      <p className="whitespace-pre-wrap text-sm text-watch-800">{r.description}</p>

      {(r.stepsToReproduce || r.expected || r.actual) && (
        <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
          {r.stepsToReproduce && <Detail label="Steps">{r.stepsToReproduce}</Detail>}
          {r.expected && <Detail label="Expected">{r.expected}</Detail>}
          {r.actual && <Detail label="Actual">{r.actual}</Detail>}
        </div>
      )}

      {r.screenshotUrls && r.screenshotUrls.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {r.screenshotUrls.map((u, i) => (
            <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="block">
              <img src={u} alt={`Screenshot ${i + 1}`} className="h-24 w-auto rounded-md border border-watch-100 object-cover" />
            </a>
          ))}
        </div>
      )}

      {r.userAgent && <div className="mt-2 truncate text-[10px] text-slate-400" title={r.userAgent}>{r.userAgent}</div>}

      <StatusUpdater id={r.id} current={r.status} reporterEmail={r.submittedByEmail} />
      <div className="mt-2">
        <Field label="Triage notes (private — never emailed)">
          <div className="flex gap-2">
            <textarea className={ta} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <Button variant="ghost" disabled={!dirty} onClick={() => onNotes(r, notes)}>Save</Button>
          </div>
        </Field>
      </div>
    </section>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md bg-watch-50 p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="whitespace-pre-wrap text-watch-800">{children}</div>
    </div>
  );
}
