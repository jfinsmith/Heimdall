# Build Prompt — HEIMDALL: Academy Scheduling & Instructor Sign-Up Platform

> **How to use this:** Paste this entire document into Claude Code (Fable 5) as your initial build prompt. It is written to produce as much of the application as possible in one pass. All product names are final (HEIMDALL / CADRE / Gjallarhorn) — no placeholders to replace there. Manual Firebase steps (project creation, secrets, Blaze upgrade, SMTP keys) are intentionally left out of code and gathered into the generated README. Anything that can only come from a human is marked `// TODO(setup):`.

---

## 0. Role & objective

You are a senior full-stack engineer **and** a brand-conscious product designer. Build a production-quality web application called **HEIMDALL** that lets a law-enforcement training academy build full training schedules and lets a roster of instructors self-sign-up to teach the scheduled classes, with a robust automated email reminder/alert backend.

Generate the **complete repository** in one pass: frontend, brand assets (SVG logo + favicon), Firestore data model + security rules, Cloud Functions, email templates, seed data, GitHub Actions deploy workflow, `.env.example`, and a thorough `README.md`. Where a value can only come from the user (Firebase project ID, SMTP key, etc.), insert a clearly-labeled `// TODO(setup):` placeholder and document it in the README — do **not** invent secrets.

Work in this order, committing logically: (1) scaffold + tooling, (2) brand assets + design tokens, (3) Firebase init + types + data model, (4) auth + RBAC, (5) core UI shell + routing, (6) CADRE schedule builder, (7) calendar + sign-up flow, (8) staffing dashboard + reporting, (9) Gjallarhorn functions + email engine, (10) security rules, (11) seed script, (12) deploy workflow, (13) README. Prefer working, typed, commented code over stubs.

---

## 1. Identity & branding (names, theme, logo)

The product has a layered naming system drawn from Norse myth — Heimdall is the all-seeing watchman of the gods who guards the Bifröst and sounds the **Gjallarhorn** to summon the gods and warn of what's coming. That maps directly onto the app's job: **watch staffing, sound the alert.** Use these names consistently across UI, code comments, and email copy.

- **HEIMDALL** — the platform / site / brand / repo name. A codename with meaning, **not** an acronym. This is the top-level wordmark users see in the app shell and on emails.
- **CADRE** — the scheduling subsystem inside HEIMDALL: the schedule builder + calendar + staffing/coverage tooling (feature modules B–E in §7). Expand it as **"Coordinated Academy Duty & Roster Engine."** It double-reads on purpose — in law enforcement, the "cadre" *is* the academy's training staff. Show "CADRE" as a subordinate label/section header within HEIMDALL (e.g., the schedule area is branded "CADRE — Coordinated Academy Duty & Roster Engine").
- **Gjallarhorn** — the notification / reminder / alert + email engine (§8). It is literally the horn that sounds the summons. Use "Gjallarhorn" in code namespacing (e.g., the functions module), in the admin "Gjallarhorn settings" panel for reminders/escalation, and as the email footer signature ("Sounded by Gjallarhorn · HEIMDALL").

**Logo direction (generate this — do not skip):**
Produce a clean, professional **Gjallarhorn mark** — a stylized curved Norse war/drinking horn — as the primary brand glyph.
- Deliver it as `/src/components/Logo.tsx` (inline, currentColor-driven SVG so it inherits theme color and works in mono) **and** a standalone `/public/favicon.svg` (plus a 512×512 `og-image` variant if trivial).
- It must remain legible and recognizable at **32px** (favicon) and in single-color/monochrome. Optional accents: a subtle Elder Futhark rune or restrained Norse knotwork detail on the horn band — but only if it survives shrinking; legibility beats ornament.
- Build a **wordmark lockup**: horn glyph + "HEIMDALL" in a strong, slightly condensed sans (or a tasteful blackletter-influenced display face for the wordmark only, with the UI itself staying in a clean sans). Provide a stacked and a horizontal lockup.
- Keep it command-center professional, not fantasy-game. No drop shadows, no gradients-for-the-sake-of-it. Think "agency insignia," not "metal album cover."

