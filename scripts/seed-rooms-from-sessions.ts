/**
 * One-time MIGRATION: seed the room-reservation `rooms` collection from the
 * free-text room names already used on sessions, then back-link those sessions
 * (`session.roomId`) so existing bookings become managed + conflict-aware.
 *
 * Per org: every distinct non-empty `session.room` becomes a room under an
 * "Imported" category; sessions whose room name matches (and lack a roomId) get
 * that roomId. DRY-RUN BY DEFAULT — pass --execute.
 *
 *   Prereqs: service-account.json in the repo root (gitignored).
 *   Usage:
 *     npx tsx scripts/seed-rooms-from-sessions.ts            # dry run (reports only)
 *     npx tsx scripts/seed-rooms-from-sessions.ts --execute  # write rooms + roomId
 *
 *   Safe to re-run: existing rooms (matched case-insensitively per org) are
 *   reused, and sessions that already have a roomId are skipped. Pre-existing
 *   time overlaps are NOT auto-resolved — the conflict block only applies to
 *   future saves; review the booking calendar afterward.
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import sa from '../service-account.json';

const EXECUTE = process.argv.includes('--execute');
const DO = EXECUTE ? '' : '[dry-run] would ';

initializeApp({ credential: cert(sa as any) });
const db = getFirestore();

const norm = (s: string) => s.trim().toLowerCase();

async function main() {
  const [sessions, cats, rooms] = await Promise.all([
    db.collection('sessions').get(),
    db.collection('roomCategories').get(),
    db.collection('rooms').get(),
  ]);

  // Existing rooms by org → (normalized name → roomId), and existing "Imported" categories.
  const roomsByOrg = new Map<string, Map<string, string>>();
  for (const d of rooms.docs) {
    const r = d.data();
    if (!r.orgId || !r.name) continue;
    (roomsByOrg.get(r.orgId) ?? roomsByOrg.set(r.orgId, new Map()).get(r.orgId)!).set(norm(r.name), d.id);
  }
  const importedCatByOrg = new Map<string, string>();
  for (const d of cats.docs) {
    const c = d.data();
    if (c.orgId && norm(c.name || '') === 'imported') importedCatByOrg.set(c.orgId, d.id);
  }

  // Distinct room names per org from sessions; track sessions needing a roomId.
  const namesByOrg = new Map<string, Map<string, string>>(); // org → (norm → display name)
  const toLink: { id: string; orgId: string; name: string }[] = [];
  for (const d of sessions.docs) {
    const s = d.data();
    if (!s.orgId || !s.room || s.roomId) continue;
    const display = String(s.room).trim();
    if (!display) continue;
    (namesByOrg.get(s.orgId) ?? namesByOrg.set(s.orgId, new Map()).get(s.orgId)!).set(norm(display), display);
    toLink.push({ id: d.id, orgId: s.orgId, name: norm(display) });
  }

  let createdCats = 0, createdRooms = 0, linked = 0;

  // Create missing rooms (+ an "Imported" category per org as needed).
  for (const [orgId, names] of namesByOrg) {
    const existing = roomsByOrg.get(orgId) ?? new Map<string, string>();
    roomsByOrg.set(orgId, existing);
    const missing = [...names.entries()].filter(([n]) => !existing.has(n));
    if (!missing.length) continue;

    let catId = importedCatByOrg.get(orgId);
    if (!catId) {
      console.log(`  ${DO}create roomCategories "Imported" for org ${orgId}`);
      createdCats++;
      if (EXECUTE) {
        const ref = await db.collection('roomCategories').add({ orgId, name: 'Imported', order: 999, createdAt: FieldValue.serverTimestamp() });
        catId = ref.id;
      } else {
        catId = `dryrun-${orgId}`;
      }
      importedCatByOrg.set(orgId, catId);
    }

    for (const [n, display] of missing) {
      console.log(`  ${DO}create rooms/{auto} "${display}" (org ${orgId})`);
      createdRooms++;
      if (EXECUTE) {
        const ref = await db.collection('rooms').add({ orgId, categoryId: catId, name: display, active: true, createdAt: FieldValue.serverTimestamp() });
        existing.set(n, ref.id);
      } else {
        existing.set(n, `dryrun-room-${n}`);
      }
    }
  }

  // Back-link sessions to their managed room.
  for (const s of toLink) {
    const roomId = roomsByOrg.get(s.orgId)?.get(s.name);
    if (!roomId) continue;
    linked++;
    if (EXECUTE) await db.collection('sessions').doc(s.id).update({ roomId });
  }

  console.log(`\n${DO}create ${createdCats} category(ies), ${createdRooms} room(s); ${DO}link ${linked} session(s).`);
  if (!EXECUTE) console.log('Re-run with --execute to apply.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
