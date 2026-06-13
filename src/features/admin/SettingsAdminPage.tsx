/**
 * Admin — Org settings & branding. Brand colors saved here are applied at
 * runtime by BrandProvider (CSS custom properties), no code edit needed.
 */
import React, { useEffect, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useDoc } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import type { GlobalSettings } from '../../types';
import { Button, Field, Input, PageHeader } from '../../components/ui';
import { logAudit } from '../sessions/audit';

export function SettingsAdminPage() {
  const { firebaseUser } = useAuth();
  const { data: settings } = useDoc<GlobalSettings>('settings/global');
  const [orgName, setOrgName] = useState('');
  const [primary, setPrimary] = useState('#16203a');
  const [accent, setAccent] = useState('#d99320');
  const [logoUrl, setLogoUrl] = useState('');
  const [domains, setDomains] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setOrgName(settings.orgName);
    setPrimary(settings.brandPrimaryColor);
    setAccent(settings.brandAccentColor);
    setLogoUrl(settings.logoUrl ?? '');
    setDomains(settings.allowedEmailDomains.join(', '));
  }, [settings]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    await setDoc(
      doc(db, 'settings', 'global'),
      {
        orgName,
        brandPrimaryColor: primary,
        brandAccentColor: accent,
        logoUrl,
        allowedEmailDomains: domains.split(',').map((d) => d.trim()).filter(Boolean),
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
        <Field label="Logo URL (optional)" hint="Used in email headers; leave blank for the built-in Gjallarhorn mark">
          <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
        </Field>
        <Field
          label="Allowed registration email domains"
          hint="Comma-separated, e.g. sheriff.example.gov, statecollege.edu — blank allows any domain"
        >
          <Input value={domains} onChange={(e) => setDomains(e.target.value)} />
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
