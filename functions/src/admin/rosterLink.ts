/**
 * Roster LINKS — carry cadets from one class's roster into another (an LE class
 * feeding the New Member Training class that follows it) and keep the two tied.
 *
 *   rosterImportMembers  — staff pick cadets from a source class. Each becomes a
 *     new member of the destination, or, when that person is ALREADY on the
 *     destination (typed in by hand earlier), the existing member is linked
 *     instead of duplicated. Only identity/contact fields travel; grades,
 *     discipline, attendance and outcome belong to the class they happened in.
 *     Withdrawn and dismissed cadets are never imported.
 *   onRosterMemberUpdated — when a source cadet is withdrawn or dismissed, every
 *     linked copy is hidden; reinstating the source brings it back.
 *
 * A hidden copy is NOT deleted: it becomes status 'withdrawn' with a
 * `sourceSeparated` marker (rosters and the public link leave marked members
 * out), so nothing recorded in the destination class can be lost and the change
 * is reversible. Deleting a source member does nothing to its copies — deleting
 * an old class must not empty the class that came after it.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { getFirestore, FieldValue, type DocumentData, type DocumentReference } from 'firebase-admin/firestore';
import { requireStaff } from './roster';

const MAX_IMPORT = 200;
/** Identity + contact only (strings), copied verbatim. */
const COPIED_FIELDS = [
  'fullName', 'agency', 'agencyOther', 'cjis', 'studentId', 'dob', 'phone', 'email', 'emergencyName', 'emergencyPhone',
] as const;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128 && !v.includes('/');
const isSeparated = (status: unknown): boolean => status === 'withdrawn' || status === 'dismissed';

/** Same person? MUST match sameCadet() in src/features/cadre/roster/rosterShared.ts:
 *  CJIS number decides when both have one; otherwise the name, unless their
 *  dates of birth disagree. */
export function sameCadet(a: DocumentData, b: DocumentData): boolean {
  const key = (v: unknown) => str(v).toLowerCase().replace(/[^a-z0-9]/g, '');
  const aCjis = key(a.cjis);
  const bCjis = key(b.cjis);
  if (aCjis && bCjis) return aCjis === bCjis;
  const name = key(a.fullName);
  if (!name || name !== key(b.fullName)) return false;
  const aDob = str(a.dob);
  const bDob = str(b.dob);
  return !aDob || !bDob || aDob === bDob;
}

