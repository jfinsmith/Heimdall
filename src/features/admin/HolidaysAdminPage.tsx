/**
 * Admin — Holidays: toggle which school holidays shade the calendars. The
 * college may not close for every federal holiday (e.g. Juneteenth), so each
 * can be turned off org-wide.
 */
import React, { useEffect, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useDoc, orgConfigPath } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import { HOLIDAY_DEFS, HOLIDAY_PAY_HOURS } from '../../lib/holidays';
import type { GlobalSettings } from '../../types';
import { Field, Input, PageHeader } from '../../components/ui';
import { logAudit } from '../sessions/audit';

export function HolidaysAdminPage() {
  const { firebaseUser, orgId } = useAuth();
  const { data: settings } = useDoc<GlobalSettings>(orgConfigPath('settings', orgId));
  const disabled = new Set(settings?.disabledHolidays ?? []);
  const observed = new Set(settings?.observedHolidays ?? []);
  const payHours = settings?.holidayPayHours ?? HOLIDAY_PAY_HOURS;
  const [payInput, setPayInput] = useState('');
  useEffect(() => { setPayInput(String(settings?.holidayPayHours ?? HOLIDAY_PAY_HOURS)); }, [settings]);

  async function savePayHours(v: number) {
    if (!Number.isFinite(v) || v < 0) return;
    await setDoc(doc(db, orgConfigPath('settings', orgId)), { holidayPayHours: v }, { merge: true });
    await logAudit(firebaseUser!.uid, 'settings.holidays', 'settings', 'global', `Holiday pay hours = ${v}`);
  }

  async function toggle(key: string, enabled: boolean) {
    const next = new Set(disabled);
    if (enabled) next.delete(key);
    else next.add(key);
    await setDoc(doc(db, orgConfigPath('settings', orgId)), { disabledHolidays: [...next] }, { merge: true });
    await logAudit(firebaseUser!.uid, 'settings.holidays', 'settings', 'global', `${enabled ? 'Enabled' : 'Disabled'} ${key}`);
  }

  async function toggleObserved(key: string, isObserved: boolean) {
    const next = new Set(observed);
    if (isObserved) next.add(key);
    else next.delete(key);
    await setDoc(doc(db, orgConfigPath('settings', orgId)), { observedHolidays: [...next] }, { merge: true });
    await logAudit(firebaseUser!.uid, 'settings.holidays', 'settings', 'global', `${isObserved ? 'Observed' : 'Unobserved'} ${key}`);
  }

  return (
    <div className="max-w-xl">
      <PageHeader kicker="Admin" title="Holidays" />
      <p className="mb-4 text-sm text-slate-500">
        <strong>Shown on calendar</strong> shades the day red so coordinators avoid scheduling on it.{' '}
        <strong>Observed</strong> grants {payHours} hours of holiday pay toward the pay-period total on that
        day (a paid day off). Most agency holidays are both; an agency may stay open for some it still
        observes, or vice-versa.
      </p>
      <Field
        label="Holiday pay hours"
        hint="Hours of pay credited for an observed holiday (a paid day off). Default 8.5."
        className="mb-5 max-w-[12rem]"
      >
        <Input
          type="number"
          min={0}
          step={0.5}
          value={payInput}
          onChange={(e) => setPayInput(e.target.value)}
          onBlur={(e) => savePayHours(Number(e.target.value))}
        />
      </Field>
      <ul className="divide-y divide-watch-50 rounded-lg border border-watch-100 bg-white shadow-sm">
        {HOLIDAY_DEFS.map((h) => {
          const enabled = !disabled.has(h.key);
          const isObserved = observed.has(h.key);
          return (
            <li key={h.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span className="text-sm text-watch-800">{h.label}</span>
              <div className="flex items-center gap-5">
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  Shown on calendar
                  <input type="checkbox" className="h-4 w-4" checked={enabled} onChange={(e) => toggle(h.key, e.target.checked)} />
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  Observed ({payHours} hr pay)
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={isObserved}
                    onChange={(e) => toggleObserved(h.key, e.target.checked)}
                  />
                </label>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
