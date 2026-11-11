/**
 * Create a READ-ONLY Viewer account (role 'viewer') in one organization.
 *
 * A Viewer sees the Staffing page (academies, sessions, cadet counts, who is
 * signed up, open slots) and nothing else. It has no direct database access,
 * every write is refused server-side, and it never receives notifications.
 * Each sign-in is recorded in the platform audit log. See firestore.rules
 * (isViewer) and functions/src/viewer/.
 *
 * DRY RUN by default — prints what it would do. Pass --execute to write.
 *
 *   npx tsx scripts/create-viewer.ts --email you+heimdall@example.com --name "Claude Assistant" --org phsc
 *   npx tsx scripts/create-viewer.ts --email you+heimdall@example.com --name "Claude Assistant" --org phsc --execute
 *
 * The account gets a long random password that is never shown or stored.
 * Afterwards set the real password with "Forgot password?" on the sign-in page;
 * the reset email goes to --email. Refuses to touch an existing account.
 *
 * To cut access later: suspend or deactivate it under Admin → Users & Roles.
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { randomBytes } from 'crypto';
import sa from '../service-account.json';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const email = (arg('email') ?? '').trim().toLowerCase();
const name = (arg('name') ?? '').trim();
const orgId = (arg('org') ?? '').trim();
const EXECUTE = process.argv.includes('--execute');

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name || !/^[A-Za-z0-9_-]+$/.test(orgId)) {
  console.error('Usage: npx tsx scripts/create-viewer.ts --email <address> --name "<display name>" --org <orgId> [--execute]');
  process.exit(1);
}

initializeApp({ credential: cert(sa as never) });
const auth = getAuth();
const db = getFirestore();

async function main() {
  console.log(`\n=== Create Viewer ${EXECUTE ? '(EXECUTE — WRITING)' : '(DRY RUN — no writes)'} ===`);
  console.log(`  name:  ${name}\n  email: ${email}\n  org:   ${orgId}\n  role:  viewer (read-only)\n`);

  if (!(await db.doc(`orgs/${orgId}`).get()).exists) throw new Error(`No organization "${orgId}".`);
  const existing = await auth.getUserByEmail(email).catch(() => null);
  if (existing) throw new Error(`A sign-in already exists for ${email} — this script never changes an existing account.`);
  const dup = await db.collection('users').where('email', '==', email).limit(1).get();
  if (!dup.empty) throw new Error(`A profile already uses ${email} — refusing to create a second account.`);

  if (!EXECUTE) {
    console.log('Dry run OK. Re-run with --execute to create the account.');
    return;
  }

  // A long random password nobody sees — the owner sets the real one through
  // "Forgot password?", so no credential ever passes through a terminal.
  const user = await auth.createUser({ email, displayName: name, password: randomBytes(32).toString('base64url') });
  // Claims BEFORE the profile doc: rules trust the token, and the app refreshes
  // its token when the profile's role/org differ from it.
  await auth.setCustomUserClaims(user.uid, { role: 'viewer', orgId });
  await db.doc(`users/${user.uid}`).set({
    email,
    displayName: name,
    role: 'viewer',
    status: 'active',
    orgId,
    qualifications: [],
    verifiedQualKeys: [],
    notificationPrefs: { email: false, digest: false, reminderLeadHours: 48 },
    createdBy: 'cli:create-viewer',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await db.collection('auditLog').add({
    actorUid: 'cli',
    action: 'viewer.create',
    targetType: 'user',
    targetId: user.uid,
    orgId,
    summary: `Created read-only Viewer account "${name}" (${email})`,
    createdAt: FieldValue.serverTimestamp(),
  });

  console.log(`Created Viewer ${user.uid}.`);
  console.log('\nNext: open the sign-in page, choose "Forgot password?", and enter');
  console.log(`  ${email}`);
  console.log('Set the password from the email that arrives. The account opens on the Staffing page.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\nStopped: ${(err as Error).message}`);
    process.exit(1);
  });
