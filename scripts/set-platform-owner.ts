/**
 * Grant (or revoke) HEIMDALL platform-owner — the product owner who provisions
 * organizations + billing + cross-org feedback. This is NOT a tenant role; it's
 * a separate `platformOwner` custom claim. Run once to seat the initial owner.
 *
 * Usage:
 *   export GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
 *   npx tsx scripts/set-platform-owner.ts <email-or-uid> [on|off]
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const [target, mode = 'on'] = process.argv.slice(2);
if (!target || !['on', 'off'].includes(mode)) {
  console.error('Usage: npx tsx scripts/set-platform-owner.ts <email-or-uid> [on|off]');
  process.exit(1);
}
const enable = mode === 'on';

initializeApp({ credential: applicationDefault() });

async function main() {
  const auth = getAuth();
  const user = target.includes('@') ? await auth.getUserByEmail(target) : await auth.getUser(target);

  // Preserve existing claims (role, orgId) — only flip platformOwner.
  const claims: Record<string, unknown> = { ...(user.customClaims ?? {}) };
  if (enable) claims.platformOwner = true;
  else delete claims.platformOwner;
  await auth.setCustomUserClaims(user.uid, claims);

  await getFirestore().doc(`users/${user.uid}`).set(
    { platformOwner: enable ? true : FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  await getFirestore().collection('auditLog').add({
    actorUid: 'cli',
    action: 'platform.set_owner',
    targetType: 'user',
    targetId: user.uid,
    summary: `platformOwner ${enable ? 'granted' : 'revoked'} via scripts/set-platform-owner.ts`,
    createdAt: FieldValue.serverTimestamp(),
  });
  console.log(`✓ ${user.email ?? user.uid} → platformOwner: ${enable} (claim + doc updated)`);
  console.log('  Sign out/in (or wait for a token refresh) to pick up the new claim.');
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
