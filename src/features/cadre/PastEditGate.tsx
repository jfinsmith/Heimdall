/**
 * The firewall between staff and a FINALIZED session. Once a day has passed,
 * the record is the official account of what was taught (FDLE/CJSTC audits
 * read it), so full editing stays locked by default. This gate makes unlocking
 * a deliberate act: the coordinator must read the consequences and explicitly
 * acknowledge they are CORRECTING the record to match reality (a schedule
 * change on the day, an early release, a working lunch) — not rescheduling
 * history. Confirming opens the normal session editor with a finalized-day
 * banner, and the save is audit-logged as a past-day correction.
 */
import React, { useState } from 'react';
import type { SessionDoc } from '../../types';
import type { WithId } from '../../lib/firestore';
import { Button } from '../../components/ui';
import { Modal } from '../../components/Modal';

export function PastEditGate({
  session,
  onConfirm,
  onClose,
}: {
  session: WithId<SessionDoc>;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [ack, setAck] = useState(false);
  const day = session.start.toDate().toLocaleDateString();
  return (
    <Modal open onClose={onClose} title="Edit a finalized day?">
      <div className="space-y-3">
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-900">
          <div className="font-semibold">
            ⚠ {session.title || session.courseName} · {day} has already happened.
          </div>
          <p className="mt-1">
            This is the official record of the training that was delivered, and FDLE / CJSTC require it to
            reflect what <strong>actually occurred</strong>. Edit it only to correct it to reality — a
            schedule change made on the day, an early release, a working lunch — never to rewrite history.
          </p>
        </div>
        <ul className="ml-5 list-disc space-y-1 text-sm text-slate-600">
          <li>
            Changes flow into <strong>printouts, exports, and rosters</strong> already generated from this day —
            reprint anything you&apos;ve distributed.
          </li>
          <li>
            Instructor <strong>hour totals and taught history</strong> update to match the corrected times.
          </li>
          <li>
            The change is <strong>audit-logged under your name</strong> as a past-day correction.
          </li>
        </ul>
        <label className="flex items-start gap-2 rounded-md border border-watch-100 px-3 py-2 text-sm text-watch-900">
          <input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span>
            I understand — I&apos;m correcting this record to match what actually happened on {day}.
          </span>
        </label>
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!ack} onClick={onConfirm}>
            Unlock &amp; edit
          </Button>
        </div>
      </div>
    </Modal>
  );
}
