/**
 * Audit logging — client-side actions append to `auditLog`.
 * Rules allow authenticated create with the actor's own uid; reads are
 * admin-only. (Function-side writes use the Admin SDK directly.)
 */
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';

// The signed-in user's tenant, mirrored here by AuthContext so the 30+ scattered
// logAudit() call sites need not each thread orgId through. Post-cutover the
// auditLog rules require orgId == token.orgId on create, so every entry must
// carry it; this module variable is set the moment auth resolves, before any
// user action can fire an audit write. One user per browser session → safe.
let currentOrgId: string | null = null;
export function setAuditOrgId(orgId: string | null): void {
  currentOrgId = orgId;
}

export async function logAudit(
  actorUid: string,
  action: string,
  targetType: string,
  targetId: string,
  summary: string
): Promise<void> {
  try {
    await addDoc(collection(db, 'auditLog'), {
      actorUid,
      action,
      targetType,
      targetId,
      summary,
      ...(currentOrgId ? { orgId: currentOrgId } : {}),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    // Audit failures must never block the primary action.
    console.warn('auditLog write failed', err);
  }
}
