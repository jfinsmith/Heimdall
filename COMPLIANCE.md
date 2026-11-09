# HEIMDALL — Compliance Posture

An honest description of what HEIMDALL does and does **not** do today. It is
**not** a certification and **not** legal advice. Do not claim CJIS or FERPA
"compliance" beyond what is stated and verified here.

The public documents are the Terms of Service and Privacy Policy
(`src/features/legal/LegalPages.tsx`) and the per-organization Data Processing
Agreement (`src/lib/compliance.ts`). All three were brought in line with the
running system on 2026-11-09. Keep them accurate: when behaviour described in
them changes, change the text in the same commit.

## Data residency (United States, single region)

| Layer | Region | How it's set | Verified |
| --- | --- | --- | --- |
| Cloud Functions | `us-east1` | `setGlobalOptions({ region: 'us-east1' })` in `functions/src/index.ts` | in code |
| Firestore | `us-east1` | Fixed at database creation — cannot be changed | 2026-11-09 (Firestore Admin API) |
| Cloud Storage | `US-EAST1` (regional) | Fixed at bucket creation (`heimdall-e1f03.firebasestorage.app`) | 2026-11-09 (bucket metadata) |
| Email (Resend) | US region | Resend sending domain | 2026-08 |

`orgs/{orgId}.dataRegion` records the region per tenant (`createOrg` stamps
`us-east1`); shown on **Admin → Compliance & Data** and the Owner Console.

Firestore point-in-time recovery and scheduled backups are **not** enabled. The
legal documents deliberately make no backup or recovery-time promise.

## PII inventory (what we hold)

The authoritative list is `PII_INVENTORY` in `src/lib/compliance.ts`; the
Compliance page renders it.

**Stored:** cadet name, class, date of birth, optional CJIS student number,
phone, email, emergency contact; attendance, discipline, grades; remediation
(return-to-training) tracking, which for injuries includes the injury date,
follow-up dates and work restrictions staff enter; post-graduation assignment
plans; staff name, email, phone, date of birth, rank, qualifications and
certification dates; generated academic-action and conduct documents; uploaded
files (certification-card photos, bug-report screenshots, room diagrams, logos).

**Never stored:** Social Security Numbers, driver-license / passport /
government-ID numbers, payment-card data (Stripe only), and FBI-sourced Criminal
Justice Information (CJI).

Because HEIMDALL holds training and personnel records — not CJI — it is outside
the core CJIS Security Policy scope today. That is a posture statement, not an
exemption: if a tenant's use introduces CJI, additional controls and a CJIS
agreement become that tenant's responsibility.

## Tenant isolation and access control

- Pooled multi-tenancy isolated by an `orgId` custom-claim match enforced in
  `firestore.rules` and `storage.rules`, proven by the emulator suite in
  `tests/emulator/`. CI will not deploy rules whose tests fail.
- Authority comes from token claims minted only by callables. A `status` claim
  of `suspended`, `inactive` or `pending` blocks every organization read, so a
  locked-out member — or someone who joined with a code but has not been
  approved — reads nothing.
- Outgoing email (`mailQueue`) is not readable by any client and is deleted
  after 30 days.
- The only unauthenticated read is the public class portal callable (token link
  plus tiered passwords; academic-password attempts are capped per hour).

## FERPA — access, portability, deletion

- **Access / portability:** an org admin exports the organization's records as
  JSON from **Admin → Compliance & Data**. The page lists exactly what is and is
  not included.
- **Deletion:** cadet records from the class roster; member accounts under
  **Users & Roles**; deleting a class removes its roster, grades, attendance and
  filed documents. A whole-organization purge is a platform-operator action on
  written request, completed within 30 days (the DPA commitment).
- The organization is the controller; HEIMDALL is the processor.

## Data Processing Agreement

`src/lib/compliance.ts`, version-stamped (`DPA_VERSION`). An org admin accepts
it on **Admin → Compliance & Data**; `acceptOrgDpa` records who, when and which
version on the org doc. Bumping the version requires adding it to
`KNOWN_DPA_VERSIONS` in `functions/src/admin/callables.ts` and deploying
functions; organizations are then asked to accept the update.

Commitments the operator makes in it (keep these true):

| Commitment | Where it is met |
| --- | --- |
| Breach notice to org admins within 72 hours of confirming | operator process |
| Whole-organization deletion within 30 days of a written request | operator process |
| Export on request for 30 days after an organization leaves | operator process / Compliance export |
| Sent-email copies deleted after 30 days | `gjallarhornDailySweep` |
| Unlinked accounts deleted after 30 days, warned at 23 | `accountPurgeDaily` |
| List updated before a new subprocessor handles tenant records | DPA version bump |

## Known gaps

- **MFA** — sign-in is email/password, Google and Microsoft; no enforced second factor.
- **Read auditing** — writes are audited (`auditLog`); record reads are not.
- **Backups** — no point-in-time recovery or scheduled export (see above).
- **Organization suspension** is enforced in the app, not in the rules.
- **Signed subprocessor agreements** — keep the Google Cloud data-processing
  terms, the Stripe DPA and the Resend DPA on file.
- **Counsel review** — the legal documents were written to match the system and
  have not been reviewed by an attorney. Have counsel review them before
  onboarding an outside paying tenant.
