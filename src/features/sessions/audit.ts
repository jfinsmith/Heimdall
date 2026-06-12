/**
 * Audit logging — client-side actions append to `auditLog`.
 * Rules allow authenticated create with the actor's own uid; reads are
 * admin-only. (Function-side writes use the Admin SDK directly.)
 */
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';

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
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    // Audit failures must never block the primary action.
    console.warn('auditLog write failed', err);
  }
}
