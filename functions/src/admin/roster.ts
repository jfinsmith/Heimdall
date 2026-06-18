/**
 * Academy roster callable — creates a roster member (Admin SDK, staff-only).
 *
 * NOTE: HEIMDALL does NOT store cadet SSNs. By policy the sponsoring college
 * keeps SSNs in its own system of record; this app holds cadet records only
 * (name, agency, contact, CJIS/student id, grades, discipline). The former
 * encrypted-SSN field + reveal flow were removed for CJIS cleanliness.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { Role } from '../types';
import { STAFF_ROLES } from '../types';

async function requireStaff(uid: string | undefined): Promise<{ uid: string; name: string; orgId?: string }> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const snap = await getFirestore().doc(`users/${uid}`).get();
  const role = snap.exists ? (snap.data()!.role as Role) : null;
  if (!role || !STAFF_ROLES.includes(role)) throw new HttpsError('permission-denied', 'Staff only.');
  return {
    uid,
    name: (snap.data()?.displayName as string) || 'A staff member',
    orgId: snap.data()?.orgId as string | undefined,
  };
}

interface MemberInput {
  fullName: string;
  agency: string;
  agencyOther?: string;
  cjis?: string;
  studentId?: string;
  phone?: string;
  email?: string;
  emergencyName?: string;
  emergencyPhone?: string;
}

/** Create a roster member (Admin SDK, staff-only). */
export const rosterCreateMember = onCall<{ academyId: string; member: MemberInput }>(async (request) => {
  const caller = await requireStaff(request.auth?.uid);
  const db = getFirestore();
  const { academyId, member } = request.data;
  if (!academyId) throw new HttpsError('invalid-argument', 'Missing academy.');
  if (!member?.fullName?.trim()) throw new HttpsError('invalid-argument', 'A full name is required.');

  const academy = await db.doc(`academies/${academyId}`).get();
  if (!academy.exists) throw new HttpsError('not-found', 'Academy not found.');
  if (academy.data()!.isTemplate) throw new HttpsError('failed-precondition', 'Templates do not have rosters.');
  // The member's tenant = its academy's, falling back to the staff caller's org.
  const orgId = (academy.data()!.orgId as string | undefined) ?? caller.orgId;
  // Hard requirement: NEVER write an org-less member. An org-less doc fails the
  // inOrg read rule and — because the roster is a subcollection LIST query —
  // denies the ENTIRE roster read, so the whole roster silently vanishes from
  // the module. Fail loudly here instead of writing a poison doc.
  if (!orgId) {
    throw new HttpsError('failed-precondition', 'Your account is not linked to an organization yet. Reload and try again, or contact the platform owner.');
  }

  const fields: Record<string, unknown> = {
    orgId,
    fullName: member.fullName.trim(),
    agency: member.agency || 'PSO',
    ...(member.agencyOther ? { agencyOther: member.agencyOther.trim() } : {}),
    ...(member.cjis ? { cjis: member.cjis.trim() } : {}),
    ...(member.studentId ? { studentId: member.studentId.trim() } : {}),
    ...(member.phone ? { phone: member.phone.trim() } : {}),
    ...(member.email ? { email: member.email.trim().toLowerCase() } : {}),
    ...(member.emergencyName ? { emergencyName: member.emergencyName.trim() } : {}),
    ...(member.emergencyPhone ? { emergencyPhone: member.emergencyPhone.trim() } : {}),
    status: 'active',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  // Roster number from an atomic per-academy counter (no full-collection scan).
  // Seeds the counter once from existing members for pre-counter rosters.
  const ref = db.collection(`academies/${academyId}/roster`).doc();
  const no = await db.runTransaction(async (tx) => {
    const aref = db.doc(`academies/${academyId}`);
    const asnap = await tx.get(aref);
    let next = asnap.data()?.nextRosterNo as number | undefined;
    if (next === undefined) {
      const existing = await tx.get(db.collection(`academies/${academyId}/roster`));
      next = existing.docs.reduce((m, d) => Math.max(m, Number(d.data().no) || 0), 0) + 1;
    }
    tx.set(ref, { no: next, ...fields });
    tx.update(aref, { nextRosterNo: next + 1 });
    return next;
  });
  return { ok: true, id: ref.id, no };
});
