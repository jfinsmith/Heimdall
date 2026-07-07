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

async function requireStaff(uid: string | undefined): Promise<{ uid: string; name: string; orgId?: string; platformOwner: boolean }> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const snap = await getFirestore().doc(`users/${uid}`).get();
  const data = snap.data();
  const role = snap.exists ? (data!.role as Role) : null;
  if (!role || !STAFF_ROLES.includes(role)) throw new HttpsError('permission-denied', 'Staff only.');
  if (data?.status === 'suspended' || data?.status === 'inactive') {
    throw new HttpsError('permission-denied', 'Your account is not active.');
  }
  return {
    uid,
    name: (data?.displayName as string) || 'A staff member',
    orgId: data?.orgId as string | undefined,
    platformOwner: data?.platformOwner === true,
  };
}

interface MemberInput {
  fullName: string;
  agency: string;
  agencyOther?: string;
  cjis?: string;
  studentId?: string;
  /** Date of birth, yyyy-mm-dd. */
  dob?: string;
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
  // Cross-tenant guard: staff may only add to academies in their OWN org (the
  // platform owner may act anywhere).
  const academyOrg = academy.data()!.orgId as string | undefined;
  if (!caller.platformOwner && academyOrg && academyOrg !== caller.orgId) {
    throw new HttpsError('permission-denied', 'This academy belongs to another organization.');
  }
  // The member's tenant = its academy's, falling back to the staff caller's org.
  const orgId = academyOrg ?? caller.orgId;
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
    ...(member.dob ? { dob: member.dob.trim() } : {}),
    ...(member.phone ? { phone: member.phone.trim() } : {}),
    ...(member.email ? { email: member.email.trim().toLowerCase() } : {}),
    ...(member.emergencyName ? { emergencyName: member.emergencyName.trim() } : {}),
    ...(member.emergencyPhone ? { emergencyPhone: member.emergencyPhone.trim() } : {}),
    status: 'active',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  // Roster number = one past the HIGHEST current member's number, computed from
  // the live roster inside the transaction. This way a REMOVED (hard-deleted)
  // member no longer inflates the next number — fixing the "deleted the only
  // member, next add still became #2" report — while WITHDRAWN members keep their
  // doc and number. (A class roster is small, so this scan is cheap.) The academy
  // doc is read + touched as the serialization point, so two simultaneous adds
  // conflict there and retry with a fresh max instead of colliding on a number.
  const ref = db.collection(`academies/${academyId}/roster`).doc();
  const no = await db.runTransaction(async (tx) => {
    const aref = db.doc(`academies/${academyId}`);
    await tx.get(aref);
    const existing = await tx.get(db.collection(`academies/${academyId}/roster`));
    const next = existing.docs.reduce((m, d) => Math.max(m, Number(d.data().no) || 0), 0) + 1;
    tx.set(ref, { no: next, ...fields });
    // Advisory only now (the live max above is authoritative); also serves as the
    // contention write so concurrent adds serialize on the academy doc.
    tx.update(aref, { nextRosterNo: next + 1 });
    return next;
  });
  return { ok: true, id: ref.id, no };
});
