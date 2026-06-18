/**
 * Phase 4 — one-time multi-tenant BACKFILL: stamp the founding PHSC tenant onto
 * all existing data and every Auth user, so the (dormant) org-scoping shipped in
 * Phases 2–3d activates. Idempotent and re-runnable. DRY-RUN BY DEFAULT — it only
 * reports; pass --execute to write.
 *
 *   Prereqs (in order):
 *     1. Deploy functions first:  firebase deploy --only functions
 *     2. service-account.json present in the repo root (gitignored).
 *
 *   Usage:
 *     npx tsx scripts/backfill-org.ts                 # dry run (no writes)
 *     npx tsx scripts/backfill-org.ts --execute       # write
 *     # optional SSN re-encryption (binds AAD=orgId; needs the key):
 *     ROSTER_SSN_KEY=<base64-32-bytes> npx tsx scripts/backfill-org.ts --execute --reencrypt-ssn
 *
 *   Ordering that matters: for each user the orgId CLAIM is set BEFORE the user
 *   doc's orgId field, so a logged-in session's AuthContext force-refresh (which
 *   fires on doc.orgId != token.orgId) picks up a token that already carries the
 *   claim instead of locking out.
 *
 *   After a successful --execute, re-run WITHOUT --execute: every "to stamp"
 *   count should read 0 (idempotent verification). THEN deploy the Phase-5 rules.
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as crypto from 'crypto';
import sa from '../service-account.json';

const ORG_ID = 'phsc';
const SHORT_CODE = 'phsc';
const LEGAL_NAME = 'Pasco-Hernando State College';

const EXECUTE = process.argv.includes('--execute');
const REENCRYPT = process.argv.includes('--reencrypt-ssn');
const DO = EXECUTE ? '' : '[dry-run] would ';

// Top-level org-owned collections. NOT users (handled with claims below) and NOT
// notifications/mail (per-user / server-only, opted out of org scoping in 3a).
const TOP_COLLECTIONS = [
  'academies', 'sessions', 'assignments', 'curricula', 'courseCatalog',
  'coursePublishEvents', 'feedbackReports', 'auditLog', 'bulkMessages',
];

initializeApp({ credential: cert(sa as any) });
const db = getFirestore();
const auth = getAuth();

let writes = 0;
const log = (s: string) => console.log(s);

/** Commit a list of (ref, data) merges in batches of 400 (when executing). */
async function commitMerges(items: { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }[]) {
  if (!EXECUTE) { writes += items.length; return; }
  for (let i = 0; i < items.length; i += 400) {
    const batch = db.batch();
    for (const { ref, data } of items.slice(i, i + 400)) batch.set(ref, data, { merge: true });
    await batch.commit();
    writes += Math.min(400, items.length - i);
  }
}

/** Stamp orgId on every doc of a query that lacks it (returns the count touched). */
async function stamp(label: string, snap: FirebaseFirestore.QuerySnapshot): Promise<number> {
  const todo = snap.docs.filter((d) => (d.data().orgId as string | undefined) !== ORG_ID);
  await commitMerges(todo.map((d) => ({ ref: d.ref, data: { orgId: ORG_ID } })));
  log(`  ${DO}stamp orgId on ${todo.length}/${snap.size} ${label}`);
  return todo.length;
}

