/**
 * Public class link — coordinator panel in the builder. Generates the
 * capability link (/class/{id}/{token}) served by the public portal callable.
 * Tier 1's access code is ALWAYS the digits of the class designation
 * ("LE 132" → 132); tier 2 (gradebook + discipline) is enabled by setting an
 * academic password here — stored only as a SHA-256 hash, never plaintext.
 */
import React, { useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../../auth/AuthContext';
import { sha256Hex, randomToken } from '../../lib/hash';
import type { AcademyDoc } from '../../types';
import type { WithId } from '../../lib/firestore';
import { Badge, Button, Input } from '../../components/ui';
import { logAudit } from '../sessions/audit';

export function PublicLinkSection({ academy, className = '' }: { academy: WithId<AcademyDoc>; className?: string }) {
  const { firebaseUser } = useAuth();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  if (academy.isTemplate) return null;

  const portal = academy.portal;
  const codeDigits = (academy.shortName ?? '').replace(/\D+/g, '');
  const link = portal?.token ? `${window.location.origin}/class/${academy.id}/${portal.token}` : '';

  async function save(next: NonNullable<AcademyDoc['portal']>, summary: string) {
    setBusy(true);
    try {
      await updateDoc(doc(db, 'academies', academy.id), { portal: next, updatedAt: serverTimestamp() });
      if (firebaseUser) await logAudit(firebaseUser.uid, 'academy.portal', 'academy', academy.id, summary);
    } catch (err) {
      window.alert(`Could not update the public link: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  async function setAcademicPassword() {
    const value = pw.trim();
    if (!value || !portal) return;
    const academicHash = await sha256Hex(value);
    await save({ ...portal, academicHash }, 'Set the academic-tier password on the public class link');
    setPw('');
  }

  return (
    <section className={`rounded-lg border border-watch-100 bg-white p-4 shadow-sm ${className}`}>
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-watch-600">Public class link</h2>
        {portal?.enabled ? <Badge tone="green">live</Badge> : <Badge tone="slate">off</Badge>}
      </div>
      <p className="mb-2 text-xs text-slate-500">
        View-only link for cadets and interested parties: the schedule behind a simple access code, plus an
        optional gradebook + discipline view behind a password you set.
      </p>

      {!portal?.enabled ? (
        <Button
          variant="primary"
          disabled={busy || !codeDigits}
          title={codeDigits ? undefined : 'Set a class designation with digits (e.g. LE 132) first — it becomes the access code.'}
          onClick={() => save({ enabled: true, token: portal?.token ?? randomToken(), ...(portal?.academicHash ? { academicHash: portal.academicHash } : {}) }, 'Enabled the public class link')}
        >
          Create public link
        </Button>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <code className="max-w-full truncate rounded bg-watch-50 px-2 py-1 text-xs text-watch-800">{link}</code>
            <Button
              variant="ghost"
              onClick={async () => {
                await navigator.clipboard.writeText(link);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? 'Copied ✓' : 'Copy link'}
            </Button>
          </div>
          <div className="text-xs text-slate-600">
            Access code: <strong className="tabular-nums text-watch-900">{codeDigits}</strong> (the digits of {academy.shortName})
          </div>

          <div className="rounded-md border border-watch-100 bg-watch-50/50 p-2.5">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-watch-600">
              Academic information (tier 2)
              {portal.academicHash ? <Badge tone="green">enabled</Badge> : <Badge tone="slate">off</Badge>}
            </div>
            <p className="mb-2 text-xs text-slate-500">
              Gradebook + discipline behind a second, stronger password — share it only with people who should
              see grades.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="text"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder={portal.academicHash ? 'New password (replaces current)' : 'Set academic password'}
                className="max-w-xs"
              />
              <Button variant="ghost" disabled={busy || !pw.trim()} onClick={setAcademicPassword}>
                {portal.academicHash ? 'Change' : 'Enable'}
              </Button>
              {portal.academicHash && (
                <Button
                  variant="ghost"
                  className="text-red-700"
                  disabled={busy}
                  onClick={() => save({ enabled: portal.enabled, token: portal.token }, 'Disabled the academic tier on the public class link')}
                >
                  Turn off
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (!window.confirm('Generate a NEW link? Anyone using the old link loses access.')) return;
                save({ ...portal, token: randomToken() }, 'Regenerated the public class link');
              }}
            >
              New link
            </Button>
            <Button
              variant="ghost"
              className="text-red-700"
              disabled={busy}
              onClick={() => save({ ...portal, enabled: false }, 'Disabled the public class link')}
            >
              Disable
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