Wire the logo into: the app sidebar/topbar, the login screen, the favicon, email headers, and printable schedule headers.

---

## 2. Domain context (read carefully — the data model depends on it)

The customer is a Sheriff's Office that runs a Florida **FDLE Basic Recruit Training Program (BRTP)** — a law-enforcement and corrections academy hosted at a state college. Coordinators design a full academy schedule (hundreds of class sessions over several months), publish it, and a pool of instructors signs up to teach individual sessions.

Key real-world facts to model:

- An **academy** is a cohort (e.g., "BLE Class 2026-01") with a discipline: **Law Enforcement**, **Corrections**, or **Cross-Over**, a start/end date, and a target total instructional hours (LE BRTP ≈ 770 hrs, Corrections ≈ 520 hrs — make these configurable, not hard-coded).
- The curriculum is divided into **courses** (e.g., Legal, Communications, Patrol, Investigations, Report Writing, First Aid for Criminal Justice Officers, Criminal Justice Firearms, Defensive Tactics/CMS, Criminal Justice Vehicle Operations, DFST). Each course has FDLE hours and a **high-liability** flag (Firearms, DT/CMS, Vehicle Ops, First Aid are high-liability).
- A **session** is one scheduled meeting of a course on a specific date/time in a specific room. **The critical feature:** each session defines **role slots** with counts and required qualifications. Some sessions need only **one lead instructor**; high-liability sessions need a lead **plus** multiple assistant instructors, **safety officers**, **role players**, and/or **evaluators**. An instructor may only fill a slot they are **qualified** for.
- **Chain of command** (used for permissions and alert routing): Instructor → Coordinator → Sergeant → Lieutenant → Director (Captain). Coordinators build schedules; supervisors get oversight + escalation alerts.

Seed the system with realistic FDLE-style sample data so it's demonstrable immediately.

---

## 3. Technology stack (use exactly this unless noted)

- **Frontend:** React 18 + **TypeScript** + **Vite**. **Tailwind CSS** for styling (define HEIMDALL brand colors as Tailwind theme tokens). **React Router v6**. Use `HashRouter` (simplest for GitHub Pages) — or `BrowserRouter` with a `404.html` SPA-redirect fallback and `base` set in `vite.config.ts`; pick HashRouter and note the tradeoff in the README.
- **Calendar:** `@fullcalendar/react` (dayGrid, timeGrid, list, + interaction plugin for drag/resize). Robust enough for month/week/day + drag-to-reschedule.
- **State/data:** Firebase Web SDK v10+ (modular). React Context for auth/user; React Query (`@tanstack/react-query`) **or** lightweight custom hooks for Firestore reads — choose one and be consistent.
- **Backend:** **Firebase** — Authentication, Cloud Firestore, Cloud Functions (Node 20, TypeScript, `/functions`), and the **Trigger Email from Firestore** extension (`firestore-send-email`) for outbound mail.
- **Hosting:** **GitHub Pages** (static SPA) via GitHub Actions. Firebase Auth authorized domains must include the `*.github.io` domain (document this).
- **Email transport:** SMTP via a provider (SendGrid / Mailgun / Resend / Postmark, or a Gmail App Password for testing). The Trigger Email extension reads docs from a `mail/` collection and sends them.

> **Plan note to surface in the README:** Cloud Functions + the Trigger Email extension + Cloud Scheduler require the Firebase **Blaze** plan (stays within the no-cost tier for this usage; Cloud Scheduler is ~$0.10/job/month with 3 free jobs). Provide **Option B**: a GitHub Actions scheduled (cron) workflow that runs a Node script using the **Firebase Admin SDK** (service-account JSON in GitHub Secrets) and sends mail via an email API — so the project can run reminders on the free **Spark** plan if the user prefers. Implement Option A as primary, scaffold Option B's workflow + script behind a clearly-commented toggle.

