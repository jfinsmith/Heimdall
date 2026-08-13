/**
 * Profile & qualifications. Users edit their own contact info and
 * notification preferences, and may *claim* qualifications — verification is
 * approval-gated (a coordinator verifies via Admin → Users, which is what
 * actually unlocks restricted slots).
 */
// (ChangePasswordCard is defined at the bottom of this file.)
import React, { useEffect, useMemo, useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, auth, functions } from '../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { useOrg } from '../../lib/useOrg';
import type { Qualification, QualificationKey, Role } from '../../types';
import { QUALIFICATION_LABELS, isInstructorQual, EMAIL_AUTOMATIONS, STAFF_ROLES, ADMIN_ROLES } from '../../types';
import { certYearOf, march31, tsFromDate } from '../../lib/time';
import { useAllCurricula, baseCurriculumKey } from '../../lib/curricula';
import { formatPhone } from '../../lib/format';
import { Badge, Button, Field, Input, PageHeader } from '../../components/ui';

export function ProfilePage() {
  const { firebaseUser, profile } = useAuth();
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [rank, setRank] = useState(profile?.rank ?? '');
  const [agency, setAgency] = useState(profile?.agency ?? '');
  // Default an empty agency to the user's organization (overridable).
  const { data: org } = useOrg();
  useEffect(() => {
    if (org?.legalName && !profile?.agency) setAgency((a) => a || org.legalName);
  }, [org?.legalName, profile?.agency]);
  const [saved, setSaved] = useState(false);
  // Optional self-entered FDLE cert expiration year (3/31 of that year). A
  // coordinator confirms/sets it when verifying — it's not required to claim.
  // (Declared with the other hooks, before the early return, per rules-of-hooks.)
  const [certYear, setCertYear] = useState<string>(
    profile?.instructorCertExpires ? String(certYearOf(profile.instructorCertExpires)) : ''
  );
  const [certSaved, setCertSaved] = useState(false);
  const [tab, setTab] = useState<'profile' | 'notifications' | 'quals'>('profile');

  if (!firebaseUser || !profile) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    // Contact fields only — notification prefs live in EmailPreferencesCard
    // (dotted-path writes), so this save can never clobber them.
    await updateDoc(doc(db, 'users', firebaseUser!.uid), {
      phone: formatPhone(phone),
      rank,
      agency,
      updatedAt: serverTimestamp(),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function saveCertYear() {
    const y = parseInt(certYear, 10);
    if (!y || y < 2000 || y > 2100) return;
    await updateDoc(doc(db, 'users', firebaseUser!.uid), {
      instructorCertExpires: tsFromDate(march31(y)),
      updatedAt: serverTimestamp(),
    });
    setCertSaved(true);
    setTimeout(() => setCertSaved(false), 2500);
  }

  async function claimQualification(key: QualificationKey) {
    if (profile!.qualifications.some((q) => q.key === key)) return;
    const next: Qualification[] = [
      ...profile!.qualifications,
      { key, label: QUALIFICATION_LABELS[key], verified: false },
    ];
    await updateDoc(doc(db, 'users', firebaseUser!.uid), { qualifications: next, updatedAt: serverTimestamp() });
  }

  async function removeQualification(key: QualificationKey) {
    // Removing a verified qualification is allowed — re-verification needed to
    // get it back. ALSO strip it from verifiedQualKeys (the authoritative list
    // the server checks for sign-ups/reserves/call-outs) — rules permit
    // removal-only self-edits there, so the member stops being scheduled as
    // qualified the moment they drop the cert.
    const next = profile!.qualifications.filter((q) => q.key !== key);
    const nextVerified = (profile!.verifiedQualKeys ?? []).filter((k) => k !== key);
    await updateDoc(doc(db, 'users', firebaseUser!.uid), {
      qualifications: next,
      verifiedQualKeys: nextVerified,
      updatedAt: serverTimestamp(),
    });
  }

  const noQuals = profile.qualifications.length === 0;
  const TABS = [
    { key: 'profile' as const, label: 'Profile' },
    { key: 'notifications' as const, label: 'Notifications' },
    { key: 'quals' as const, label: 'Qualifications' },
  ];

  return (
    <div className="max-w-5xl">
      <PageHeader kicker="Instructor" title="Profile & Qualifications" />

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-watch-100">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t.key ? 'border-bifrost-500 text-bifrost-700' : 'border-transparent text-slate-500 hover:text-watch-800'
            }`}
          >
            {t.label}
            {t.key === 'quals' && noQuals && (
              // Red flag until they claim SOMETHING — an empty qualification
              // list means they can never be scheduled into qualified slots.
              <span
                className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold leading-none text-white"
                title="No qualifications claimed yet"
              >
                !
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
      <div className="grid items-start gap-6 lg:grid-cols-2">
      <form onSubmit={save} className="space-y-4 rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
        <div className="break-words text-sm text-slate-500">
          {profile.displayName} · {profile.email}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Rank">
            <Input value={rank} onChange={(e) => setRank(e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => setPhone(formatPhone(phone))} />
          </Field>
        </div>
        <Field label="Agency">
          <Input value={agency} onChange={(e) => setAgency(e.target.value)} />
        </Field>

        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary">Save</Button>
          {saved && <span className="text-sm text-green-700">Saved.</span>}
        </div>
      </form>
      <NotificationEmailCard />
      <ChangePasswordCard />
      <UnavailableDatesCard />
      </div>
      )}

      {tab === 'notifications' && (
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <EmailPreferencesCard />
        <CurriculumSubscriptionsCard />
      </div>
      )}

      {tab === 'quals' && (
      <section className="max-w-3xl rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-watch-600">Qualifications</h2>
        <p className="mb-3 text-sm text-slate-500">
          Claim the instructor qualifications you hold; a coordinator verifies them before they unlock
          restricted slots. <strong>Role Player</strong> needs no date, but a coordinator still verifies
          it before you’re added to role-player call-outs.
        </p>

        {/* Single FDLE instructor-cert expiration (governs all instructor certs) */}
        <div className="mb-4 rounded-md border border-watch-100 bg-watch-50 px-3 py-3">
          <div className="text-sm font-medium text-watch-800">FDLE instructor certification expiration</div>
          <p className="mt-0.5 text-xs text-slate-500">
            Tied to your General Instructor course and renewed every four years — always 3/31 of the cert
            year. Optional to enter here; a coordinator confirms it when verifying your certs.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-600">
              Current:{' '}
              <strong className="text-watch-900">
                {profile.instructorCertExpires ? `3/31/${certYearOf(profile.instructorCertExpires)}` : 'not set'}
              </strong>
            </span>
            <span className="text-slate-400">·</span>
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              Cert year
              <Input
                type="number"
                min={2000}
                max={2100}
                placeholder="2027"
                value={certYear}
                onChange={(e) => setCertYear(e.target.value)}
                style={{ width: '6rem' }}
              />
            </label>
            <Button variant="secondary" disabled={!certYear} onClick={saveCertYear}>
              Save expiration
            </Button>
            {certSaved && <span className="text-xs text-green-700">Saved.</span>}
          </div>
        </div>

        <ul className="space-y-2">
          {(Object.keys(QUALIFICATION_LABELS) as QualificationKey[]).map((key) => {
            const q = profile.qualifications.find((x) => x.key === key);
            const instructor = isInstructorQual(key);
            return (
              <li key={key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-watch-100 px-3 py-2 text-sm">
                <span className="text-watch-800">
                  {QUALIFICATION_LABELS[key]}
                  {!instructor && <span className="ml-2 text-xs text-slate-400">(no date)</span>}
                  {instructor && q?.verified && profile.instructorCertExpires && (
                    <span className="ml-2 text-xs text-slate-500">expires 3/31/{certYearOf(profile.instructorCertExpires)}</span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  {q ? (
                    <>
                      {q.verified ? (
                        <Badge tone="green">Verified</Badge>
                      ) : (
                        <Badge tone="amber">Pending verification</Badge>
                      )}
                      <Button variant="ghost" onClick={() => removeQualification(key)}>
                        Remove
                      </Button>
                    </>
                  ) : (
                    <Button variant="secondary" onClick={() => claimQualification(key)}>
                      Claim
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      )}
    </div>
  );
}

/**
 * Secondary notification email — all schedule notifications route HERE instead
 * of the sign-in email once verified (agency inboxes get firewalled; this is
 * the fix). Verification is a 6-digit code emailed to the new address; the
 * whole flow runs through callables (rules block client writes to the fields),
 * so the verified flag can't be forged. Sign-in and account/security emails
 * always keep using the sign-in address.
 */
function NotificationEmailCard() {
  const { firebaseUser, profile } = useAuth();
  const [emailInput, setEmailInput] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  if (!firebaseUser || !profile) return null;

  const pending = profile.notificationEmailPending;
  const verified = profile.notificationEmailVerified ? profile.notificationEmail : undefined;

  async function run(fn: () => Promise<void>) {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Firebase: /, '') : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const sendCode = (email: string) =>
    run(async () => {
      await httpsCallable<{ email: string }, { ok: boolean }>(functions, 'requestNotificationEmail')({ email });
      setInfo('Code sent — check that inbox (and spam).');
      setEmailInput('');
      setChanging(false);
    });
  const confirm = () =>
    run(async () => {
      await httpsCallable<{ code: string }, { ok: boolean }>(functions, 'confirmNotificationEmail')({ code: codeInput });
      setCodeInput('');
      setInfo('Verified — your notifications now go to the new address.');
    });
  const clear = (pendingOnly: boolean) =>
    run(async () => {
      await httpsCallable<{ pendingOnly: boolean }, { ok: boolean }>(functions, 'clearNotificationEmail')({ pendingOnly });
      setCodeInput('');
    });

  return (
    <section className="rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-watch-600">Notification email</h2>
      <p className="mb-3 text-sm text-slate-500">
        Schedule notifications go to <strong>one</strong> address. By default that&apos;s your sign-in email —
        add a different one here (verified with a code) if, say, your agency inbox filters outside mail.
        Sign-in and password emails always use your sign-in address.
      </p>

      {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      {info && <div className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{info}</div>}

      <div className="mb-3 text-sm text-slate-600">
        Currently delivering to:{' '}
        <strong className="break-all text-watch-900">{verified ?? profile.email}</strong>{' '}
        {verified ? <Badge tone="green">Verified</Badge> : <span className="text-xs text-slate-400">(sign-in email)</span>}
      </div>

      {pending ? (
        <div className="rounded-md border border-bifrost-200 bg-bifrost-50 px-3 py-3">
          <div className="text-sm text-watch-800">
            Enter the 6-digit code we emailed to <strong className="break-all">{pending}</strong>:
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              placeholder="123456"
              style={{ width: '7rem', letterSpacing: '0.25em' }}
            />
            <Button variant="primary" disabled={busy || codeInput.length !== 6} onClick={confirm}>
              Verify
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => sendCode(pending)}>
              Resend code
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => clear(true)}>
              Cancel change
            </Button>
          </div>
        </div>
      ) : verified && !changing ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setChanging(true)}>Change address</Button>
          <Button variant="ghost" disabled={busy} onClick={() => clear(false)}>
            Remove — use my sign-in email
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="New notification email" className="min-w-[16rem] flex-1">
            <Input
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              placeholder="you@example.com"
            />
          </Field>
          <Button variant="primary" disabled={busy || !emailInput.includes('@')} onClick={() => sendCode(emailInput)}>
            Send verification code
          </Button>
          {changing && (
            <Button variant="ghost" disabled={busy} onClick={() => { setChanging(false); setEmailInput(''); }}>
              Never mind
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Per-automation email preferences, filtered to what this member's rank can
 * receive (audience tags on EMAIL_AUTOMATIONS). Muting stops the EMAIL only —
 * the in-app bell still fires; priority automations are locked on. The admin
 * org-level toggles sit above all of this.
 */
function EmailPreferencesCard() {
  const { firebaseUser, profile } = useAuth();
  const [leadHours, setLeadHours] = useState(profile?.notificationPrefs.reminderLeadHours ?? 48);
  const [leadSaved, setLeadSaved] = useState(false);
  if (!firebaseUser || !profile) return null;

  const role: Role = profile.role;
  const visible = EMAIL_AUTOMATIONS.filter((a) =>
    a.audience === 'everyone' ? true : a.audience === 'staff' ? STAFF_ROLES.includes(role) : ADMIN_ROLES.includes(role)
  );
  const prefs = profile.notificationPrefs;
  const muted = new Set(prefs.mutedTypes ?? []);
  const isOn = (key: string) =>
    key === 'reminder' ? prefs.email !== false : key === 'digest' ? prefs.digest !== false : !muted.has(key);

  async function toggle(key: string) {
    // reminder/digest keep their legacy booleans (the sweeps read them);
    // everything else flips in the mutedTypes list. Dotted paths only — a
    // whole-object write would clobber prefs saved elsewhere.
    if (key === 'reminder') {
      await updateDoc(doc(db, 'users', firebaseUser!.uid), { 'notificationPrefs.email': prefs.email === false, updatedAt: serverTimestamp() });
    } else if (key === 'digest') {
      await updateDoc(doc(db, 'users', firebaseUser!.uid), { 'notificationPrefs.digest': prefs.digest === false, updatedAt: serverTimestamp() });
    } else {
      const next = muted.has(key) ? [...muted].filter((k) => k !== key) : [...muted, key];
      await updateDoc(doc(db, 'users', firebaseUser!.uid), { 'notificationPrefs.mutedTypes': next, updatedAt: serverTimestamp() });
    }
  }

  async function saveLead() {
    const safe = Number.isFinite(leadHours) ? Math.min(168, Math.max(1, leadHours)) : 48;
    await updateDoc(doc(db, 'users', firebaseUser!.uid), { 'notificationPrefs.reminderLeadHours': safe, updatedAt: serverTimestamp() });
    setLeadHours(safe);
    setLeadSaved(true);
    setTimeout(() => setLeadSaved(false), 2500);
  }

  return (
    <section className="rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-watch-600">Email preferences</h2>
      <p className="mb-3 text-sm text-slate-500">
        Un-check an email you don&apos;t want — the in-app bell still shows everything. Time-critical
        emails are always on. Administrators can additionally disable automations org-wide.
      </p>
      <ul className="space-y-1.5">
        {visible.map((a) => (
          <li key={a.key} className="flex items-start gap-2 text-sm">
            {'priority' in a && a.priority ? (
              <>
                <input type="checkbox" checked disabled className="mt-0.5 opacity-50" />
                <span>
                  <span className="text-watch-800">{a.label}</span>{' '}
                  <Badge tone="slate">Always on</Badge>
                  <span className="block text-xs text-slate-400">{a.description}</span>
                </span>
              </>
            ) : (
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={isOn(a.key)} onChange={() => toggle(a.key)} className="mt-0.5" />
                <span>
                  <span className={isOn(a.key) ? 'text-watch-800' : 'text-slate-400'}>{a.label}</span>
                  <span className="block text-xs text-slate-400">{a.description}</span>
                </span>
              </label>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-watch-100 pt-3 text-sm">
        Reminder lead time:
        <Input
          type="number"
          min={1}
          max={168}
          value={leadHours}
          onChange={(e) => setLeadHours(Number(e.target.value))}
          style={{ width: '5.5rem' }}
        />
        hours before a session
        <Button variant="secondary" onClick={saveLead}>Save</Button>
        {leadSaved && <span className="text-xs text-green-700">Saved.</span>}
      </div>
    </section>
  );
}

/** Self-service blackout days — Browse Open Sessions hides open sessions on these. */
/**
 * Per-curriculum notification subscriptions. Everyone is subscribed to every
 * discipline by default; un-checking one silences that discipline's broadcast
 * notifications (course-open call-outs) across bell AND email — enforced
 * server-side, so nothing is even created for a muted discipline. Personal
 * notifications (own assignments, reminders, account notices) always deliver.
 */
function CurriculumSubscriptionsCard() {
  const { firebaseUser, profile } = useAuth();
  const { platform, org } = useAllCurricula();
  const disciplines = useMemo(() => {
    const seen = new Map<string, string>(); // base key → label (platform first)
    for (const c of [...platform, ...org]) {
      if (c.active === false) continue;
      const key = c.key || baseCurriculumKey(c.id);
      if (!seen.has(key)) seen.set(key, c.label);
    }
    return [...seen.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [platform, org]);
  const muted = useMemo(() => new Set(profile?.notificationPrefs?.mutedCurricula ?? []), [profile]);

  async function toggle(key: string) {
    const next = muted.has(key) ? [...muted].filter((k) => k !== key) : [...muted, key];
    await updateDoc(doc(db, 'users', firebaseUser!.uid), {
      'notificationPrefs.mutedCurricula': next,
      updatedAt: serverTimestamp(),
    });
  }

  if (disciplines.length === 0) return null;
  return (
    <div className="rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-watch-600">Curriculum notifications</h2>
      <p className="mt-1 text-xs text-slate-500">
        You&apos;re subscribed to every discipline by default. Un-check one to stop its course-opening call-outs
        (bell and email). Your own assignments, reminders, and account notices always come through.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {disciplines.map((d) => (
          <label key={d.key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!muted.has(d.key)} onChange={() => toggle(d.key)} />
            <span className={muted.has(d.key) ? 'text-slate-400' : ''}>{d.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function UnavailableDatesCard() {
  const { firebaseUser, profile } = useAuth();
  const [day, setDay] = useState('');
  const dates = useMemo(() => [...(profile?.unavailableDates ?? [])].sort(), [profile]);
  if (!firebaseUser || !profile) return null;

  async function add() {
    if (!day || dates.includes(day)) { setDay(''); return; }
    await updateDoc(doc(db, 'users', firebaseUser!.uid), { unavailableDates: [...dates, day], updatedAt: serverTimestamp() });
    setDay('');
  }
  async function remove(d: string) {
    await updateDoc(doc(db, 'users', firebaseUser!.uid), { unavailableDates: dates.filter((x) => x !== d), updatedAt: serverTimestamp() });
  }

  return (
    <section className="rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-watch-600">Unavailable days</h2>
      <p className="mb-3 text-sm text-slate-500">Mark days you can't work — open sessions on those days are hidden from your Browse Open Sessions list.</p>
      <div className="flex items-end gap-2">
        <Field label="Add a day" className="max-w-[12rem]">
          <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <Button variant="secondary" disabled={!day} onClick={add}>Add</Button>
      </div>
      {dates.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {dates.map((d) => (
            <li key={d} className="flex items-center gap-1.5 rounded-full border border-watch-200 px-3 py-1 text-sm">
              {d}
              <button type="button" className="text-slate-400 hover:text-red-600" aria-label={`Remove ${d}`} onClick={() => remove(d)}>✕</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Self-service password change. Only shown for email/password accounts —
 * Google-sign-in users have no password to change here.
 */
function ChangePasswordCard() {
  const { changePassword } = useAuth();
  const hasPassword = auth.currentUser?.providerData.some((p) => p.providerId === 'password') ?? false;
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!hasPassword) {
    return (
      <section className="rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wider text-watch-600">Password</h2>
        <p className="text-sm text-slate-500">You sign in with Google — manage your password in your Google account.</p>
      </section>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 6) return setError('New password must be at least 6 characters.');
    if (next !== confirm) return setError('The new passwords do not match.');
    setBusy(true);
    try {
      await changePassword(current, next);
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
      setTimeout(() => setDone(false), 3000);
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      setError(
        code === 'auth/wrong-password' || code === 'auth/invalid-credential'
          ? 'Your current password is incorrect.'
          : err instanceof Error
            ? err.message
            : 'Could not change the password.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-watch-600">Change password</h2>
      {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      <form onSubmit={submit} className="grid max-w-md gap-4">
        <Field label="Current password">
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field label="New password" hint="At least 6 characters.">
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        </Field>
        <Field label="Confirm new password">
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Update password'}
          </Button>
          {done && <span className="text-sm text-green-700">Password updated.</span>}
        </div>
      </form>
    </section>
  );
}
