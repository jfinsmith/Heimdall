# HEIMDALL — Compliance Posture (Phase 13)

This is an honest description of what HEIMDALL does and does **not** do today. It
is **not** a certification and **not** legal advice. Claims of CJIS/FERPA
"compliance" should not be made beyond what is stated and verified here. Have
your counsel review before onboarding an outside paying tenant.

## Data residency (US-region pin)

CJIS and most state agreements require data to stay in the United States.

| Layer | Region | How it's set | Verify |
| --- | --- | --- | --- |
| Cloud Functions | `us-east1` | `setGlobalOptions({ region: 'us-east1' })` in `functions/src/index.ts` (all callables + the Stripe webhook inherit it) | `gcloud functions list --project heimdall-e1f03` → REGION column |
| Firestore | **`us-east1` ✓ VERIFIED 2026-06-19** | Fixed at database creation — **cannot be changed later** | `firebase firestore:databases:get "(default)" --project heimdall-e1f03` → `Location` |
| Cloud Storage | **US — UNVERIFIED here** | Fixed at bucket creation | `gcloud storage buckets describe gs://heimdall-e1f03.firebasestorage.app --format='value(location)'` |
| KMS | n/a | Not used — SSN encryption was removed (Phase 13 precursor) | — |

**Status:** Firestore is confirmed `us-east1` (US single-region) and Functions
run in `us-east1`. **Cloud Storage IS in use today** — bug-report screenshots
(`feedback/{orgId}/…`) and per-org branding logos (`branding/{orgId}/…`),
governed by the committed, tenant-partitioned `storage.rules`. Its bucket
location was **not verifiable from the build sandbox** (no `gcloud`); run the
command above and record the result. If the bucket is not in a US location, it
must be re-created in the US (the location is fixed at creation) before serving a
CJIS-bound tenant.

`orgs/{orgId}.dataRegion` records the intended region per tenant (`createOrg`
stamps `us-east1`); shown on **Admin → Compliance** and the Owner Console.

## PII inventory (what we hold)

**Stored:** cadet name, class, optional CJIS student number, **cadet phone,
email, and emergency-contact name & phone**, attendance, demerits/discipline,
end-of-course grades; staff name/email/rank and qualification dates; generated
academic-action & conduct documents; and **uploaded files in Cloud Storage**
(bug-report screenshots — which can capture on-screen records — and org logos).

**Never stored:** Social Security Numbers (removed entirely — the college keeps
these locally), driver-license/passport/government-ID numbers, payment-card data
(Stripe-only), and FBI-sourced Criminal Justice Information (CJI).

Because HEIMDALL holds **training and personnel records — not CJI** — it is
outside the core CJIS Security Policy scope today. This is a posture statement,
not an exemption: if a tenant's use introduces CJI, additional controls and a
CJIS agreement become that tenant's responsibility.

## Tenant isolation

Pooled multi-tenancy isolated by an `orgId` custom-claim match enforced in
`firestore.rules` (`inOrg()`), proven by the emulator suite in
`tests/emulator/rules.test.ts` (includes cross-tenant read/write/list denial for
academies, roster, sessions, settings, audit, `documentForms`, and `orgs`). CI
blocks any deploy whose rules tests fail.

## FERPA — access, portability, deletion

- **Access / portability:** an org admin can export the organization's records as
  JSON from **Admin → Compliance → Export organization data** (client-side; only
  the caller's own org is readable). The export covers academies, roster, grades,
  academic-action documents, staff, scheduling (sessions & assignments),
  curricula, feedback, and audit history. It does **not** include uploaded Cloud
  Storage files (screenshots, logos) or per-session sign-up rows; any collection
  skipped at runtime is listed in the export's `_warnings`.
- **Deletion:** individual cadet records via **Roster & Certifications**; staff
  via **Users & Roles**. Whole-org purge is a platform-operator (Admin SDK)
  action — there is intentionally no client-side mass-delete.
- The organization remains the FERPA "school official" / controller; HEIMDALL is
  the processor.

## Data Processing Agreement (DPA)

A draft per-tenant DPA (`src/lib/compliance.ts`, version-stamped) is presented on
**Admin → Compliance**. An org admin accepts it; `acceptOrgDpa` records
who/when/version on the org doc (Admin SDK — clients cannot write it). The
platform owner sees each org's acceptance state in the Owner Console. **Treat the
DPA text as a template** — replace the bracketed items and have counsel review.

## Known gaps (not blocking PHSC; close before external tenants)

- **MFA** — auth is email/password + Google SSO only; no enforced second factor.
- **Access/read auditing** — writes are audited (`auditLog`); record *reads* are
  not.
- **Signed subprocessor agreements** — Google Cloud + Stripe are subprocessors;
  ensure the appropriate Google CJIS/data-processing addendum and Stripe DPA are
  on file.
- **Formal retention/deletion SLA** — define and publish.

## Verify before onboarding a paying outside tenant

1. Confirm Firestore + Storage are US (commands above).
2. Run the isolation suite green (`firebase emulators:exec --only firestore,auth "npm run test:emulator"`).
3. Replace DPA placeholders; have counsel review; bump `DPA_VERSION` if changed.
4. Confirm the Google data-processing/CJIS addendum and Stripe DPA are signed.