export const rosterImportMembers = onCall<{ academyId: string; sourceAcademyId: string; memberIds: string[] }>(async (request) => {
  const caller = await requireStaff(request.auth?.uid);
  const { academyId, sourceAcademyId, memberIds } = request.data ?? ({} as { academyId: string; sourceAcademyId: string; memberIds: string[] });
  if (!isId(academyId) || !isId(sourceAcademyId)) throw new HttpsError('invalid-argument', 'Pick the class to import from.');
  if (academyId === sourceAcademyId) throw new HttpsError('invalid-argument', 'Pick a different class to import from.');
  if (!Array.isArray(memberIds) || memberIds.length === 0 || !memberIds.every(isId)) {
    throw new HttpsError('invalid-argument', 'Pick at least one cadet.');
  }
  const ids = [...new Set(memberIds)];
  if (ids.length > MAX_IMPORT) throw new HttpsError('invalid-argument', `Import ${MAX_IMPORT} cadets or fewer at a time.`);

  const db = getFirestore();
  const destRef = db.doc(`academies/${academyId}`);
  const sourceRef = db.doc(`academies/${sourceAcademyId}`);
  const destRoster = destRef.collection('roster');

  const result = await db.runTransaction(async (tx) => {
    const [destSnap, sourceSnap] = await tx.getAll(destRef, sourceRef);
    if (!destSnap.exists || !sourceSnap.exists) throw new HttpsError('not-found', 'Academy not found.');
    const dest = destSnap.data()!;
    const source = sourceSnap.data()!;
    if (dest.isTemplate || source.isTemplate) throw new HttpsError('failed-precondition', 'Templates do not have rosters.');
    // Tenant guard: both classes in ONE org, and it is the caller's.
    const orgId = str(dest.orgId);
    if (!orgId || orgId !== str(source.orgId)) throw new HttpsError('permission-denied', 'Those classes belong to different organizations.');
    if (!caller.platformOwner && orgId !== caller.orgId) throw new HttpsError('permission-denied', 'This academy belongs to another organization.');

    const existing = (await tx.get(destRoster)).docs.map((d) => ({ ref: d.ref, data: d.data() }));
    const sourceMembers = await tx.getAll(...ids.map((id) => sourceRef.collection('roster').doc(id)));

    let next = existing.reduce((m, d) => Math.max(m, Number(d.data.no) || 0), 0);
    let added = 0;
    let linked = 0;
    let alreadyLinked = 0;
    let leftOut = 0;
    const claimed = new Set<string>(); // one existing member can be matched once
    const now = FieldValue.serverTimestamp();

    for (const snap of sourceMembers) {
      const m = snap.data();
      // Re-checked here, not trusted from the page: a cadet withdrawn a moment
      // ago must not slip in.
      if (!m || isSeparated(m.status) || m.blockTaker === true || !str(m.fullName) || str(m.orgId) !== orgId) {
        leftOut++;
        continue;
      }
      const importedFrom = { academyId: sourceAcademyId, memberId: snap.id };
      const own = existing.find(
        (d) => d.data.importedFrom?.academyId === sourceAcademyId && d.data.importedFrom?.memberId === snap.id
      );
      if (own) {
        // Still hidden although the source is back (a missed event) — restore.
        if (own.data.sourceSeparated && own.data.status === 'withdrawn') {
          tx.update(own.ref, { status: 'active', sourceSeparated: FieldValue.delete(), withdrawnAt: FieldValue.delete(), updatedAt: now });
        }
        claimed.add(own.ref.id);
        alreadyLinked++;
        continue;
      }
      const match = existing.find((d) => !claimed.has(d.ref.id) && sameCadet(d.data, m));
      if (match) {
        claimed.add(match.ref.id);
        // Already tied to some other class: leave that tie alone.
        if (match.data.importedFrom) { alreadyLinked++; continue; }
        tx.update(match.ref, { importedFrom, updatedAt: now }); // nothing typed here is overwritten
        linked++;
        continue;
      }
      const fields: Record<string, string> = {};
      for (const f of COPIED_FIELDS) if (str(m[f])) fields[f] = str(m[f]);
      next++;
      tx.create(destRoster.doc(), {
        no: next, orgId, ...fields, agency: fields.agency || 'Other',
        status: 'active', importedFrom, createdAt: now, updatedAt: now,
      });
      added++;
    }

    // rosterSources is how the trigger finds linked classes (and how the page
    // remembers the tie). The write also serializes concurrent adds, exactly
    // like rosterCreateMember.
    if (added || linked || alreadyLinked) {
      tx.update(destRef, { nextRosterNo: next + 1, rosterSources: FieldValue.arrayUnion(sourceAcademyId) });
    }
    return { added, linked, alreadyLinked, leftOut, orgId, from: str(source.shortName) || str(source.name), to: str(dest.shortName) || str(dest.name) };
  });

  const { orgId, from, to, ...counts } = result;
  await db.collection('auditLog').add({
    actorUid: caller.uid, action: 'roster.import', targetType: 'academy', targetId: academyId, orgId,
    summary: `Imported cadets from ${from} into ${to}: ${counts.added} added, ${counts.linked} linked`,
    createdAt: FieldValue.serverTimestamp(),
  }).catch((err) => logger.error('rosterImportMembers: audit entry failed', err));
  return { ok: true, ...counts };
});

/**
 * Bring every linked copy of one roster member in line with it. Reads the
 * CURRENT source state (events can arrive twice or out of order), so running it
 * again is harmless. Exported for the emulator tests.
 */
export async function syncLinkedCopies(academyId: string, memberId: string): Promise<number> {
  const db = getFirestore();
  const sourceRef = db.doc(`academies/${academyId}/roster/${memberId}`);
  const orgId = str((await db.doc(`academies/${academyId}`).get()).data()?.orgId);
  if (!orgId) return 0;

  const linkedClasses = await db.collection('academies').where('rosterSources', 'array-contains', academyId).get();
  const copies: DocumentReference[] = [];
  for (const c of linkedClasses.docs) {
    if (str(c.data().orgId) !== orgId) continue; // never across tenants
    const snap = await c.ref.collection('roster').where('importedFrom.memberId', '==', memberId).get();
    for (const d of snap.docs) if (d.data().importedFrom?.academyId === academyId) copies.push(d.ref);
  }

  let changed = 0;
  for (const ref of copies) {
    changed += await db.runTransaction(async (tx) => {
      const [src, copy] = await tx.getAll(sourceRef, ref);
      const s = src.data();
      const c = copy.data();
      if (!s || !c) return 0;
      const now = FieldValue.serverTimestamp();
      if (isSeparated(s.status)) {
        // Only an ACTIVE copy is hidden: one the destination class already
        // graduated, withdrew or dismissed keeps its own outcome.
        if (c.status !== 'active') return 0;
        tx.update(ref, { status: 'withdrawn', withdrawnAt: now, sourceSeparated: { status: s.status, at: now }, updatedAt: now });
        return 1;
      }
      if (c.sourceSeparated) {
        tx.update(ref, { status: 'active', withdrawnAt: FieldValue.delete(), sourceSeparated: FieldValue.delete(), updatedAt: now });
        return 1;
      }
      return 0;
    });
  }
  return changed;
}

export const onRosterMemberUpdated = onDocumentUpdated(
  { document: 'academies/{academyId}/roster/{memberId}', retry: true },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    // Every grade and contact edit lands here too — only a change INTO or OUT OF
    // withdrawn/dismissed matters.
    if (!before || !after || isSeparated(before.status) === isSeparated(after.status)) return;
    await syncLinkedCopies(event.params.academyId, event.params.memberId);
  }
);
