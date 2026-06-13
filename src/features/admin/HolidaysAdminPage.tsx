/**
 * Admin — Holidays: toggle which school holidays shade the calendars. The
 * college may not close for every federal holiday (e.g. Juneteenth), so each
 * can be turned off org-wide.
 */
import React from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useDoc } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import { HOLIDAY_DEFS } from '../../lib/holidays';
import type { GlobalSettings } from '../../types';
import { PageHeader } from '../../components/ui';
import { logAudit } from '../sessions/audit';

export function HolidaysAdminPage() {
  const { firebaseUser } = useAuth();
  const { data: settings } = useDoc<GlobalSettings>('settings/global');
  const disabled = new Set(settings?.disabledHolidays ?? []);
  const observed = new Set(settings?.observedHolidays ?? []);

  async function toggle(key: string, enabled: boolean) {
    const next = new Set(disabled);
    if (enabled) next.delete(key);
    else next.add(key);
    await setDoc(doc(db, 'settings', 'global'), { disabledHolidays: [...next] }, { merge: true });
    await logAudit(firebaseUser!.uid, 'settings.holidays', 'settings', 'global', `${enabled ? 'Enabled' : 'Disabled'} ${key}`);
  }

  async function toggleObserved(key: string, isObserved: boolean) {
    const next = new Set(observed);
    if (isObserved) next.add(key);
    else next.delete(key);
    await setDoc(doc(db, 'settings', 'global'), { observedHolidays: [...next] }, { merge: true });
    await logAudit(firebaseUser!.uid, 'settings.holidays', 'settings', 'global', `${isObserved ? 'Observed' : 'Unobserved'} ${key}`);
  }

  return (
    <div className="max-w-xl">
      <PageHeader back kicker="Admin" title="Holidays" />
      <p className="mb-4 text-sm text-slate-500">
        <strong>Shown on calendar</strong> shades the day red so coordinators avoid scheduling on it.{' '}
        <strong>PSO observed</strong> grants 8.5 hours of holiday pay toward the pay-period total on that
        day (a paid day off). Most agency holidays are both; the college may stay open for some you still
        observe, or vice-versa.
      </p>
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
                  PSO observed (8.5 hr pay)
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
