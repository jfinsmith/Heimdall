# HEIMDALL — Single-tenant → Multi-tenant SaaS plan

Living tracker. Pooled multi-tenancy: isolation is enforced by an **`orgId` custom-claim match in
security rules**, not by id secrecy. **Foundation first**, then build per-org on top. Every phase
follows **PLAN → CODE → CHECK → PUSH**, keeps PHSC non-regressing, and is independently verifiable.
Nothing goes public until proven with PHSC.

**Deploy reality:** push-to-`main` CI deploys hosting + Firestore/Storage rules, **not** Cloud
Functions (`firebase deploy --only functions`, manual). Cloud Storage must be enabled in the console
for logo/screenshot uploads.

## Org id scheme
- Founding PHSC tenant = bare **`phsc`** (human-obvious, stable backfill target).
- Every new college = **`<shortcode>-<6 hex>`** (e.g. `phsc-7f3a9c`), minted server-side in a
  transaction. Human-readable **and** non-enumerable. A leaked id grants nothing without a signed
  custom claim only the Admin SDK can mint — the suffix is anti-enumeration/anti-collision, not the
  security boundary. `shortCode` + full `orgId` stored on `orgs/{orgId}`.

## Phases
**A — Foundation (become multi-tenant safely)**
1. **Six editable ranks + CJK course #** *(pre-pooling, additive, no tenancy)*. Keep keys
   `director|lieutenant|sergeant|coordinator|instructor`; add `guest`. Per-org editable display
   labels (`GlobalSettings.roleLabels`, presentation-only — never read by rules/audit). Defaults:
   Captain (Director) / Lieutenant (Vice Director) / Sergeant (Supervisor) / Coordinator /
   Instructor / Guest/Visitor. `can.signUp` excludes guest. Captain(director)+Lieutenant remain the
   two admins. `CurriculumCourse.cjk` field rendered before the course name.
2. **Org model + claims + owner bootstrap** *(no rule changes)*. `OrgDoc`, `orgId` on the claim,
   `createOrg`/`provisionOrg` callable, **lock `bootstrapFirstDirector` self-promote hole**, mint the
   initial **platform_owner**, AuthContext token refresh on missing/stale `orgId`.
3. **Org-scope every query + per-org SSN key + per-org config**. Inject `orgId` filter centrally in
   `useCollection`/`useDoc` + patch ~30 list call-sites + add composite indexes; org-scope server
   fan-outs (approval `single(role)`, `notifyAdmins`, sweeps, `onCoursePublished`); non-staff sign-up
   txn stamps `orgId`; per-org SSN key (KMS envelope recommended); `settings`/`reportConfig` per-org.
4. **Backfill PHSC (MANUAL)**. Idempotent Admin-SDK stamp of every doc + mint `orgId` claim on every
   Auth user → **verify, THEN deploy org-scoped functions**. Gates Phase 5.
5. **Cutover: rules + Storage + isolation tests**. Require `orgId` match, immutable orgId, list
   queries must be orgId-constrained, platform_owner walled off from tenant PII, feedback Storage
   org-path + client write update. Emulator tests prove org A ≠ org B. Hard gate after Phase 4.

**B — Multi-tenant essentials**
6. **Multi-tenant sign-in**: returning-user → org routing, per-org `allowedEmailDomains`, graceful
   "awaiting org assignment" for no-orgId accounts (not a hard lockout).
7. **Agency auto-populate from org + cross-org owner feedback** (with enforced PII posture on
   screenshots — gate/redact, not assert).
8. **Per-org branding**: real logo upload (Storage), college logo on every surface **incl. outbound
   email**, small persistent "Powered by Heimdall" mark, fallback to the Heimdall wordmark.

**C — Documents**
9. **Per-org letterhead** + re-tag the 4 existing letters jurisdiction-neutral (FL/FDLE clauses
   gated, neutral fallback); parity-diff the official memos.
10. **Document engine**: block-model template + one generic `MemoRenderer` + **locked** liability
    clauses; parity-migrate the 4 letters (before any builder).
11. **Document library**: new professional docs (General Memo, Counseling/Remediation, Injury/Illness,
    Incident, Use-of-Force-in-training, Disciplinary, Dismissal, Cadet Acknowledgment, …) + research
    spec + legal review.
12. **In-app document builder**: admin-creatable templates (editable intro blocks, locked
    liability/statute clauses, draft → publish).

**D — Go to market**
13. **Compliance hardening**: US-region pin (Firestore/Functions/Storage/KMS) for CJIS, per-org DPA
    gate in provisioning, FERPA export/delete posture, isolation re-test, security review.
14. **Commercialize**: heimdallscheduling.com marketing/pricing + login, Stripe flat-rate webhook →
    `org.subscriptionStatus`, subscription gating. **PHSC-proven first, then public.**

## Top safeguards (from adversarial review — baked into the phases above)
- **List queries** (~30) break or leak at cutover unless org-filtered centrally + indexed (P3/P5).
- **`bootstrapFirstDirector`** self-promote = tenant-takeover hole (locked in P2).
- **Server fan-out queries** (approval chain, notifications, sweeps) cross orgs once pooled (P3).
- **Feedback screenshots are high-PII** (roster/SSN) — owner cross-org view needs safeguards (P7).
- **Storage feedback path is uid-only** — any admin reads every org's images (P5).
- **Claim propagation ≤ 1h** — refresh on `orgId` mismatch or users lock out at cutover (P2).

## Decisions settled
- Rank naming: keep stable keys, editable labels (no key rename).
- Guest: admin-granted, read-only; self-registration unchanged (instructor:pending).

## Open decisions (decided as we reach each phase)
Per-org SSN encryption method (KMS envelope recommended); self-serve vs sales-led provisioning
(sales-led for v1); billing webhook vs Stripe extension (custom webhook); which documents ship first
+ legal review; settings/reportConfig doc-id-==-orgId shape; agency override for cadets whose
sponsoring agency differs; marketing-site hosting (second Hosting target vs separate project);
US-region/data-residency sign-off before public.
