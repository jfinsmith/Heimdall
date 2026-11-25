/** The printable cadet tables shared by the daily rosters and the whole-class packet. */
import React from 'react';
import type { WithId } from '../../../lib/firestore';
import type { RosterMemberDoc } from '../../../types';
import { lastFirst } from './rosterShared';

/** Sign-in sheet layout (NMT/ARGUS): NO. / CJIS & Name / Signature, active cadets
 *  only, positionally numbered. */
export function SignInTable({ rows }: { rows: WithId<RosterMemberDoc>[] }) {
  // Dismissed cadets are gone like withdrawn ones — no blank signature lines
  // for people no longer in the class.
  const active = rows.filter((m) => m.status !== 'withdrawn' && m.status !== 'dismissed');
  return (
    <table className="mt-3 w-full border-collapse text-[11px]">
      <thead>
        <tr className="bg-watch-100/60">
          <th className="w-8 border border-black px-1 py-0.5">No.</th>
          <th className="w-[44%] border border-black px-1 py-0.5 text-left">CJIS &amp; Name</th>
          <th className="border border-black px-1 py-0.5 text-left">Signature</th>
        </tr>
      </thead>
      <tbody>
        {active.map((m, i) => (
          <tr key={m.id}>
            <td className="border border-black px-1 py-2 text-center tabular-nums">{i + 1}</td>
            <td className="border border-black px-1 py-2">
              {m.cjis ? <span className="mr-2 font-semibold tabular-nums">{m.cjis}</span> : null}{lastFirst(m.fullName)}
            </td>
            <td className="border border-black" />
          </tr>
        ))}
        {active.length === 0 && (
          <tr><td colSpan={3} className="border border-black px-1 py-3 text-center text-slate-500">No active cadets.</td></tr>
        )}
      </tbody>
    </table>
  );
}

export function RosterTable({
  title,
  rows,
  renumber,
}: {
  title: string | null;
  rows: { id: string; no: number; fullName: string; status: string }[];
  renumber?: boolean;
}) {
  return (
    <>
      {title && <div className="mt-3 bg-black px-1 py-0.5 text-[10px] font-bold uppercase text-white">{title}</div>}
      <table className="mt-1 w-full border-collapse text-[10px]">
        <thead>
          <tr className="bg-watch-100/60">
            <th className="w-6 border border-black px-1 py-0.5">No.</th>
            <th className="border border-black px-1 py-0.5 text-left">Name</th>
            <th className="w-[26%] border border-black px-1 py-0.5">Signature</th>
            <th className="w-12 border border-black px-1 py-0.5">In</th>
            <th className="w-12 border border-black px-1 py-0.5">Out</th>
            <th className="w-8 border border-black px-1 py-0.5" title="Approved">APP</th>
            <th className="w-8 border border-black px-1 py-0.5" title="Disciplinary action">D/A</th>
            <th className="w-12 border border-black px-1 py-0.5">Makeup</th>
            <th className="w-12 border border-black px-1 py-0.5">Sgt</th>
            <th className="w-12 border border-black px-1 py-0.5">Dir</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m, i) => (
            <tr key={m.id}>
              <td className="border border-black px-1 py-1 text-center tabular-nums">{renumber ? i + 1 : m.no}</td>
              <td className="border border-black px-1 py-1">{lastFirst(m.fullName)}</td>
              <td className="border border-black px-1 py-1 text-center text-[9px] font-bold uppercase text-slate-500">
                {m.status === 'withdrawn' ? 'Withdrawn' : m.status === 'dismissed' ? 'Dismissed' : ''}
              </td>
              <td className="h-7 border border-black" />
              <td className="border border-black" />
              <td className="border border-black" />
              <td className="border border-black" />
              <td className="border border-black" />
              <td className="border border-black" />
              <td className="border border-black" />
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
