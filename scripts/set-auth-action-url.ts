/**
 * Set the Firebase Auth email ACTION URL (the %LINK% domain in verification /
 * password-reset emails) via the Identity Platform Admin API — the Firebase
 * console's "Customize action URL" form errors out on Identity
 * Platform-upgraded projects, so this goes straight to the API instead.
 *
 *   npx tsx scripts/set-auth-action-url.ts
 *
 * After running, auth-email links point at heimdallscheduling.com (which is
 * Firebase Hosting, so the /__/auth/action handler is already served there).
 */
import { cert } from 'firebase-admin/app';
import sa from '../service-account.json';

const PROJECT_ID = 'heimdall-e1f03';
const ACTION_URL = 'https://heimdallscheduling.com/__/auth/action';

async function main() {
  const credential = cert(sa as never);
  const token = (await credential.getAccessToken()).access_token;
  const base = `https://identitytoolkit.googleapis.com/v2/projects/${PROJECT_ID}/config`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const res = await fetch(`${base}?updateMask=notification.sendEmail.callbackUri`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ notification: { sendEmail: { callbackUri: ACTION_URL } } }),
  });
  if (!res.ok) {
    console.error(`PATCH failed (${res.status}):`, await res.text());
    process.exit(1);
  }

  // Read back and confirm.
  const check = await fetch(base, { headers });
  const cfg = (await check.json()) as { notification?: { sendEmail?: { callbackUri?: string } } };
  const now = cfg.notification?.sendEmail?.callbackUri;
  console.log(`Action URL is now: ${now}`);
  console.log(now === ACTION_URL ? '✓ Set correctly — auth-email links use your domain.' : '✗ Unexpected value — send me this output.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
