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

  async function toggle(key: string, enabled: boolean) {
    const next = new Set(disabled);
    if (enabled) next.delete(key);
    else next.add(key);
    await setDoc(doc(db, 'settings', 'global'), { disabledHolidays: [...next] }, { merge: true });
    await logAudit(firebaseUser!.uid, 'settings.holidays', 'settings', 'global', `${enabled ? 'Enabled' : 'Disabled'} ${key}`);
  }

  return (
    <div className="max-w-xl">
      <PageHeader back kicker="Admin" title="Holidays" />
      <p className="mb-4 text-sm text-slate-500">
        Checked holidays shade the calendars in red so coordinators avoid scheduling on them. Uncheck any
        the college stays open for.
      </p>
      <ul className="divide-y divide-watch-50 rounded-lg border border-watch-100 bg-white shadow-sm">
        {HOLIDAY_DEFS.map((h) => {
          const enabled = !disabled.has(h.key);
          return (
            <li key={h.key} className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-watch-800">{h.label}</span>
              <label className="flex items-center gap-2 text-xs text-slate-500">
                {enabled ? 'Shown' : 'Hidden'}
                <input type="checkbox" className="h-4 w-4" checked={enabled} onChange={(e) => toggle(h.key, e.target.checked)} />
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