---

## 4. Roles & permissions (RBAC)

Roles: `director`, `lieutenant`, `sergeant`, `coordinator`, `instructor`. Store the role on the `users` doc and mirror it into a **custom claim** (set via a Cloud Function / callable admin action) so Firestore security rules can enforce it cheaply.

| Capability | director | lieutenant | sergeant | coordinator | instructor |
|---|---|---|---|---|---|
| View all academies/sessions/reports | ✅ | ✅ | ✅ | ✅ | published only |
| Create/edit/clone academies & schedules | ✅ | ✅ | ✅ | ✅ | ❌ |
| Create/edit/cancel sessions & role slots | ✅ | ✅ | ✅ | ✅ | ❌ |
| Manage users & assign roles | ✅ | ✅ | ❌ | ❌ | ❌ |
| Approve/override instructor sign-ups | ✅ | ✅ | ✅ | ✅ | ❌ |
| Sign up / withdraw for qualified slots | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edit own profile & qualifications* | ✅ | ✅ | ✅ | ✅ | ✅ |
| Receive escalation/understaffing alerts | ✅ | ✅ | ✅ | ✅ | n/a |
| Edit org settings & branding | ✅ | ✅ | ❌ | ❌ | ❌ |

\* Qualifications/certifications are self-editable but **approval-gated**: an instructor can claim a qualification, but a supervisor/coordinator must verify it before it lets them fill restricted slots. Model a `verified: boolean` per qualification.

New self-registered users default to `role: instructor`, `status: pending` until approved. Optionally restrict registration to allowed email domains (configurable in settings; e.g., the agency domain + an allow-list for outside adjuncts).

---

## 5. Firestore data model

Use these collections. All timestamps are Firestore `Timestamp`. Denormalize where noted to keep reminder queries and "my schedule" cheap.

**`users/{uid}`**
```
email, displayName, photoURL, phone, rank, agency
role: 'director'|'lieutenant'|'sergeant'|'coordinator'|'instructor'
status: 'pending'|'active'|'inactive'
qualifications: [{ key, label, verified, verifiedBy?, expires? }]   // e.g. key: 'firearms','dt','vehicle_ops','first_aid','role_player','general'
notificationPrefs: { email: bool, reminderLeadHours: number, digest: bool }
createdAt, updatedAt
```

**`settings/global`** (singleton)
```
orgName, brandPrimaryColor, brandAccentColor, logoUrl
allowedEmailDomains: string[]
reminderDefaultLeadHours: number          // e.g. 48      (Gjallarhorn)
understaffingAlertDays: number            // alert if required slots unfilled within N days
escalationRecipients: string[]            // uids/emails for command alerts
weeklyDigestEnabled: bool
```

**`courseCatalog/{courseId}`** (reusable curriculum library)
```
name, fdleCourseCode, discipline: 'law_enforcement'|'corrections'|'cross_over'|'all'
defaultHours: number
highLiability: bool
description
defaultRoleSlots: [{ role, count, requiredQualificationKey? }]
leadRequiredQualificationKey?
```

**`academies/{academyId}`** (a cohort)
```
name, discipline, fdleProgram
startDate, endDate, location
status: 'draft'|'published'|'in_progress'|'completed'|'archived'
coordinatorIds: string[]
targetTotalHours: number
createdBy, createdAt, updatedAt
```

**`sessions/{sessionId}`**
```
academyId
courseId (ref → courseCatalog) + courseName (denormalized) + highLiability (denormalized)
title?            // optional override
start, end        // Timestamps
location, room
hours: number
status: 'draft'|'open'|'fully_staffed'|'cancelled'|'completed'
roleSlots: [{
  slotId, role: 'lead'|'assistant'|'role_player'|'safety_officer'|'evaluator',
  count, requiredQualificationKey?, filledBy: string[]   // uids; length ≤ count
}]
notes
createdBy, updatedAt
```

