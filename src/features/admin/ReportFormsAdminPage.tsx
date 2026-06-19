/**
 * Platform owner — Report Forms (the document library). Each form is either
 * GLOBAL (offered to every org) or scoped to ONE org (e.g. PHSC's academic
 * letters). The form fields + letter text live in code (reportTypes.tsx /
 * documentTypes.tsx), built from uploads in development; the display name +
 * category are editable here for the org you're currently viewing. Switch orgs
 * (top of the sidebar) to manage another org's report config.
 */
import React, { useEffect, useState } from 'react';
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useCollection, useDoc, orgConfigPath, type WithId } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import type { ReportCategory, ReportConfigDoc } from '../../types';
import { Badge, Button, Field, Input, PageHeader, Select } from '../../components/ui';
import { logAudit } from '../sessions/audit';
import { REPORT_TYPES } from '../cadre/reports/reportTypes';
import { reportCategoriesOf, effectiveReportTypes } from '../cadre/reports/reportConfig';
import type { DocumentFormDoc } from '../cadre/reports/documentForms';
import { DocumentBuilderModal } from './DocumentBuilderModal';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

interface FormRow { id: string; baseName: string; name: string; category: string; scope: string }

export function ReportFormsAdminPage() {
  const { firebaseUser, orgId } = useAuth();
  const { data: config, loading } = useDoc<ReportConfigDoc>(orgConfigPath('reportConfig', orgId));

  const [cats, setCats] = useState<ReportCategory[]>([]);
  const [rows, setRows] = useState<FormRow[]>([]);
  const [seeded, setSeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  // In-app builder documents for the org being viewed (auto org-scoped).
  const { data: customDocs } = useCollection<DocumentFormDoc>('documentForms');
  const [builder, setBuilder] = useState<{ editing: WithId<DocumentFormDoc> | null } | null>(null);

  async function removeCustom(d: WithId<DocumentFormDoc>) {
    if (!window.confirm(`Delete the custom document “${d.name}”? Filed reports that used it stay, but it can no longer be selected.`)) return;
    await deleteDoc(doc(db, 'documentForms', d.id));
    if (firebaseUser) await logAudit(firebaseUser.uid, 'documentForm.delete', 'documentForms', d.id, d.name);
  }

  // Seed the editable state once the config doc resolves (exists or not).
  useEffect(() => {
    if (seeded || loading) return;
    setCats(reportCategoriesOf(config));
    // Only forms available to the org being viewed: global + this-org-scoped.
    const eff = effectiveReportTypes(config).filter((t) => !t.orgScope || t.orgScope === orgId);
    const byId = (id: string) => REPORT_TYPES.find((b) => b.id === id);
    setRows(eff.map((t) => ({
      id: t.id,
      baseName: byId(t.id)?.name ?? t.id,
      name: t.name,
      category: t.category,
      scope: byId(t.id)?.orgScope ?? 'global',
    })));
    setSeeded(true);
  }, [config, loading, seeded, orgId]);

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
      <PageHeader kicker="Platform Owner" title="Report Forms" />
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        The document library for the organization you’re currently viewing. Each form is either
        {' '}<strong>Global</strong> (offered to every org) or scoped to one org (badged below — e.g. PHSC’s
        academic letters). Form fields and the official letter text are built in code from uploads; the
        display name + category are editable here. Disciplines choose which <strong>categories</strong> they
        offer under <strong>Curriculum &amp; Hours</strong>. Switch orgs from the top of the sidebar to manage
        another org’s forms.
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
                <div className="mb-1 flex justify-end">
                  {r.scope === 'global'
                    ? <Badge tone="green">Global</Badge>
                    : <Badge tone="amber">{r.scope} only</Badge>}
                </div>
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

      {/* Custom documents — the in-app builder (Phase 12). */}
      <section className="mt-8 rounded-lg border border-watch-100 bg-white p-4 shadow-sm">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-watch-600">Custom documents ({customDocs.length})</h2>
          <Button variant="primary" onClick={() => setBuilder({ editing: null })}>+ New document</Button>
        </div>
        <p className="mb-3 max-w-2xl text-sm text-slate-500">
          Build a document for <strong>this org only</strong> — fields, header, and paragraph/locked-clause body
          — that staff can file and print like the built-in letters. Save the categories above first if you add a
          new one. (The built-in PHSC academic letters were created this way during development.)
        </p>
        {customDocs.length === 0 ? (
          <p className="text-sm text-slate-400">No custom documents yet.</p>
        ) : (
          <div className="divide-y divide-watch-50">
            {customDocs.map((d) => (
              <div key={d.id} className="flex items-center justify-between py-2">
                <div>
                  <div className="font-medium text-watch-900">
                    {d.name} {d.active === false && <Badge tone="amber">Inactive</Badge>}
                  </div>
                  <div className="text-xs text-slate-500">{d.purpose || '—'}</div>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setBuilder({ editing: d })}>Edit</Button>
                  <Button variant="ghost" className="text-red-700" onClick={() => removeCustom(d)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {builder && orgId && firebaseUser && (
        <DocumentBuilderModal
          editing={builder.editing}
          categories={cats.filter((c) => c.label.trim())}
          orgId={orgId}
          createdBy={firebaseUser.uid}
          onClose={() => setBuilder(null)}
        />
      )}
    </div>
  );
}
