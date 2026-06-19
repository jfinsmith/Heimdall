/**
 * One-time MIGRATION of the old per-org `documentForms` (Phase-12 in-app builder)
 * into the owner-managed `documentLibrary`. Each old doc becomes a SPECIALIZED
 * library form assigned to its original org. DRY-RUN BY DEFAULT — pass --execute.
 *
 *   Prereqs: service-account.json in the repo root (gitignored).
 *
 *   Usage:
 *     npx tsx scripts/migrate-document-library.ts            # dry run (reports only)
 *     npx tsx scripts/migrate-document-library.ts --execute  # write to documentLibrary
 *
 *   Safe to re-run: a documentForms doc already migrated (a documentLibrary doc
 *   with migratedFrom == its id) is skipped. The old documentForms docs are left
 *   in place; delete them once the migration is verified.
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore';
import sa from '../service-account.json';

const EXECUTE = process.argv.includes('--execute');
const DO = EXECUTE ? '' : '[dry-run] would ';

initializeApp({ credential: cert(sa as any) });
const db = getFirestore();

async function main() {
  const [oldForms, existingLib] = await Promise.all([
    db.collection('documentForms').get(),
    db.collection('documentLibrary').get(),
  ]);
  const already = new Set(
    existingLib.docs.map((d) => (d.data().migratedFrom as string) || '').filter(Boolean)
  );

  let migrated = 0;
  for (const d of oldForms.docs) {
    if (already.has(d.id)) {
      console.log(`  skip documentForms/${d.id} — already migrated`);
      continue;
    }
    const f = d.data();
    const orgId = f.orgId as string | undefined;
    if (!orgId) {
      console.log(`  WARN documentForms/${d.id} has no orgId — skipping`);
      continue;
    }
    const payload = {
      name: f.name ?? 'Untitled',
      purpose: f.purpose ?? '',
      reSubject: f.reSubject ?? '',
      kind: 'letter',
      availability: 'specialized',
      orgIds: [orgId],
      appliesTo: f.appliesTo ?? 'cadet',
      fields: f.fields ?? [],
      headerFields: f.headerFields ?? [],
      blocks: f.blocks ?? [],
      signerLine: f.signerLine ?? '',
      ...(f.acknowledgment ? { acknowledgment: f.acknowledgment } : {}),
      ...(f.ackSignerLabel ? { ackSignerLabel: f.ackSignerLabel } : {}),
      ...(f.distribution ? { distribution: f.distribution } : {}),
      active: f.active !== false,
      migratedFrom: d.id,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    console.log(`  ${DO}create documentLibrary form "${payload.name}" (specialized → ${orgId})`);
    if (EXECUTE) {
      const ref = await db.collection('documentLibrary').add(payload);
      // Preserve visibility: an org's specialized form is only OFFERED to a class
      // when its curriculum lists it. The old per-org doc showed on every class, so
      // add the new form id to every one of that org's curricula (addedForms).
      const n = await addToOrgCurricula(db, orgId, ref.id);
      console.log(`    added to ${n} curriculum(ies) for ${orgId}`);
    }
    migrated++;
  }

  console.log(`\n${DO}migrate ${migrated} of ${oldForms.size} documentForms doc(s).`);
  if (EXECUTE) {
    console.log('Each migrated form was added to its org\'s curricula so it stays visible.');
    console.log('Verify in the app, then delete the old documentForms docs.');
  } else {
    console.log('Re-run with --execute to write.');
  }
}

/** Add a specialized form id to every curriculum of an org (preserves visibility). */
async function addToOrgCurricula(db: Firestore, orgId: string, formId: string): Promise<number> {
  const curr = await db.collection('curricula').where('orgId', '==', orgId).get();
  const batch = db.batch();
  curr.docs.forEach((c) => batch.update(c.ref, { addedForms: FieldValue.arrayUnion(formId) }));
  if (!curr.empty) await batch.commit();
  return curr.size;
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
