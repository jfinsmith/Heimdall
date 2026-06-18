/**
 * Admin — Report Forms: rename the built-in report forms and sort them into
 * custom categories (LE, CO, NMT, ARGUS…). The form fields + verbatim letter
 * body live in code (reportTypes.tsx); only the display name and category are
 * editable here. New forms are added in code, then named/categorized here.
 *
 * Curricula choose report *categories* (Admin → Curriculum & Hours); a class
 * then offers every form in its selected categories.
 */
import React, { useEffect, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useDoc, orgConfigPath } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import type { ReportCategory, ReportConfigDoc } from '../../types';
import { Button, Field, Input, PageHeader, Select } from '../../components/ui';
import { logAudit } from '../sessions/audit';
import { REPORT_TYPES } from '../cadre/reports/reportTypes';
import { reportCategoriesOf, effectiveReportTypes } from '../cadre/reports/reportConfig';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

interface FormRow { id: string; baseName: string; name: string; category: string }

export function ReportFormsAdminPage() {
  const { firebaseUser, orgId } = useAuth();
  const { data: config, loading } = useDoc<ReportConfigDoc>(orgConfigPath('reportConfig', orgId));

  const [cats, setCats] = useState<ReportCategory[]>([]);
  const [rows, setRows] = useState<FormRow[]>([]);
  const [seeded, setSeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  // Seed the editable state once the config doc resolves (exists or not).
  useEffect(() => {
    if (seeded || loading) return;
    setCats(reportCategoriesOf(config));
    const eff = effectiveReportTypes(config);
    const baseName = (id: string) => REPORT_TYPES.find((b) => b.id === id)?.name ?? id;
    setRows(eff.map((t) => ({ id: t.id, baseName: baseName(t.id), name: t.name, category: t.category })));
    setSeeded(true);
  }, [config, loading, seeded]);

  const setRow = (id: string, patch: Partial<FormRow>) =>
    setRows((p) => p.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  function addCategory() {
    const keys = new Set(cats.map((c) => c.key));
    let n = cats.length + 1;
    let key = `cat_${n}`;
    while (keys.has(key)) key = `cat_${++n}`;
    setCats((p) => [...p, { key, label: '' }]);
  }
  function renameCategory(key: string, label: string) {
    setCats((p) => p.map((c) => (c.key === key ? { ...c, label } : c)));
  }
  function removeCategory(key: string) {
    const fallback = cats.find((c) => c.key !== key)?.key ?? '';
    setCats((p) => p.filter((c) => c.key !== key));
    setRows((p) => p.map((r) => (r.category === key ? { ...r, category: fallback } : r)));
  }

  async function save() {
    setBusy(true);
    setSaved(false);
    // Drop blank categories; ensure each has a usable key.
    const categories: ReportCategory[] = cats
      .filter((c) => c.label.trim())
      .map((c) => ({ key: c.key || slug(c.label), label: c.label.trim() }));
    const validKeys = new Set(categories.map((c) => c.key));
    const overrides: Record<string, { name?: string; categoryKey?: string }> = {};
    for (const r of rows) {
      const o: { name?: string; categoryKey?: string } = {};
      if (r.name.trim() && r.name.trim() !== r.baseName) o.name = r.name.trim();
      if (r.category && validKeys.has(r.category)) o.categoryKey = r.category;
      if (o.name || o.categoryKey) overrides[r.id] = o;
    }
    await setDoc(doc(db, orgConfigPath('reportConfig', orgId)), { categories, overrides, updatedAt: serverTimestamp() }, { merge: false });
    if (firebaseUser) await logAudit(firebaseUser.uid, 'reportConfig.save', 'reportConfig', 'global', `${categories.length} categories`);
    setBusy(false);
    setSaved(true);
  }

  if (loading || !seeded) return null;

  return (
    <div>
      <PageHeader kicker="Admin" title="Report Forms" />
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        Rename the report forms and sort them into categories. The form fields and the official letter text
        are built in code — adding a brand-new form happens in development, after which it appears below to be
        named and categorized. Disciplines choose which <strong>categories</strong> they offer under
        {' '}<strong>Curriculum &amp; Hours</strong>.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Categories */}
        <section className="rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-watch-600">Categories</h2>
          <div className="space-y-2">
            {cats.map((c) => (
              <div key={c.key} className="flex items-center gap-2">
                <Input value={c.label} placeholder="Category name (e.g. Corrections)" onChange={(e) => renameCategory(c.key, e.target.value)} />
                <button
                  type="button"
                  aria-label={`Remove ${c.label || c.key}`}
                  className="shrink-0 text-slate-400 hover:text-red-600"
                  onClick={() => removeCategory(c.key)}
                >
                  ✕
                </button>
              </div>
            ))}
            {cats.length === 0 && <p className="text-sm text-slate-400">No categories yet.</p>}
          </div>
          <Button type="button" variant="ghost" className="mt-2" onClick={addCategory}>+ Add category</Button>
        </section>

        {/* Forms */}
        <section className="rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-watch-600">Forms ({rows.length})</h2>
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.id} className="rounded-md border border-watch-100 p-2">
                <Field label="Display name" hint={`Built-in: ${r.baseName}`}>
                  <Input value={r.name} onChange={(e) => setRow(r.id, { name: e.target.value })} />
                </Field>
                <Field label="Category" className="mt-2">
                  <Select value={r.category} onChange={(e) => setRow(r.id, { category: e.target.value })}>
                    <option value="">— unassigned —</option>
                    {cats.filter((c) => c.label.trim()).map((c) => (
                      <option key={c.key} value={c.key}>{c.label}</option>
                    ))}
                  </Select>
                </Field>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
        {saved && <span className="text-sm text-green-700">Saved.</span>}
      </div>
    </div>
  );
}
