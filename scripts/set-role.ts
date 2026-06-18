/**
 * Set a user's HEIMDALL role from the command line (Admin SDK).
 * Updates the Firestore doc, the custom auth claim, and activates the account.
 *
 * Usage:
 *   export GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
 *   npx tsx scripts/set-role.ts <email-or-uid> <director|lieutenant|sergeant|coordinator|instructor>
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const ROLES = ['director', 'lieutenant', 'sergeant', 'coordinator', 'instructor', 'guest'];

const [target, role] = process.argv.slice(2);
if (!target || !ROLES.includes(role)) {
  console.error(`Usage: npx tsx scripts/set-role.ts <email-or-uid> <${ROLES.join('|')}>`);
  process.exit(1);
}

initializeApp({ credential: applicationDefault() });

async function main() {
  const auth = getAuth();
  const user = target.includes('@') ? await auth.getUserByEmail(target) : await auth.getUser(target);

  // Preserve other claims (orgId, platformOwner) — claims are replaced wholesale.
  await auth.setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), role });
  await getFirestore().doc(`users/${user.uid}`).set(
    { role, status: 'active', updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  await getFirestore().collection('auditLog').add({
    actorUid: 'cli',
    action: 'admin.set_role',
    targetType: 'user',
    targetId: user.uid,
    summary: `Role set to ${role} via scripts/set-role.ts`,
    createdAt: FieldValue.serverTimestamp(),
  });
  console.log(`✓ ${user.email ?? user.uid} → role: ${role}, status: active (claim + doc updated)`);
  console.log('  The user must sign out/in (or wait for a token refresh) to pick up the new claim.');
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
