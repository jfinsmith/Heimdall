/**
 * Owner document builder. Composes a library form (fields + paragraph/locked-clause
 * blocks) that renders through the same MemoDocument engine as the code-defined
 * documents. Saved to the owner-managed `documentLibrary` collection as either a
 * GENERAL (all orgs) or SPECIALIZED (assigned to orgs) form. Platform-owner only.
 *
 * Tokens available in header/signer/distribution templates and in block text:
 *   {cadetName} {fromName} {directorName} {memoDate} {reSubject} + each field key.
 * A `clause` block renders as LOCKED policy/liability text. Keep statutory/policy
 * citations as [bracketed placeholders] — never fabricate rule numbers.
 */
import React, { useState } from 'react';
import { addDoc, collection, deleteField, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import type { WithId } from '../../lib/firestore';
import { Button, Field, Input, Select, TextArea } from '../../components/ui';
import { Modal } from '../../components/Modal';
import type { ReportField, DocBlock } from '../cadre/reports/reportTypes';
import type { LibraryFormDoc } from '../cadre/reports/documentLibrary';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const FIELD_TYPES: ReportField['type'][] = ['text', 'textarea', 'date', 'number', 'time', 'select', 'course', 'cadet'];

type FieldRow = ReportField & { _id: string };
type BlockRow = DocBlock & { _id: string };

let _rowSeq = 0;
const rowId = () => `r${_rowSeq++}`;

function defaultHeader(appliesTo: LibraryFormDoc['appliesTo']) {
  const rows: { label: string; value: string }[] = [];
  if (appliesTo === 'cadet') rows.push({ label: 'To:', value: '{cadetName}' });
  rows.push({ label: 'From:', value: '{fromName}' });
  rows.push({ label: 'CC:', value: 'Director {directorName}, Academy Director' });
  rows.push({ label: 'Date:', value: '{memoDate}' });
  rows.push({ label: 'Re:', value: '{reSubject}' });
  return rows;
}

export function DocumentBuilderModal({
  editing,
  availability,
  createdBy,
  onClose,
}: {
  /** Existing library form to edit, or null for a new one. */
  editing: WithId<LibraryFormDoc> | null;
  /** For a NEW form: which library section it goes in. Ignored when editing. */
  availability: 'general' | 'specialized';
  createdBy: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? '');
  const [purpose, setPurpose] = useState(editing?.purpose ?? '');
  const [reSubject, setReSubject] = useState(editing?.reSubject ?? '');
  const [appliesTo, setAppliesTo] = useState<LibraryFormDoc['appliesTo']>(editing?.appliesTo ?? 'cadet');
  const [fields, setFields] = useState<FieldRow[]>(() => (editing?.fields ?? []).map((f) => ({ ...f, _id: rowId() })));
  const [header, setHeader] = useState(() => editing?.headerFields ?? defaultHeader(editing?.appliesTo ?? 'cadet'));
  const [blocks, setBlocks] = useState<BlockRow[]>(() =>
    (editing?.blocks ?? [{ kind: 'paragraph', text: '' }]).map((b) => ({ ...b, _id: rowId() }))
  );
  const [signerLine, setSignerLine] = useState(editing?.signerLine ?? 'Director {directorName}, Academy Director');
  const [acknowledgment, setAcknowledgment] = useState(
    editing?.acknowledgment ?? 'By signing below, I acknowledge receipt and understanding of this memorandum.'
  );
  const [ackSignerLabel, setAckSignerLabel] = useState(editing?.ackSignerLabel ?? 'Cadet');
  const [distribution, setDistribution] = useState((editing?.distribution ?? ['Cadet', 'Director {directorName}', 'Course File, Student File']).join('\n'));
  const [active, setActive] = useState(editing?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setField = (id: string, patch: Partial<FieldRow>) => setFields((p) => p.map((f) => (f._id === id ? { ...f, ...patch } : f)));
  const setBlock = (id: string, patch: Partial<BlockRow>) => setBlocks((p) => p.map((b) => (b._id === id ? { ...b, ...patch } : b)));
  const setHdr = (i: number, patch: Partial<{ label: string; value: string }>) =>
    setHeader((p) => p.map((h, j) => (j === i ? { ...h, ...patch } : h)));

  const missing = !name.trim() || !reSubject.trim() || blocks.every((b) => !b.text.trim());
  const sectionLabel = (editing?.availability ?? availability) === 'specialized' ? 'Specialized' : 'General';

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // Stable field keys: keep an existing field's key; derive a fresh one from
      // the label (deduped) for any new field — keys are how filed values are stored.
      const used = new Set<string>();
      const outFields: ReportField[] = fields
        .filter((f) => f.label.trim())
        .map((f) => {
          let key = f.key?.trim() || slug(f.label) || `field_${used.size + 1}`;
          while (used.has(key)) key = `${key}_2`;
          used.add(key);
          const out: ReportField = { key, label: f.label.trim(), type: f.type };
          if (f.required) out.required = true;
          if (f.hint?.trim()) out.hint = f.hint.trim();
          if (f.type === 'select' && f.options?.length) out.options = f.options;
          return out;
        });

      // Firestore is initialised without ignoreUndefinedProperties, so OMIT
      // optional keys when blank rather than writing `undefined`.
      const ack = acknowledgment.trim();
      const ackLabel = ackSignerLabel.trim();
      const payload = {
        name: name.trim(),
        purpose: purpose.trim(),
        reSubject: reSubject.trim(),
        appliesTo,
        fields: outFields,
        headerFields: header.filter((h) => h.label.trim() || h.value.trim()),
        blocks: blocks.filter((b) => b.text.trim()).map<DocBlock>((b) => ({ kind: b.kind, text: b.text })),
        signerLine: signerLine.trim(),
        ...(ack ? { acknowledgment: ack } : {}),
        ...(ackLabel ? { ackSignerLabel: ackLabel } : {}),
        distribution: distribution.split('\n').map((s) => s.trim()).filter(Boolean),
        active,
        updatedAt: serverTimestamp(),
      };

      if (editing) {
        // Preserve availability/orgIds (managed on the list row); clear emptied opt fields.
        await updateDoc(doc(db, 'documentLibrary', editing.id), {
          ...payload,
          ...(ack ? {} : { acknowledgment: deleteField() }),
          ...(ackLabel ? {} : { ackSignerLabel: deleteField() }),
        });
      } else {
        await addDoc(collection(db, 'documentLibrary'), {
          ...payload,
          kind: 'letter',
          availability,
          ...(availability === 'specialized' ? { orgIds: [] } : {}),
          createdBy,
          createdAt: serverTimestamp(),
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the document.');
      setBusy(false);
    }
  }

  const fieldKeyList = fields.map((f) => f.key?.trim() || slug(f.label)).filter(Boolean);

  return (
    <Modal open onClose={onClose} title={`${editing ? 'Edit' : 'New'} ${sectionLabel.toLowerCase()} document`} wide>
      <div className="space-y-5">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {sectionLabel === 'General'
            ? 'General documents are available to every organization. '
            : 'Specialized documents are assigned to specific organizations (set assignments on the list). '}
          Keep statutory/policy citations as <code>[bracketed placeholders]</code> for a legal pass — don’t invent rule numbers.
        </div>

        {/* Identity */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Document name" hint="Shown on the form card and the filed-reports list">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Range Safety Briefing" />
          </Field>
          <Field label="Re: subject line">
            <Input value={reSubject} onChange={(e) => setReSubject(e.target.value)} placeholder="e.g. Firearms Range Safety Acknowledgment" />
          </Field>
          <Field label="Addresses" hint="Cadet = To-the-cadet letter; File/General = subject in fields">
            <Select value={appliesTo} onChange={(e) => {
              const v = e.target.value as LibraryFormDoc['appliesTo'];
              setAppliesTo(v);
              if (!editing) setHeader(defaultHeader(v));
            }}>
              <option value="cadet">Cadet (To: a cadet)</option>
              <option value="file">File (memo to file)</option>
              <option value="general">General</option>
            </Select>
          </Field>
          <Field label="Purpose" hint="One line describing when to use it">
            <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          </Field>
        </div>

        {/* Fill-in fields */}
        <section>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-watch-600">Fill-in fields</h3>
            <Button variant="ghost" onClick={() => setFields((p) => [...p, { _id: rowId(), key: '', label: '', type: 'text' }])}>
              + Add field
            </Button>
          </div>
          <p className="mb-2 text-xs text-slate-500">
            Each becomes a form input and a <code>{'{key}'}</code> token you can drop into the body below.
          </p>
          <div className="space-y-2">
            {fields.map((f) => (
              <div key={f._id} className="grid items-end gap-2 rounded-md border border-watch-100 p-2 sm:grid-cols-[1fr,140px,90px,auto]">
                <Field label="Label">
                  <Input value={f.label} onChange={(e) => setField(f._id, { label: e.target.value })} placeholder="e.g. Date of incident" />
                </Field>
                <Field label="Type">
                  <Select value={f.type} onChange={(e) => setField(f._id, { type: e.target.value as ReportField['type'] })}>
                    {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </Select>
                </Field>
                <label className="flex items-center gap-1.5 pb-2 text-sm text-slate-600">
                  <input type="checkbox" checked={!!f.required} onChange={(e) => setField(f._id, { required: e.target.checked })} />
                  Req.
                </label>
                <button type="button" aria-label="Remove field" className="pb-2 text-slate-400 hover:text-red-600" onClick={() => setFields((p) => p.filter((x) => x._id !== f._id))}>✕</button>
                {f.type === 'select' && (
                  <Field label="Options (comma-separated)" className="sm:col-span-4">
                    <Input
                      value={(f.options ?? []).join(', ')}
                      onChange={(e) => setField(f._id, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                      placeholder="Pass, Fail, Incomplete"
                    />
                  </Field>
                )}
              </div>
            ))}
            {fields.length === 0 && <p className="text-sm text-slate-400">No fill-in fields — the document is static prose.</p>}
          </div>
        </section>

        {/* Header rows */}
        <section>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-watch-600">Memo header</h3>
            <Button variant="ghost" onClick={() => setHeader((p) => [...p, { label: '', value: '' }])}>+ Add row</Button>
          </div>
          <div className="space-y-2">
            {header.map((h, i) => (
              <div key={i} className="grid items-end gap-2 sm:grid-cols-[120px,1fr,auto]">
                <Field label="Label"><Input value={h.label} onChange={(e) => setHdr(i, { label: e.target.value })} placeholder="To:" /></Field>
                <Field label="Value (template)"><Input value={h.value} onChange={(e) => setHdr(i, { value: e.target.value })} placeholder="{cadetName}" /></Field>
                <button type="button" aria-label="Remove header row" className="pb-2 text-slate-400 hover:text-red-600" onClick={() => setHeader((p) => p.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
        </section>

        {/* Body blocks */}
        <section>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-watch-600">Body</h3>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setBlocks((p) => [...p, { _id: rowId(), kind: 'paragraph', text: '' }])}>+ Paragraph</Button>
              <Button variant="ghost" onClick={() => setBlocks((p) => [...p, { _id: rowId(), kind: 'clause', text: '' }])}>+ Locked clause</Button>
            </div>
          </div>
          <p className="mb-2 text-xs text-slate-500">
            Tokens: <code>{'{cadetName}'}</code> <code>{'{fromName}'}</code> <code>{'{directorName}'}</code>{' '}
            <code>{'{memoDate}'}</code> <code>{'{reSubject}'}</code>
            {fieldKeyList.length > 0 && <> · fields: {fieldKeyList.map((k) => <code key={k} className="mr-1">{`{${k}}`}</code>)}</>}
          </p>
          <div className="space-y-2">
            {blocks.map((b, i) => (
              <div key={b._id} className="rounded-md border border-watch-100 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <Select className="!w-44" value={b.kind} onChange={(e) => setBlock(b._id, { kind: e.target.value as DocBlock['kind'] })}>
                    <option value="paragraph">Paragraph</option>
                    <option value="clause">Locked clause</option>
                  </Select>
                  <button type="button" aria-label="Remove block" className="text-slate-400 hover:text-red-600" disabled={blocks.length === 1} onClick={() => setBlocks((p) => p.filter((x) => x._id !== b._id))}>✕</button>
                </div>
                <TextArea value={b.text} onChange={(e) => setBlock(b._id, { text: e.target.value })} rows={b.kind === 'clause' ? 3 : 4} placeholder={i === 0 ? 'On {memoDate}, …' : ''} />
              </div>
            ))}
          </div>
        </section>

        {/* Signature & distribution */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Signer line"><Input value={signerLine} onChange={(e) => setSignerLine(e.target.value)} /></Field>
          <Field label="Acknowledgment sentence (blank = none)"><Input value={acknowledgment} onChange={(e) => setAcknowledgment(e.target.value)} /></Field>
          <Field label="Acknowledgment signer label"><Input value={ackSignerLabel} onChange={(e) => setAckSignerLabel(e.target.value)} placeholder="Cadet" /></Field>
          <Field label="Distribution (one per line)">
            <TextArea value={distribution} onChange={(e) => setDistribution(e.target.value)} rows={3} />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active (available to file)
        </label>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy || missing}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create document'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
