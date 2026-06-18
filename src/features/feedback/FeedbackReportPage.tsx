/**
 * Report a Problem / Request a Feature — open to every verified member.
 * Collects a structured bug report or feature request (with optional screenshot
 * uploads to Cloud Storage) into `feedbackReports`; an onCreate Cloud Function
 * notifies the admins (Gjallarhorn).
 */
import React, { useState } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import type { FeedbackKind, FeedbackSeverity } from '../../types';
import { Button, Field, Input, PageHeader } from '../../components/ui';

const SEVERITIES: { value: FeedbackSeverity; bug: string; feature: string }[] = [
  { value: 'low', bug: 'Low — minor annoyance', feature: 'Nice to have' },
  { value: 'medium', bug: 'Medium — works but painful', feature: 'Would help a lot' },
  { value: 'high', bug: 'High — blocks part of my work', feature: 'Important' },
  { value: 'critical', bug: 'Critical — blocks me entirely', feature: 'Must have' },
];

const ta = 'w-full rounded-md border border-watch-200 px-3 py-2 text-sm focus:border-bifrost-400 focus:outline-none focus:ring-1 focus:ring-bifrost-400';

export function FeedbackReportPage() {
  const { firebaseUser, profile, role, orgId } = useAuth();
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<FeedbackSeverity>('medium');
  const [area, setArea] = useState('');
  const [steps, setSteps] = useState('');
  const [expected, setExpected] = useState('');
  const [actual, setActual] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [shotsDropped, setShotsDropped] = useState(false);

  const isBug = kind === 'bug';
  const canSubmit = title.trim().length > 2 && description.trim().length > 4 && !busy;

  function addFiles(list: FileList | null) {
    if (!list) return;
    const imgs = Array.from(list).filter((f) => f.type.startsWith('image/') && f.size < 10 * 1024 * 1024);
    setFiles((p) => [...p, ...imgs].slice(0, 5)); // cap at 5
  }

  async function submit() {
    if (!firebaseUser) return;
    setBusy(true);
    setError(null);
    try {
      // Upload screenshots under the member's own uid (Storage rules enforce this).
      const stamp = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
      const screenshotUrls: string[] = [];
      let uploadFailed = false;
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        try {
          const r = ref(storage, `feedback/${firebaseUser.uid}/${stamp}/${i}-${f.name.replace(/[^\w.-]+/g, '_')}`);
          await uploadBytes(r, f, { contentType: f.type });
          screenshotUrls.push(await getDownloadURL(r));
        } catch {
          // Don't lose the whole report if image storage is unavailable — submit
          // the text and note the dropped attachments.
          uploadFailed = true;
        }
      }
      await addDoc(collection(db, 'feedbackReports'), {
        kind,
        title: title.trim(),
        description: description.trim(),
        severity,
        ...(area.trim() ? { area: area.trim() } : {}),
        ...(isBug && steps.trim() ? { stepsToReproduce: steps.trim() } : {}),
        ...(isBug && expected.trim() ? { expected: expected.trim() } : {}),
        ...(isBug && actual.trim() ? { actual: actual.trim() } : {}),
        ...(screenshotUrls.length ? { screenshotUrls } : {}),
        pageUrl: document.referrer || '',
        userAgent: navigator.userAgent,
        ...(orgId ? { orgId } : {}),
        submittedByUid: firebaseUser.uid,
        submittedByName: profile?.displayName ?? firebaseUser.displayName ?? '',
        ...(firebaseUser.email ? { submittedByEmail: firebaseUser.email } : {}),
        ...(role ? { submittedByRole: role } : {}),
        status: 'new',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setShotsDropped(uploadFailed);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit. Please try again.');
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader kicker="Feedback" title="Thanks — we got it" />
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          Your {isBug ? 'bug report' : 'feature request'} was sent to the team. Thank you for helping improve HEIMDALL.
        </div>
        {shotsDropped && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Your report was saved, but the screenshots couldn't be attached. You can reply with them later.
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <Button onClick={() => { setDone(false); setTitle(''); setDescription(''); setArea(''); setSteps(''); setExpected(''); setActual(''); setFiles([]); setBusy(false); }}>
            Submit another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader kicker="Feedback" title="Report a Problem / Request a Feature" />
      <p className="mb-4 -mt-2 text-sm text-slate-500">
        Found a bug or have an idea? Tell us as much as you can — the more detail (and screenshots), the faster we can act.
      </p>

      <div className="space-y-4 rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

        <div className="flex overflow-hidden rounded-md ring-1 ring-watch-200">
          {(['bug', 'feature'] as FeedbackKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={`flex-1 px-3 py-2 text-sm font-medium ${kind === k ? 'bg-watch-800 text-bifrost-300' : 'bg-white text-slate-600 hover:bg-watch-50'}`}
            >
              {k === 'bug' ? '🐞 Bug report' : '💡 Feature request'}
            </button>
          ))}
        </div>

        <Field label="Title" hint="A short summary">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isBug ? 'e.g. Calendar 2-week view shows wrong weeks' : 'e.g. Export roster to Excel'} required />
        </Field>

        <Field label={isBug ? 'What happened?' : 'What would you like?'}>
          <textarea className={ta} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={isBug ? 'Describe the problem.' : 'Describe the feature and why it would help.'} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={isBug ? 'Severity' : 'Priority'}>
            <select className={ta} value={severity} onChange={(e) => setSeverity(e.target.value as FeedbackSeverity)}>
              {SEVERITIES.map((s) => (
                <option key={s.value} value={s.value}>{isBug ? s.bug : s.feature}</option>
              ))}
            </select>
          </Field>
          <Field label="Area" hint="Which page or feature?">
            <Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Roster → Gradebook" />
          </Field>
        </div>

        {isBug && (
          <>
            <Field label="Steps to reproduce" hint="What did you click, in order?">
              <textarea className={ta} rows={3} value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={'1. Open …\n2. Click …\n3. See …'} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Expected">
                <textarea className={ta} rows={2} value={expected} onChange={(e) => setExpected(e.target.value)} />
              </Field>
              <Field label="Actual">
                <textarea className={ta} rows={2} value={actual} onChange={(e) => setActual(e.target.value)} />
              </Field>
            </div>
          </>
        )}

        <Field label="Screenshots" hint="Up to 5 images, 10 MB each">
          <input type="file" accept="image/*" multiple onChange={(e) => addFiles(e.target.files)} className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-watch-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-watch-800 hover:file:bg-watch-200" />
          {files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {files.map((f, i) => (
                <li key={i} className="flex items-center justify-between rounded bg-watch-50 px-2 py-1 text-xs text-slate-600">
                  <span className="truncate">{f.name} · {(f.size / 1024).toFixed(0)} KB</span>
                  <button type="button" className="ml-2 shrink-0 text-slate-400 hover:text-red-600" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}>✕</button>
                </li>
              ))}
            </ul>
          )}
        </Field>

        <div className="flex justify-end">
          <Button variant="primary" onClick={submit} disabled={!canSubmit}>
            {busy ? 'Sending…' : isBug ? 'Submit bug report' : 'Submit request'}
          </Button>
        </div>
      </div>
    </div>
  );
}
