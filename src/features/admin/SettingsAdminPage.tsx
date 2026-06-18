/**
 * Admin — Org settings & branding. Brand colors saved here are applied at
 * runtime by BrandProvider (CSS custom properties), no code edit needed.
 */
import React, { useEffect, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../lib/firebase';
import { useDoc, orgConfigPath } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import type { GlobalSettings } from '../../types';
import { Button, Field, Input, PageHeader, Select } from '../../components/ui';
import { logAudit } from '../sessions/audit';

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
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  async function uploadLogo(file: File) {
    if (!orgId) { setUploadErr('Your account has no organization yet.'); return; }
    setUploading(true);
    setUploadErr(null);
    try {
      const ext = (file.name.split('.').pop() || 'png').replace(/[^a-z0-9]/gi, '').toLowerCase();
      const r = ref(storage, `branding/${orgId}/logo-${Date.now()}.${ext}`);
      await uploadBytes(r, file, { contentType: file.type });
      setLogoUrl(await getDownloadURL(r));
    } catch (e) {
      setUploadErr((e as Error).message || 'Upload failed — confirm Firebase Storage is enabled, or paste a URL instead.');
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    if (!settings) return;
    setOrgName(settings.orgName);
    setPrimary(settings.brandPrimaryColor);
    setAccent(settings.brandAccentColor);
    setLogoUrl(settings.logoUrl ?? '');
    setDomains(settings.allowedEmailDomains.join(', '));
    setPayTarget(settings.payPeriodTargetHours ?? 85);
    setJurisdiction(settings.jurisdiction ?? (orgId === 'phsc' ? 'FL' : 'neutral'));
    setTagline(settings.letterheadTagline ?? '');
  }, [settings, orgId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
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
      },
      { merge: true }
    );
    await logAudit(firebaseUser!.uid, 'settings.update', 'settings', 'global', 'Updated org settings');
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="max-w-xl">
      <PageHeader back kicker="Admin" title="Org Settings & Branding" />
      <p className="mb-4 max-w-xl text-sm text-slate-500">
        These control how HEIMDALL identifies your agency outside the app itself: the organization name
        appears in email footers and printed schedule headers, the colors re-tint the interface accent,
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
          hint="Shown in the app, on printed documents, and in email. Upload an image, or paste a URL. Blank = the Heimdall wordmark. Remember to Save."
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
        <Field
          label="Auto-join email domains"
          hint="Comma-separated, e.g. sheriff.example.gov, statecollege.edu — new sign-ups from these domains are routed to this organization (still pending your approval). Blank = no auto-join (add members manually)."
        >
          <Input value={domains} onChange={(e) => setDomains(e.target.value)} />
        </Field>
        <Field
          label="Pay-period target hours"
          hint="Required hours per bi-weekly pay period before overtime (PSO default 85)"
          className="max-w-[12rem]"
        >
          <Input type="number" min={1} value={payTarget} onChange={(e) => setPayTarget(Number(e.target.value))} />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary">
            Save settings
          </Button>
          {saved && <span className="text-sm text-green-700">Saved.</span>}
        </div>
      </form>
    </div>
  );
}