**`sessions/{sessionId}/signups/{uid}`** (authoritative per-session sign-up)
```
uid, displayName, role, slotId, status: 'confirmed'|'waitlist'|'withdrawn'
signedUpAt
```

**`assignments/{assignmentId}`** (denormalized mirror for "My Schedule" + Gjallarhorn reminders)
```
uid, sessionId, academyId, role, courseName, location, room
start, end, status, reminderSent: bool, createdAt
```

**`notifications/{notificationId}`** (in-app bell)
```
uid (recipient), type, title, body, link, read: bool, createdAt
```

**`mail/{docId}`** (watched by Trigger Email extension; **server-written only**)
```
to: string[] , message: { subject, html, text }, createdAt
```

**`auditLog/{logId}`**
```
actorUid, action, targetType, targetId, summary, createdAt
```

---

## 6. Sign-up logic (implement carefully)

When an instructor signs up for a slot, run a **Firestore transaction** that:
1. Re-reads the session, confirms the slot exists and `filledBy.length < count`.
2. Confirms the user has the `requiredQualificationKey` (and that it is `verified` and not expired) — otherwise reject with a clear error, or place on **waitlist** if the slot is full.
3. Adds the uid to `roleSlots[].filledBy`, creates the `signups/{uid}` doc, and mirrors an `assignments` doc.
4. Recomputes `session.status` → `fully_staffed` when **all required slots** are filled.
Withdrawal reverses this and re-opens the slot (and promotes a waitlisted user if present). Prevent **double-booking**: block a sign-up if the user already has a `confirmed` assignment overlapping that time window. All writes also append to `auditLog`.

---

## 7. Feature modules & user stories

Build these as routed pages within an app shell (persistent sidebar + topbar with Gjallarhorn notification bell, user menu, global "create" action). Make everything **mobile-responsive** and keyboard-accessible. **Modules B–E together are branded "CADRE — Coordinated Academy Duty & Roster Engine"** and should live under a shared CADRE section in the nav.

**A. Auth & onboarding**
- Sign in with **Google** and **email/password** (+ email-link optional). Password reset.
- First-time profile completion (name, rank, agency, phone, qualifications request).
- Pending-approval state for new instructors.

**B. CADRE — Schedule Builder (coordinator)** — the centerpiece
- Create an academy (cohort) with discipline, dates, location, coordinators.
- Add sessions by: (a) picking a course from the catalog (auto-fills hours + default role slots), (b) setting date/time/room, (c) adjusting role-slot counts & required qualifications.
- **Bulk tools:** recurring/daily block generator (e.g., "PT every weekday 0600–0700 for 6 weeks"), and a **clone-academy** action that copies an entire prior schedule and **shifts all dates** to a new start date.
- Drag-and-drop on the calendar to move/resize sessions (writes back to Firestore).
- Running tally of scheduled hours vs. `targetTotalHours` per discipline, with gap warnings.
- Publish/unpublish (instructors only see published academies).

**C. CADRE — Calendar views (all users)**
- Month / week / day / list (agenda) via FullCalendar.
- Filters: by academy, course, discipline, room, **staffing status** (open / understaffed / fully staffed), and "slots I'm qualified for."
- Color-code by staffing status and high-liability.
- Click a session → detail modal with role slots, who's signed up, and a **Sign Up** / **Withdraw** action per qualifying slot.

**D. Instructor experience**
- **Browse Open Sessions:** list/calendar of sessions with unfilled slots the instructor qualifies for; one-click sign-up.
- **My Schedule:** upcoming assignments, add-to-calendar (.ics export), withdraw.
- Profile & qualifications management.

