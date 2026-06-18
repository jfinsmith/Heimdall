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

/**
 * "iv:tag:ciphertext", all base64. When an orgId is given it's bound into the
 * AES-GCM additional-authenticated-data, so the ciphertext is cryptographically
 * locked to that tenant: a blob encrypted for org A fails to decrypt under org B
 * (auth-tag mismatch). Single shared key for now; Phase 13 upgrades to Cloud KMS
 * envelope encryption (per-org data keys) before going public. Omitting orgId
 * reproduces the legacy (pre-Phase-3d) format — dormant for the single tenant.
 */
function encryptSsn(plain: string, orgId?: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  if (orgId) cipher.setAAD(Buffer.from(orgId, 'utf8'));
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}
function decryptOnce(blob: string, orgId?: string): string {
  const [ivB, tagB, dataB] = blob.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB, 'base64'));
  if (orgId) decipher.setAAD(Buffer.from(orgId, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64')), decipher.final()]).toString('utf8');
}
function decryptSsn(blob: string, orgId?: string): string {
  // New ciphertexts bind the org as AAD; legacy ones (pre-Phase-3d, e.g. existing
  // PHSC data before the backfill re-encrypts) used none. Try tenant-bound first,
  // fall back to legacy ONLY when we attempted an AAD. A blob bound to a DIFFERENT
  // org fails both (auth-tag), so cross-tenant decryption stays impossible.
  try {
    return decryptOnce(blob, orgId);
  } catch (e) {
    if (orgId) {
      try {
        return decryptOnce(blob, undefined);
      } catch {
        // fall through to the shared error
      }
    }
    throw new HttpsError('internal', 'Could not decrypt the stored value (key or tenant mismatch).');
  }
}

const digits = (s: string) => (s || '').replace(/\D/g, '');

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
    // The member's tenant = its academy's, falling back to the staff caller's org
    // if the academy somehow lacks one. Bound into the SSN ciphertext as AAD.
    const orgId = (academy.data()!.orgId as string | undefined) ?? caller.orgId;
    // Hard requirement: NEVER write an org-less member. An org-less doc fails the
    // inOrg read rule and — because the roster is a subcollection LIST query —
    // denies the ENTIRE roster read, so the whole roster silently vanishes from
    // the module. Fail loudly here instead of writing a poison doc.
    if (!orgId) {
      throw new HttpsError('failed-precondition', 'Your account is not linked to an organization yet. Reload and try again, or contact the platform owner.');
    }

    const ssn = digits(request.data.ssn ?? '');
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
      ...(ssn ? { ssnCipher: encryptSsn(ssn, orgId), ssnLast4: ssn.slice(-4) } : {}),
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
    const memberSnap = await ref.get();
    if (!memberSnap.exists) throw new HttpsError('not-found', 'Member not found.');
    const orgId = memberSnap.data()!.orgId as string | undefined;
    await ref.update(
      ssn
        ? { ssnCipher: encryptSsn(ssn, orgId), ssnLast4: ssn.slice(-4), updatedAt: FieldValue.serverTimestamp() }
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
    const orgId = snap.data()!.orgId as string | undefined;

    await db.collection('auditLog').add({
      actorUid: caller.uid,
      action: 'roster.reveal_ssn',
      targetType: 'roster_member',
      targetId: memberId,
      summary: `${caller.name} revealed SSN for ${snap.data()!.fullName} (${academyId})`,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ssn: decryptSsn(cipher, orgId) };
  }
);
