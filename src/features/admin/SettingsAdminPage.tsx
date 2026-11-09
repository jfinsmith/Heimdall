/**
 * Admin — Org settings & branding. Org branding (name, logo, colors,
 * letterhead) appears ONLY on printed documents and outbound email — the app
 * UI itself is always Heimdall-branded (BrandProvider no longer re-themes it).
 */
import React, { useEffect, useState } from 'react';
import { ROSTER_AGENCIES } from '../../types';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../lib/firebase';
import { useDoc, orgConfigPath } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import type { GlobalSettings } from '../../types';
import { Button, Field, Input, PageHeader, Select, TextArea } from '../../components/ui';
import { logAudit } from '../sessions/audit';
import { friendlyError } from '../../lib/callableError';

export function SettingsAdminPage() {
  const { firebaseUser, orgId } = useAuth();
  const { data: settings } = useDoc<GlobalSettings>(orgConfigPath('settings', orgId));
  const [orgName, setOrgName] = useState('');
  const [primary, setPrimary] = useState('#16203a');
  const [accent, setAccent] = useState('#d99320');
  const [logoUrl, setLogoUrl] = useState('');
  const [domains, setDomains] = useState('');
  const [payTarget, setPayTarget] = useState(85);
  const [jurisdiction, setJurisdiction] = useState<'FL' | 'neutral'>('neutral');
  const [tagline, setTagline] = useState('');
  const [addressLines, setAddressLines] = useState('');
  const [siteCode, setSiteCode] = useState('');
  const [agencies, setAgencies] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  async function uploadLogo(file: File) {
    if (!orgId) { setUploadErr('Your account has no organization yet.'); return; }
    // Mirror the Storage rule (images only, under 5 MB) — a rejected upload
    // otherwise surfaces as a baffling "does not have permission" error.
    if (!file.type.startsWith('image/')) { setUploadErr('Choose an image file (PNG, JPG, SVG…).'); return; }
    if (file.size >= 5 * 1024 * 1024) { setUploadErr('That image is too large — logos must be under 5 MB.'); return; }
    setUploading(true);
    setUploadErr(null);
    try {
      const ext = (file.name.split('.').pop() || 'png').replace(/[^a-z0-9]/gi, '').toLowerCase();
      const r = ref(storage, `branding/${orgId}/logo-${Date.now()}.${ext}`);
      await uploadBytes(r, file, { contentType: file.type });
      setLogoUrl(await getDownloadURL(r));
    } catch (e) {
      setUploadErr(friendlyError(e, 'Upload failed — confirm Firebase Storage is enabled, or paste a URL instead.'));
    } finally {
      setUploading(false);
    }
  }

  // Re-seed the form only when one of ITS OWN fields changes in the stored doc.
  // settings/{orgId} is shared with Holidays, Gjallarhorn, rank labels and the
  // Limbo activity list (which coordinators edit from the tracker) — keying on
  // the whole doc wiped every unsaved edit here whenever any of those saved.
  const formSig = settings
    ? JSON.stringify([
        settings.orgName, settings.brandPrimaryColor, settings.brandAccentColor, settings.logoUrl,
        settings.allowedEmailDomains, settings.payPeriodTargetHours, settings.jurisdiction,
        settings.letterheadTagline, settings.letterheadAddressLines, settings.siteCode, settings.agencies,
      ])
    : null;
  useEffect(() => {
    if (!settings) return;
    setOrgName(settings.orgName ?? '');
    setPrimary(settings.brandPrimaryColor ?? '#16203a');
    setAccent(settings.brandAccentColor ?? '#d99320');
    setLogoUrl(settings.logoUrl ?? '');
    setDomains((settings.allowedEmailDomains ?? []).join(', '));
    setPayTarget(settings.payPeriodTargetHours ?? 85);
    setJurisdiction(settings.jurisdiction ?? (orgId === 'phsc' ? 'FL' : 'neutral'));
    setTagline(settings.letterheadTagline ?? '');
    setAddressLines((settings.letterheadAddressLines ?? []).join('\n'));
    setSiteCode(settings.siteCode ?? '');
    // Legacy orgs without a managed list see the built-ins pre-filled so the
    // first save simply persists what they already had.
    setAgencies((settings.agencies?.length ? settings.agencies : ROSTER_AGENCIES.map((a) => a.key).filter((k) => k !== 'Other')).join('\n'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formSig, orgId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await setDoc(
        doc(db, orgConfigPath('settings', orgId)),
        {
          orgName,
          brandPrimaryColor: primary,
          brandAccentColor: accent,
          logoUrl,
          allowedEmailDomains: domains.split(',').map((d) => d.trim()).filter(Boolean),
          payPeriodTargetHours: payTarget,
          jurisdiction,
          letterheadTagline: tagline,
          letterheadAddressLines: addressLines.split('\n').map((l) => l.trim()).filter(Boolean),
          siteCode: siteCode.trim(),
          agencies: [...new Set(agencies.split('\n').map((a) => a.trim()).filter(Boolean))],
        },
        { merge: true }
      );
      await logAudit(firebaseUser!.uid, 'settings.update', 'settings', 'global', 'Updated org settings');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      // Silent failure here read as "saved" — surface it.
      window.alert(`Save failed: ${friendlyError(err, 'unknown error')}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader kicker="Admin" title="Org Settings & Branding" />
      <p className="mb-4 max-w-xl text-sm text-slate-500">
        These control how HEIMDALL identifies your agency outside the app itself: the organization name
        appears in email footers and printed schedule headers, the colors brand your printed documents (the app itself stays Heimdall-branded),
        and the allowed domains restrict who can self-register. If the defaults look right, there is
        nothing you need to do here.
      </p>
      <form onSubmit={save} className="space-y-4 rounded-lg border border-watch-100 bg-white p-5 shadow-sm">
        <Field label="Organization name">
          <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Brand primary color">
            <Input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} />
          </Field>
          <Field label="Brand accent color">
            <Input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} />
          </Field>
        </div>
        <Field
          label="Organization logo (optional)"
          hint="Shown on printed documents and in email (the app itself stays Heimdall-branded). Upload an image, or paste a URL. Blank = the Heimdall wordmark. Remember to Save."
        >
          <div className="space-y-2">
            {logoUrl && (
              <div className="flex items-center gap-3 rounded-md border border-watch-100 bg-watch-50 p-2">
                <img src={logoUrl} alt="Current logo" style={{ height: 40, width: 'auto', maxWidth: 220, objectFit: 'contain' }} />
                <Button type="button" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => setLogoUrl('')}>
                  Remove
                </Button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center rounded-md border border-watch-200 bg-white px-3 py-2 text-sm font-medium text-watch-700 hover:bg-watch-50">
                {uploading ? 'Uploading…' : 'Upload image'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.target.value = ''; }}
                />
              </label>
              <span className="text-xs text-slate-400">or</span>
              <Input className="flex-1" placeholder="https://…/logo.png" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
            </div>
            {uploadErr && <p className="text-sm text-red-600">{uploadErr}</p>}
          </div>
        </Field>
        <Field
          label="Document jurisdiction"
          hint="Governs the statutory wording on academic-action letters: Florida renders the FDLE/CJSTC (F.A.C.) clauses; Generic renders state-neutral wording."
          className="max-w-xs"
        >
          <Select value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value as 'FL' | 'neutral')}>
            <option value="FL">Florida (FDLE / CJSTC)</option>
            <option value="neutral">Generic (state-neutral)</option>
          </Select>
        </Field>
        <Field label="Letterhead tagline (optional)" hint="Shown under your organization name on printed letters">
          <Input value={tagline} onChange={(e) => setTagline(e.target.value)} />
        </Field>
        <Field label="Address / contact lines (optional)" hint="One per line — printed under the document header (e.g. campus addresses)">
          <TextArea value={addressLines} onChange={(e) => setAddressLines(e.target.value)} rows={3} />
        </Field>
        <Field
          label="Site join code (optional)"
          hint="A shared code new members enter on the sign-in 'awaiting organization' screen to join THIS organization (they still land in your pending queue for approval). Blank = no code join. Treat it like a password."
        >
          <Input value={siteCode} onChange={(e) => setSiteCode(e.target.value)} placeholder="e.g. PHSC-CADRE-2026" />
        </Field>
        {siteCode.trim() && (
          // Shareable invite link for the code above — /join/:code parks the
          // code and auto-applies it after sign-in/registration, so invitees
          // never type it (they still land in the pending queue).
          <div className="-mt-2 rounded-md border border-watch-100 bg-watch-50 px-3 py-2 text-sm">
            <span className="mr-2 text-xs font-semibold uppercase tracking-wider text-watch-600">Invite link</span>
            <code className="break-all text-watch-900">{`https://heimdallscheduling.com/join/${encodeURIComponent(siteCode.trim())}`}</code>
            <Button
              type="button"
              variant="ghost"
              className="ml-2"
              onClick={() => {
                void navigator.clipboard?.writeText(`https://heimdallscheduling.com/join/${encodeURIComponent(siteCode.trim())}`);
                setLinkCopied(true);
                setTimeout(() => setLinkCopied(false), 2000);
              }}
            >
              {linkCopied ? 'Copied ✓' : 'Copy'}
            </Button>
            <span className="block text-xs text-slate-500">
              Share this instead of the code — it applies the code automatically when someone registers or signs in.
              {siteCode.trim() !== (settings?.siteCode ?? '').trim() && ' Save settings to activate the code shown.'}
            </span>
          </div>
        )}
        <Field
          label="Auto-join email domains"
          hint="Comma-separated, e.g. sheriff.example.gov, statecollege.edu — new sign-ups from these domains are routed to this organization (still pending your approval). Blank = no auto-join (add members manually)."
        >
          <Input value={domains} onChange={(e) => setDomains(e.target.value)} />
        </Field>
        <Field
          label="Agencies attending your academy"
          hint="One per line. This is the Sponsoring agency picklist on cadet rosters and the agency filter in Limbo (an Other / free-text option always stays available)."
        >
          <TextArea rows={5} value={agencies} onChange={(e) => setAgencies(e.target.value)} placeholder={'PSO\nZPD\nDCPD'} />
        </Field>
        <Field
          label="Pay-period target hours"
          hint="Required hours per bi-weekly pay period before overtime (PSO default 85)"
          className="max-w-[12rem]"
        >
          <Input type="number" min={1} value={payTarget} onChange={(e) => setPayTarget(Number(e.target.value))} />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
          {saved && <span className="text-sm text-green-700">Saved.</span>}
        </div>
      </form>
    </div>
  );
}
