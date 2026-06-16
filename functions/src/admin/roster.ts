/**
 * Academy roster callables — the only writers of the encrypted SSN.
 *
 * Cadet SSNs are sensitive PII, so the full value never lives in Firestore in
 * the clear and never travels to the browser except through an authorized,
 * audited reveal. We store `ssnLast4` (safe to show) plus `ssnCipher`
 * (AES-256-GCM of the full SSN). The symmetric key lives only in Secret Manager
 * (ROSTER_SSN_KEY), bound to these functions — it is never in the web bundle.
 *
 * All three callables require STAFF_ROLES (coordinator and up); reveals are
 * written to the audit log.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as crypto from 'crypto';
import type { Role } from '../types';
import { STAFF_ROLES } from '../types';

const ROSTER_SSN_KEY = defineSecret('ROSTER_SSN_KEY');

function key(): Buffer {
  const k = Buffer.from(ROSTER_SSN_KEY.value(), 'base64');
  if (k.length !== 32) throw new HttpsError('failed-precondition', 'Roster encryption key is misconfigured.');
  return k;
}

/** "iv:tag:ciphertext", all base64. */
function encryptSsn(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}
function decryptSsn(blob: string): string {
  const [ivB, tagB, dataB] = blob.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64')), decipher.final()]).toString('utf8');
}

const digits = (s: string) => (s || '').replace(/\D/g, '');

async function requireStaff(uid: string | undefined): Promise<{ uid: string; name: string }> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const snap = await getFirestore().doc(`users/${uid}`).get();
  const role = snap.exists ? (snap.data()!.role as Role) : null;
  if (!role || !STAFF_ROLES.includes(role)) throw new HttpsError('permission-denied', 'Staff only.');
  return { uid, name: (snap.data()?.displayName as string) || 'A staff member' };
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

/** Create a roster member (Admin SDK), encrypting the SSN if supplied. */
export const rosterCreateMember = onCall<{ academyId: string; member: MemberInput; ssn?: string }>(
  { secrets: [ROSTER_SSN_KEY] },
  async (request) => {
    const caller = await requireStaff(request.auth?.uid);
    const db = getFirestore();
    const { academyId, member } = request.data;
    if (!academyId) throw new HttpsError('invalid-argument', 'Missing academy.');
    if (!member?.fullName?.trim()) throw new HttpsError('invalid-argument', 'A full name is required.');

    const academy = await db.doc(`academies/${academyId}`).get();
    if (!academy.exists) throw new HttpsError('not-found', 'Academy not found.');
    if (academy.data()!.isTemplate) throw new HttpsError('failed-precondition', 'Templates do not have rosters.');

    const ssn = digits(request.data.ssn ?? '');
    const fields: Record<string, unknown> = {
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
      ...(ssn ? { ssnCipher: encryptSsn(ssn), ssnLast4: ssn.slice(-4) } : {}),
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
  }
);

/** Replace a member's encrypted SSN. */
export const rosterUpdateSsn = onCall<{ academyId: string; memberId: string; ssn: string }>(
  { secrets: [ROSTER_SSN_KEY] },
  async (request) => {
    await requireStaff(request.auth?.uid);
    const { academyId, memberId } = request.data;
    const ssn = digits(request.data.ssn ?? '');
    if (!academyId || !memberId) throw new HttpsError('invalid-argument', 'Missing member.');
    const ref = getFirestore().doc(`academies/${academyId}/roster/${memberId}`);
    if (!(await ref.get()).exists) throw new HttpsError('not-found', 'Member not found.');
    await ref.update(
      ssn
        ? { ssnCipher: encryptSsn(ssn), ssnLast4: ssn.slice(-4), updatedAt: FieldValue.serverTimestamp() }
        : { ssnCipher: FieldValue.delete(), ssnLast4: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }
    );
    return { ok: true };
  }
);

/** Decrypt and return the full SSN for an authorized staff member (audited). */
export const rosterRevealSsn = onCall<{ academyId: string; memberId: string }>(
  { secrets: [ROSTER_SSN_KEY] },
  async (request) => {
    const caller = await requireStaff(request.auth?.uid);
    const { academyId, memberId } = request.data;
    if (!academyId || !memberId) throw new HttpsError('invalid-argument', 'Missing member.');
    const db = getFirestore();
    const snap = await db.doc(`academies/${academyId}/roster/${memberId}`).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Member not found.');
    const cipher = snap.data()!.ssnCipher as string | undefined;
    if (!cipher) return { ssn: null };

    await db.collection('auditLog').add({
      actorUid: caller.uid,
      action: 'roster.reveal_ssn',
      targetType: 'roster_member',
      targetId: memberId,
      summary: `${caller.name} revealed SSN for ${snap.data()!.fullName} (${academyId})`,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ssn: decryptSsn(cipher) };
  }
);