**E. CADRE — Staffing Dashboard (coordinator/command)**
- A **board view** (kanban-style columns: Draft / Open / Understaffed / Fully Staffed) of upcoming sessions.
- "Needs attention" panel: sessions within N days missing required leads or high-liability safety slots.
- Per-instructor load (hours/sessions signed up), and per-course coverage.
- Bulk message: email selected instructors or all signed-up instructors for an academy (sends via Gjallarhorn).

**F. Admin**
- User management: approve pending users, set roles (writes custom claim via callable function), verify qualifications.
- Org settings & branding, **Gjallarhorn settings** (reminder defaults, escalation recipients), allowed domains.
- Audit log viewer.

**G. Reporting / export**
- Printable / PDF-friendly academy schedule (HEIMDALL-branded header).
- CSV export: full schedule, sign-ups, instructor participation hours.
- FDLE-style hours summary per academy (scheduled vs. target).

---

## 8. Gjallarhorn — Notifications & alert engine (the "robust backend")

Implement as Cloud Functions (Option A primary), namespaced as the **Gjallarhorn** module. Each rule writes an in-app `notifications` doc **and** a `mail` doc (respecting the recipient's `notificationPrefs.email`). Provide clean, **HEIMDALL-branded HTML + plaintext** email templates (a small templating helper, not a heavy dependency) with the Gjallarhorn logo in the header and a "Sounded by Gjallarhorn · HEIMDALL" footer.

**Event-driven (Firestore triggers):**
- **Sign-up confirmation** → email the instructor with session details + .ics.
- **Withdrawal / slot re-opened** → notify the academy's coordinators.
- **Session fully staffed** → notify coordinators.
- **Lead-instructor withdrawal on a session < X days out** → escalate to coordinators + chain of command.
- **Schedule change** (time/room/cancel on a session with sign-ups) → notify all signed-up instructors.
- **Role/qualification approval** → notify the affected user.

**Scheduled (`onSchedule` via `firebase-functions/scheduler`):**
- **Daily reminder sweep** (e.g., 07:00 ET): assignments with `start` within each user's `reminderLeadHours` and `reminderSent == false` → send reminder, set flag.
- **Daily understaffing sweep:** sessions within `understaffingAlertDays` missing required slots → alert coordinators + `escalationRecipients`.
- **Weekly digest:** per-coordinator and command summary of staffing health and open slots.

> Cloud Scheduler allows **3 free jobs**; consolidate the sweeps into as few scheduled functions as practical (or note the ~$0.10/job/month cost). Make schedule times and the timezone (`America/New_York`) configurable.

---

## 9. UI / visual design direction

Professional, calm, command-center feel — a watchtower, not a consumer app. The Norse theme lives in the **logo, wordmark, and subtle accents**, never in garish ornament.

- **Palette:** deep navy/slate base (the night watch), generous whitespace, strong typographic hierarchy. One restrained accent — a **Bifröst-inspired amber/gold** *or* steel-blue — used sparingly for primary actions and the HEIMDALL mark. Status colors: green = fully staffed, amber = understaffed, red = critical / inside alert window, gray = draft. High-liability sessions get a subtle badge.
- **Motif:** allow a faint Norse knotwork or rune-band as a section divider or empty-state flourish, kept low-contrast and optional. The Gjallarhorn glyph appears in the topbar and login.
- **Type:** clean sans for all UI; the display/wordmark face may be slightly more characterful but must stay readable.
- **Requirements:** legible on mobile, **printable** (print stylesheet for schedules), WCAG AA contrast, full keyboard navigation. No emoji in the product UI.

Expose brand colors as Tailwind theme tokens and as the `settings/global` brand fields so they can be tuned without code edits.

---

## 10. Repository structure (target)

```
/                      vite + ts + tailwind config, README, .env.example
/public                favicon.svg (Gjallarhorn), og-image
/.github/workflows/    deploy-pages.yml  (+ reminders-cron.yml for Option B)
/src
  /app                 router, layout shell, providers
  /auth                AuthContext, guards, sign-in pages
  /brand               Logo.tsx (Gjallarhorn), wordmark lockups, design tokens
  /lib                 firebase.ts (init), firestore helpers, ics.ts, rbac.ts
  /types               shared TS interfaces (mirror §5 schema)
  /features
    /cadre             academies (builder, clone, recurring), calendar, staffing board
    /sessions          detail modal, signup logic hooks
    /instructor        browse, my-schedule, profile
    /admin             users, settings, gjallarhorn settings, audit
    /reports           exports, printable schedule
  /components          reusable UI (Button, Modal, Badge, StatusPill, etc.)
/functions
  /src
    /gjallarhorn       triggers, scheduled sweeps, email templates
    /admin             callable role/claim + qualification actions
/firestore.rules
/firestore.indexes.json
/seed                  seed.ts (Admin SDK) → sample catalog, academy, sessions, users
```

---

## 11. Security rules (must implement, don't stub)

Write `firestore.rules` enforcing the §4 RBAC matrix using `request.auth.token.role` custom claims:
- `users`: a user can read/write **their own** doc (except `role`/`status`/qualification `verified`, which only admins set); admins can read/write all.
- `academies`/`sessions`/`courseCatalog`: read = published-or-staff; write = coordinator+ only.
- `sessions/{}/signups`: a user may create/update **only their own** signup doc and only for slots they qualify for; coordinators+ may write any.
- `assignments`: readable by owner + staff; written by functions/transactions only.
- `mail` + `auditLog`: **no client writes** (functions/Admin SDK only); reads restricted to admins.
- `notifications`: owner-read, function-write.
Validate field types and that `filledBy.length <= count` server-side in the transaction (rules can't fully express it; enforce in code + add a rule guard).

---

## 12. Seed data (so it runs immediately)

`seed/seed.ts` (Admin SDK) should create: a settings doc (orgName, HEIMDALL brand colors, logoUrl, Gjallarhorn reminder defaults); ~12 realistic FDLE courses in `courseCatalog` (mix of single-lead and high-liability multi-slot); one **published** sample academy with ~3–4 weeks of sessions (PT blocks, classroom courses, a Firearms day with lead + 2 assistants + safety officer, a DT day with role players); and sample users covering every role (one director, one lieutenant, one sergeant, two coordinators, ~8 instructors with varied/verified qualifications). Make some sessions already partially signed-up so the dashboard and reminders are demonstrable.

---

## 13. Deliverables for this pass

1. Complete, typed, commented codebase per §10.
2. **Brand assets:** `Logo.tsx` (Gjallarhorn) + `favicon.svg` + wordmark lockups, wired into shell/login/emails/print.
3. `firestore.rules` + `firestore.indexes.json`.
4. Gjallarhorn Cloud Functions (Option A) + Option B cron workflow scaffold.
5. HEIMDALL-branded email HTML/text templates.
6. `seed/seed.ts`.
7. `.github/workflows/deploy-pages.yml`.
8. `.env.example` (all `VITE_FIREBASE_*` keys, no real values).
9. **`README.md`** with: prerequisites; create-Firebase-project steps; enable Auth providers; add `*.github.io` to authorized domains; upgrade to Blaze (and why); install + configure Trigger Email extension with an SMTP provider; deploy functions; run the seed script; configure GitHub Pages + the Actions deploy; set GitHub Secrets; and the Option-B free-tier path. Include a "first run" checklist and a troubleshooting section.

## 14. Out of scope (note as future work, don't build)
SMS/Twilio, payments, native mobile apps, SSO/SAML, FDLE system integration, multi-tenant org separation. Leave clean extension points (e.g., a `notify()` abstraction in Gjallarhorn that could later add SMS).

---

**Final instruction to Claude Code:** Build as much as possible now in a single coherent pass. Do not stop to ask clarifying questions unless a choice would break the build; instead, pick the sensible default described here, leave a `// TODO(setup):` where a human secret is required, and record every assumption and manual step in the README.