// ── SSN re-encryption helpers (mirror functions/src/admin/roster.ts) ──────────
function ssnKey(): Buffer {
  const k = Buffer.from(process.env.ROSTER_SSN_KEY ?? '', 'base64');
  if (k.length !== 32) throw new Error('ROSTER_SSN_KEY must be base64 of 32 bytes for --reencrypt-ssn.');
  return k;
}
function dec(blob: string, orgId?: string): string {
  const [iv, tag, data] = blob.split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', ssnKey(), Buffer.from(iv, 'base64'));
  if (orgId) d.setAAD(Buffer.from(orgId, 'utf8'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}
function encWithAad(plain: string, orgId: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', ssnKey(), iv);
  c.setAAD(Buffer.from(orgId, 'utf8'));
  const e = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv.toString('base64'), c.getAuthTag().toString('base64'), e.toString('base64')].join(':');
}

async function main() {
  log(`\n=== PHSC backfill → org '${ORG_ID}' ${EXECUTE ? '(EXECUTE — WRITING)' : '(DRY RUN — no writes)'} ===\n`);

  // 1. Org registry doc (idempotent).
  const orgRef = db.doc(`orgs/${ORG_ID}`);
  if (!(await orgRef.get()).exists) {
    log(`1. ${DO}create orgs/${ORG_ID} (${LEGAL_NAME})`);
    if (EXECUTE) await orgRef.set({ orgId: ORG_ID, shortCode: SHORT_CODE, legalName: LEGAL_NAME, status: 'active', createdAt: FieldValue.serverTimestamp() });
  } else log(`1. orgs/${ORG_ID} already exists — skip`);

  // 2. Copy config singletons global → {orgId} (server + client read per-org now).
  for (const coll of ['settings', 'reportConfig']) {
    const src = await db.doc(`${coll}/global`).get();
    const dstRef = db.doc(`${coll}/${ORG_ID}`);
    if (src.exists && !(await dstRef.get()).exists) {
      log(`2. ${DO}copy ${coll}/global → ${coll}/${ORG_ID}`);
      if (EXECUTE) await dstRef.set(src.data()!);
    } else log(`2. ${coll}/${ORG_ID} present or no source — skip`);
  }

  // 3. Stamp orgId on top-level org-owned collections.
  log('3. Top-level collections:');
  let stamped = 0;
  for (const coll of TOP_COLLECTIONS) {
    stamped += await stamp(coll, await db.collection(coll).get());
  }

  // 4. Stamp orgId on subcollections (roster, reports under academies; signups under sessions).
  log('4. Subcollections:');
  const academies = await db.collection('academies').get();
  for (const a of academies.docs) {
    stamped += await stamp(`academies/${a.id}/roster`, await a.ref.collection('roster').get());
    stamped += await stamp(`academies/${a.id}/reports`, await a.ref.collection('reports').get());
  }
  const sessions = await db.collection('sessions').get();
  for (const s of sessions.docs) {
    stamped += await stamp(`sessions/${s.id}/signups`, await s.ref.collection('signups').get());
  }

  // 5. Mint the orgId CLAIM on every Auth user (preserving role/platformOwner),
  //    THEN stamp the user doc. Claim-first so live sessions refresh cleanly.
  log('5. Auth users (claim → doc):');
  let claimed = 0, userDocs = 0, pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) {
      const existing = u.customClaims ?? {};
      if (existing.orgId !== ORG_ID) {
        log(`  ${DO}mint claim orgId=${ORG_ID} on ${u.email ?? u.uid}`);
        if (EXECUTE) await auth.setCustomUserClaims(u.uid, { ...existing, orgId: ORG_ID });
        claimed++;
      }
      const uref = db.doc(`users/${u.uid}`);
      const usnap = await uref.get();
      if (usnap.exists && (usnap.data()!.orgId as string | undefined) !== ORG_ID) {
        if (EXECUTE) await uref.set({ orgId: ORG_ID, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        userDocs++;
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);
  log(`  ${DO}set claim on ${claimed} users; ${DO}stamp ${userDocs} user docs`);

  // 6. OPTIONAL: re-encrypt roster SSNs with AAD=orgId (eliminates the legacy
  //    no-AAD fallback). Needs ROSTER_SSN_KEY. Skipped otherwise (3d's fallback
  //    keeps legacy ciphertexts decryptable; access control prevents cross-tenant).
  if (REENCRYPT) {
    log('6. Re-encrypt SSNs with AAD:');
    let reenc = 0;
    for (const a of academies.docs) {
      const roster = await a.ref.collection('roster').get();
      for (const m of roster.docs) {
        const cipher = m.data().ssnCipher as string | undefined;
        if (!cipher) continue;
        let plain: string;
        try { plain = dec(cipher, ORG_ID); continue; } // already AAD-bound — skip
        catch { /* legacy, re-encrypt below */ }
        try { plain = dec(cipher, undefined); } catch { log(`  ! could not decrypt SSN for ${a.id}/${m.id} — skipped`); continue; }
        log(`  ${DO}re-encrypt SSN ${a.id}/${m.id}`);
        if (EXECUTE) await m.ref.update({ ssnCipher: encWithAad(plain, ORG_ID), updatedAt: FieldValue.serverTimestamp() });
        reenc++;
      }
    }
    log(`  ${DO}re-encrypt ${reenc} SSNs`);
  } else {
    log('6. SSN re-encryption skipped (no --reencrypt-ssn). Legacy ciphertexts decrypt via the 3d fallback.');
  }

  log(`\n=== ${EXECUTE ? `DONE — ${writes} writes` : `DRY RUN complete — ${writes} writes pending`}. ${stamped} docs need orgId; ${claimed} users need the claim. ===`);
  log(EXECUTE ? 'Re-run WITHOUT --execute to verify all counts are 0, then deploy the Phase-5 rules.\n' : 'Re-run with --execute to apply.\n');
  process.exit(0);
}

main().catch((err) => { console.error(err.message ?? err); process.exit(1); });
