/**
 * Assign an orgless user to a tenant — the platform owner's manual fallback for
 * a self-registration that didn't match any org's auto-join domains (it sits on
 * the "awaiting organization" screen until assigned). Sets the orgId custom
 * claim (preserving role/platformOwner) + the user doc's orgId, and optionally a
 * role. The user's AuthContext force-refresh then routes them in.
 *
 *   npx tsx scripts/assign-org.ts <email-or-uid> <orgId> [role]
 *   e.g. npx tsx scripts/assign-org.ts jane@pasco.k12.fl.us phsc instructor
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import sa from '../service-account.json';

const [target, orgId, role] = process.argv.slice(2);
if (!target || !orgId) {
  console.error('Usage: npx tsx scripts/assign-org.ts <email-or-uid> <orgId> [role]');
  process.exit(1);
}

initializeApp({ credential: cert(sa as any) });
const auth = getAuth();
const db = getFirestore();

async function main() {
  // Resolve to a uid (accept either an email or a raw uid).
  const user = target.includes('@') ? await auth.getUserByEmail(target) : await auth.getUser(target);
  const uid = user.uid;

  // Confirm the org exists before stamping (avoid stranding the user in a typo'd tenant).
  const org = await db.doc(`orgs/${orgId}`).get();
  if (!org.exists) throw new Error(`orgs/${orgId} does not exist — create the org first.`);

  // ORG-LESS accounts only: this is the owner-queue fallback, not a transfer.
  // Moving a member out of a live org would carry their role claim across tenants.
  const current = (await db.doc(`users/${uid}`).get()).data()?.orgId as string | undefined;
  if (current && current !== orgId) {
    throw new Error(`${user.email ?? uid} already belongs to org '${current}' — deny/remove them there first.`);
  }

  // Strip any stale role claim/field unless a role is given explicitly (mirrors
  // the assignUserToOrg callable): rules trust the token role, so a role carried
  // over from a prior org would grant unapproved access in this one.
  const claims: Record<string, unknown> = { ...(user.customClaims ?? {}), orgId };
  delete claims.role;
  if (role) claims.role = role;
  await auth.setCustomUserClaims(uid, claims);
  await db.doc(`users/${uid}`).set(
    { orgId, role: role ?? FieldValue.delete(), deniedFromOrgId: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );

  console.log(`Assigned ${user.email ?? uid} → org '${orgId}'${role ? ` as ${role}` : ''}.`);
  console.log('They will be routed in on their next load (AuthContext force-refreshes the claim).');
  process.exit(0);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
