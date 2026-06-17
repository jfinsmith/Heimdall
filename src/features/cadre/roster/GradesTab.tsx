/**
 * Gradebook — tested curriculum courses (in academy order) across the top, cadets
 * down the side, color-coded by result. Tracks the primary EOC exam plus the
 * single FDLE lifeline (a written reexam, or — HL only — a practical remediation,
 * never both). Withdrawals read WD from the withdrawal point on. Pass/fail and
 * dismissal thresholds are computed and flagged; nothing is auto-enforced.
 */
import React, { useMemo, useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import type { WithId } from '../../../lib/firestore';
import type { CurriculumCourse, CurriculumDoc, GradeCell, RosterMemberDoc } from '../../../types';
import { PASS_MARK } from '../../../types';
import { Badge, Button, Field, Input, Select } from '../../../components/ui';
import { Modal } from '../../../components/Modal';
import { courseResult, effectiveScore, gradedCourses, memberStanding, resultClasses } from './rosterShared';

export function GradesTab({
  academyId,
  members,
  curriculum,
}: {
  academyId: string;
  members: WithId<RosterMemberDoc>[];
  curriculum: WithId<CurriculumDoc> | null;
}) {
  const courses = curriculum?.courses ?? [];
  const graded = useMemo(() => gradedCourses(courses), [courses]);
  const idxById = useMemo(() => new Map(graded.map((c, i) => [c.name, i] as const)), [graded]);
  const roster = members.filter((m) => !m.blockTaker);
  const [editing, setEditing] = useState<{ member: WithId<RosterMemberDoc>; course: CurriculumCourse } | null>(null);

  if (graded.length === 0) {
    return (
      <p className="rounded-md bg-watch-50 px-3 py-2 text-sm text-slate-600">
        No tested courses yet. Mark courses as <strong>Test</strong> under Admin → Curriculum &amp; Hours and they’ll appear here.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-slate-500">
        <Legend className="bg-green-50 text-green-800" label={`Pass (≥${PASS_MARK})`} />
        <Legend className="bg-red-100 text-red-800" label="Fail" />
        <Legend className="bg-amber-50 text-amber-700" label="Pending / reexam" />
        <Legend className="bg-slate-100 text-slate-500" label="N/A (injured)" />
        <Legend className="bg-sky-50 text-sky-700" label="XO (crossover)" />
        <Legend className="bg-slate-200 text-slate-400" label="WD (withdrawn)" />
      </div>

      <div className="overflow-x-auto rounded-lg border border-watch-100 bg-white shadow-sm">
        <table className="text-left text-sm">
          <thead className="bg-watch-50 text-xs uppercase tracking-wider text-watch-600">
            <tr>
              <th className="sticky left-0 z-10 bg-watch-50 px-3 py-3">Cadet</th>
              <th className="px-2 py-3 text-center">Avg</th>
              <th className="px-2 py-3 text-center">%</th>
              {graded.map((c) => (
                <th key={c.name} className="px-2 py-3 text-center" title={c.name}>
                  <div className="flex flex-col items-center">
                    <span className="max-w-[5rem] truncate">{c.name}</span>
                    {c.highLiability && <span className="text-[9px] text-status-critical">▲ HL</span>}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-watch-50">
            {roster.map((m) => {
              const standing = memberStanding(m, courses);
              return (
                <tr key={m.id} className={m.status === 'withdrawn' ? 'opacity-60' : ''}>
                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-watch-900">
                    <span className={m.status === 'withdrawn' ? 'line-through' : ''}>{m.fullName}</span>
                    {standing.warnings.length > 0 && (
                      <span className="ml-1 cursor-help text-red-600" title={standing.warnings.join('\n')}>⚠</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-center font-semibold">{standing.letter ?? '—'}</td>
                  <td className="px-2 py-2 text-center tabular-nums text-slate-600">
                    {standing.avgPct == null ? '—' : standing.avgPct.toFixed(1)}
                  </td>
                  {graded.map((c, i) => {
                    const res = courseResult(m, c, idxById, i);
                    const cell = m.grades?.[c.name];
                    return (
                      <td key={c.name} className="px-1 py-1 text-center">
                        <button
                          className={`min-w-[3rem] rounded px-2 py-1 text-xs ${resultClasses(res)} hover:ring-2 hover:ring-bifrost-300`}
                          onClick={() => setEditing({ member: m, course: c })}
                          disabled={res === 'wd'}
                          title={res === 'wd' ? 'Withdrawn' : 'Edit grade'}
                        >
                          {cellLabel(res, cell)}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <GradeEditor
          academyId={academyId}
          member={editing.member}
          course={editing.course}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function cellLabel(res: string, cell?: GradeCell): string {
  if (res === 'wd') return 'WD';
  if (res === 'na') return 'N/A';
  if (res === 'xo') return 'XO';
  if (cell?.status === 'co') return 'CO';
  const eff = effectiveScore(cell);
  if (eff != null) return String(eff);
  return '—';
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block h-3 w-4 rounded ${className}`} />
      {label}
    </span>
  );
}

function GradeEditor({
  academyId, member, course, onClose,
}: {
  academyId: string; member: WithId<RosterMemberDoc>; course: CurriculumCourse; onClose: () => void;
}) {
  const existing = member.grades?.[course.name] ?? {};
  const [score, setScore] = useState<string>(existing.score != null ? String(existing.score) : '');
  const [status, setStatus] = useState<'graded' | 'na' | 'co' | 'xo'>(existing.status ?? 'graded');
  const [lifeline, setLifeline] = useState<'' | 'reexam' | 'remediation'>(existing.lifeline ?? '');
  const [reexamScore, setReexamScore] = useState<string>(existing.reexamScore != null ? String(existing.reexamScore) : '');
  const [remediation, setRemediation] = useState<'' | 'pass' | 'fail'>(existing.remediation ?? '');
  const [busy, setBusy] = useState(false);

  const primary = Number(score);
  const failedPrimary = status === 'graded' && score !== '' && primary < PASS_MARK;
  const hl = !!course.highLiability;

  async function save() {
    setBusy(true);
    const cell: GradeCell = {};
    const reexamNum = Number(reexamScore);
    if (status === 'na') cell.status = 'na';
    else if (status === 'co') cell.status = 'co';
    else if (status === 'xo') cell.status = 'xo';
    else {
      if (score !== '' && Number.isFinite(primary)) cell.score = primary;
      if (failedPrimary) {
        if (hl) {
          if (lifeline === 'reexam') { cell.lifeline = 'reexam'; if (reexamScore !== '' && Number.isFinite(reexamNum)) cell.reexamScore = reexamNum; }
          else if (lifeline === 'remediation') { cell.lifeline = 'remediation'; if (remediation) cell.remediation = remediation; }
        } else if (reexamScore !== '' && Number.isFinite(reexamNum)) {
          cell.reexamScore = reexamNum;
        }
      }
    }
    const grades = { ...(member.grades ?? {}), [course.name]: cell };
    await updateDoc(doc(db, 'academies', academyId, 'roster', member.id), { grades, updatedAt: serverTimestamp() });
    setBusy(false);
    onClose();
  }

  async function clearCell() {
    setBusy(true);
    const grades = { ...(member.grades ?? {}) };
    delete grades[course.name];
    await updateDoc(doc(db, 'academies', academyId, 'roster', member.id), { grades, updatedAt: serverTimestamp() });
    setBusy(false);
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={`${course.name} — ${member.fullName}`}>
      <div className="space-y-4">
        {hl && <Badge tone="red">High-liability block</Badge>}
        <Field label="Result">
          <Select value={status} onChange={(e) => setStatus(e.target.value as 'graded' | 'na' | 'co' | 'xo')}>
            <option value="graded">Graded (enter score)</option>
            <option value="na">N/A — injured / did not test</option>
            <option value="co">CO — carry-over / incomplete</option>
            <option value="xo">XO — Crossover / Blackbird (exempt)</option>
          </Select>
        </Field>

        {status === 'graded' && (
          <>
            <Field label="End-of-course exam score (%)" hint={`${PASS_MARK}% is the pass line.`}>
              <Input type="number" min={0} max={100} value={score} onChange={(e) => setScore(e.target.value)} autoFocus />
            </Field>

            {failedPrimary && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
                <div className="mb-2 font-medium text-amber-800">
                  Below {PASS_MARK}%. {hl
                    ? 'High-liability: one lifeline only — a written reexam OR a practical remediation, not both.'
                    : 'One written reexamination is allowed.'}
                </div>
                {hl ? (
                  <>
                    <Field label="Lifeline used">
                      <Select value={lifeline} onChange={(e) => setLifeline(e.target.value as '' | 'reexam' | 'remediation')}>
                        <option value="">— none yet —</option>
                        <option value="reexam">Written reexamination</option>
                        <option value="remediation">Practical remediation</option>
                      </Select>
                    </Field>
                    {lifeline === 'reexam' && (
                      <Field label="Reexam score (%)"><Input type="number" min={0} max={100} value={reexamScore} onChange={(e) => setReexamScore(e.target.value)} /></Field>
                    )}
                    {lifeline === 'remediation' && (
                      <Field label="Remediation result">
                        <Select value={remediation} onChange={(e) => setRemediation(e.target.value as '' | 'pass' | 'fail')}>
                          <option value="">— pending —</option>
                          <option value="pass">Pass</option>
                          <option value="fail">Fail</option>
                        </Select>
                      </Field>
                    )}
                  </>
                ) : (
                  <Field label="Reexamination score (%)"><Input type="number" min={0} max={100} value={reexamScore} onChange={(e) => setReexamScore(e.target.value)} /></Field>
                )}
              </div>
            )}
          </>
        )}

        <div className="flex justify-between gap-2">
          <Button variant="ghost" className="text-red-700" onClick={clearCell} disabled={busy}>Clear</Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
