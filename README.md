# HEIMDALL

**Watch staffing. Sound the alert.**

HEIMDALL is a training-schedule and instructor-staffing platform for a law-enforcement
training academy running the Florida FDLE Basic Recruit Training Program (BRTP).
Coordinators build full academy schedules; a roster of instructors self-signs-up to
teach sessions they are qualified for; an automated backend reminds, alerts, and
escalates.

The naming is Norse and deliberate — Heimdall is the all-seeing watchman who sounds
the **Gjallarhorn** when something is coming:

| Name | What it is |
|---|---|
| **HEIMDALL** | The platform / brand. A codename with meaning, not an acronym. |
| **CADRE** | *Coordinated Academy Duty & Roster Engine* — the scheduling subsystem: builder, calendar, staffing board. (In law enforcement, the "cadre" is the academy's training staff.) |
| **Gjallarhorn** | The notification engine — reminders, understaffing alerts, command escalation, email. Every email signs off "Sounded by Gjallarhorn · HEIMDALL". |

## Stack

- **Frontend:** React 18 + TypeScript + Vite, Tailwind CSS, React Router v6 (**BrowserRouter**), FullCalendar
- **Backend:** Firebase — Auth, Cloud Firestore, Cloud Functions (Node 20, TS), **Trigger Email from Firestore** extension
- **Hosting:** Firebase Hosting via GitHub Actions (migrated off GitHub Pages — see §8)
- **Data reads:** lightweight `onSnapshot` hooks (`src/lib/firestore.ts`) — no React Query, one consistent idiom

> **Routing:** Uses **BrowserRouter** (clean URLs, no `#`). Firebase Hosting
> rewrites every path to `/index.html` (`firebase.json`), so deep links resolve to
> the SPA. `vite.config.ts` uses `base: '/'` (absolute asset paths) — required so
> assets load on deep-link routes.

## Repository map

```
/src
  /app          router, shell (sidebar/topbar/bell), providers (auth + runtime branding)
  /auth         AuthContext, guards, sign-in/register/reset, pending approval, profile completion
  /brand        Logo.tsx — Gjallarhorn glyph + HEIMDALL wordmark lockups
  /lib          firebase init, Firestore hooks, rbac, ics, csv, time helpers
  /types        shared interfaces (mirror of the Firestore data model)
  /features
    /cadre      academies + builder + clone + recurring blocks, calendar, staffing board
    /sessions   detail modal, transactional sign-up/withdraw, audit helper
    /instructor browse open sessions, my schedule (.ics), profile & qualifications
    /admin      users/roles, org settings, Gjallarhorn settings, audit log
    /reports    CSV exports, FDLE hours summary, printable schedule
/functions      Gjallarhorn triggers + scheduled sweeps + admin callables
/seed           seed.ts — demo data (Admin SDK)
/scripts        gjallarhorn-cron.ts — Option B free-tier sweep
/.github/workflows  firebase-deploy.yml, reminders-cron.yml (Option B, off by default)
firestore.rules / firestore.indexes.json / firebase.json
```

---

## Prerequisites

- Node 20+ and npm
- A Google account for [Firebase Console](https://console.firebase.google.com)
- A GitHub repository (for Pages hosting)
- `npm i -g firebase-tools` and `firebase login`

## 1. Create the Firebase project

1. Firebase Console → **Add project** (e.g. `heimdall-academy`). Analytics optional.
2. **Build → Firestore Database → Create database** (production mode, pick a region —
   functions are configured for `us-east1` in `functions/src/index.ts`).
3. **Project settings → Your apps → Web app** (`</>`): register "HEIMDALL", copy the
   config values into `.env` (copy `.env.example` → `.env`). These are the
   `VITE_FIREBASE_*` keys — client config, not secrets, but keep `.env` untracked.

## 2. Enable Auth providers & authorized domains

1. **Build → Authentication → Get started.**
2. Enable **Google** and **Email/Password** sign-in providers.
3. **Authentication → Settings → Authorized domains → Add domain:** add
   `<your-user>.github.io` (and any custom domain). `localhost` is pre-authorized
   for development. *Sign-in will fail on Pages until this is done.*

## 3. Upgrade to Blaze (for Option A)

Cloud Functions (2nd gen), the Trigger Email extension, and Cloud Scheduler all
require the **Blaze** (pay-as-you-go) plan. Typical usage for one academy stays
within the free tier; Cloud Scheduler is ~$0.10/job/month after **3 free jobs** —
HEIMDALL deliberately uses only **2** (daily sweep + weekly digest).

**Don't want billing at all?** Skip functions and use **Option B** (below) — the
sign-up flow, calendar, and dashboards work without functions; only email/alerts
and role-claim automation need a server.

## 4. Install & configure the Trigger Email extension

1. Console → **Extensions** → install **“Trigger Email from Firestore”**
   (`firebase/firestore-send-email`).
2. Configuration:
   - **Email documents collection:** `mail`
   - **SMTP connection URI:** from your provider, e.g.
     - SendGrid: `smtps://apikey:SG.xxxxx@smtp.sendgrid.net:465`
     - Mailgun: `smtps://postmaster@yourdomain:PASSWORD@smtp.mailgun.org:465`
     - Resend: `smtps://resend:re_xxxx@smtp.resend.com:465`
     - Gmail (testing only): `smtps://you@gmail.com:APP_PASSWORD@smtp.gmail.com:465`
   - **Default FROM:** e.g. `HEIMDALL <no-reply@yourdomain.org>`
3. Security: `firestore.rules` already blocks all client writes to `mail/` —
   only Cloud Functions (Admin SDK) enqueue email.

## 5. Deploy rules, indexes, and functions

```bash
firebase use <your-project-id>
firebase deploy --only firestore:rules,firestore:indexes
cd functions && npm install && cd ..
firebase deploy --only functions
```

This deploys the Gjallarhorn triggers, the two scheduled sweeps
(07:00 ET daily, 06:00 ET Monday — edit `DAILY_AT`/`WEEKLY_AT`/`TIMEZONE` in
`functions/src/gjallarhorn/sweeps.ts`), and the `setUserRole` /
`bootstrapFirstDirector` callables.

## 6. Seed demo data

```bash
npm install
# Console → Project settings → Service accounts → Generate new private key
export GOOGLE_APPLICATION_CREDENTIALS=./service-account.json   # keep out of git!
npm run seed
```

Creates the settings doc, 12 FDLE-style courses, a published academy
("BLE Class 2026-01", starting next-next Monday) with ~4 weeks of sessions —
PT blocks, classroom days, a Firearms day (lead + 2 assistants + safety officer,
deliberately missing the safety officer so the dashboard shows red), a fully
staffed DT day with role players — and 13 users across every role.

**Demo logins** (password `Heimdall!Demo1` — delete these users before real use):
`captain.frost@example.org` (director), `lt.ramirez@…` (lieutenant),
`sgt.okafor@…` (sergeant), `coord.hale@…` / `coord.bishop@…` (coordinators),
`inst.vargas@…`, `inst.cole@…`, `inst.nguyen@…`, `inst.pratt@…`, `inst.kimball@…`,
`inst.soto@…`, `inst.reyes@…`, `inst.walsh@…` (instructors with varied verified
qualifications).

## 7. Run locally

```bash
npm run dev    # http://localhost:5173
```

## 8. Firebase Hosting deploy

1. Repo **Settings → Secrets and variables → Actions** → add the build secrets:
   `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
   `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`,
   `VITE_FIREBASE_APP_ID`.
2. Add the deploy secret `FIREBASE_SERVICE_ACCOUNT_HEIMDALL_E1F03` (a Firebase
   Hosting Admin service-account key) — created automatically by
   `firebase init hosting:github`.
3. Push to `main` — `.github/workflows/firebase-deploy.yml` builds with the
   `VITE_*` secrets and deploys `dist/` to the Hosting live channel.
4. Confirm the live domain (`heimdall.tgcmd-portal.com` / `*.web.app`) is in
   Firebase Auth authorized domains (§2).
5. Firestore **rules + indexes** are NOT deployed by this workflow — run
   `firebase deploy --only firestore:rules,firestore:indexes` manually after
   changing them (see §G note in the audit).

## Option B — free-tier (Spark) reminders, no Cloud Functions

A GitHub Actions cron replaces the scheduled functions:

1. Open `.github/workflows/reminders-cron.yml` and **uncomment the `schedule:`
   block** (it ships disabled so you never double-send alongside Option A).
2. Add GitHub secrets:
   - `FIREBASE_SERVICE_ACCOUNT` — the **content** of a service-account JSON
   - `SENDGRID_API_KEY` — or adapt `sendEmail()` in `scripts/gjallarhorn-cron.ts`
     to Mailgun/Resend/Postmark
   - `MAIL_FROM` — e.g. `HEIMDALL <no-reply@yourdomain.org>`
3. The script performs the daily reminder + understaffing sweeps. Event-driven
   email (sign-up confirmations, schedule-change notices) requires Option A —
   without functions those remain in-app-only behaviors driven by the UI.

> Note for Option B: GitHub cron is UTC. `0 11 * * *` = 07:00 EDT / 06:00 EST;
> adjust seasonally if the hour matters.

## First-run checklist

- [ ] `.env` filled from Firebase web app config
- [ ] Google + Email/Password providers enabled
- [ ] Hosting domain (`*.web.app` / custom) added to authorized domains
- [ ] Blaze upgraded (Option A) **or** Option B cron enabled
- [ ] Trigger Email extension installed with SMTP URI (Option A)
- [ ] `firebase deploy --only firestore:rules,firestore:indexes,functions`
- [ ] `npm run seed` with a service-account key
- [ ] `VITE_FIREBASE_*` + `FIREBASE_SERVICE_ACCOUNT_HEIMDALL_E1F03` repo secrets set
- [ ] Sign in as a demo coordinator and open **CADRE → Staffing Board**
- [ ] For a fresh (unseeded) org: sign in, then call `bootstrapFirstDirector`
      from the browser console to claim the first director account:
      ```js
      // paste in DevTools on the signed-in app
      const { getFunctions, httpsCallable } = await import('firebase/functions');
      await httpsCallable(getFunctions(), 'bootstrapFirstDirector')();
      ```
- [ ] Delete/rotate the seeded demo users before real rollout

## Security model (summary)

- Roles (`director` > `lieutenant` > `sergeant` > `coordinator` > `instructor`)
  live on `users/{uid}` and are mirrored into a **custom auth claim** by the
  `setUserRole` callable; `firestore.rules` checks `request.auth.token.role`.
- Instructors read only published academies/sessions; coordinator+ writes schedules.
- Sign-ups run a client **transaction** that re-validates slot capacity,
  qualification (against the rule-protected `verifiedQualKeys` field — staff-set
  only), double-booking, and recomputes session status. Non-staff session writes
  are rules-restricted to `roleSlots/status/updatedAt` with a fixed slot count.
- `mail/` and `notifications/` are function-written only; `auditLog` is
  append-only with the actor's own uid; reads are admin-only.

## Assumptions & decisions made during the build

- **HashRouter** over 404-redirect (simplest reliable Pages setup).
- **Custom snapshot hooks** over React Query (smaller surface, live updates).
- Functions region `us-east1`; sweep timezone `America/New_York` — both constants.
- Default target hours: LE 770 / Corrections 520 / Cross-Over 318 — editable per
  academy at creation; nothing hard-codes them downstream.
- Lead-withdrawal escalation window: 7 days (`LEAD_ESCALATION_DAYS` in
  `functions/src/gjallarhorn/triggers.ts`).
- Waitlist promotion happens on withdrawal (first-come by sign-up time).
- The clone-academy tool copies sessions with **empty staffing** and `draft` status.
- `qualifications[].verified` is display metadata; the enforceable gate is the
  flat `verifiedQualKeys` array (rules can't iterate arrays of maps).
- Bulk messages fan out via a `bulkMessages` queue doc so clients never write
  `mail/` directly.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `auth/unauthorized-domain` on sign-in | Add the Pages domain in Auth → Settings → Authorized domains. |
| Sign-in works but every query fails with `permission-denied` | Rules not deployed, or the user has no role claim yet — approve the user (writes the claim) or run `bootstrapFirstDirector`. |
| Role change doesn't take effect | Claims refresh on token refresh; the app force-refreshes when the profile role changes — otherwise sign out/in. |
| Query fails with "requires an index" | `firebase deploy --only firestore:indexes`, or click the link in the error. |
| Emails never send | Extension installed? SMTP URI valid? Check the extension's logs and the `delivery` field it writes back onto `mail/` docs. |
| Scheduled sweeps don't run | Blaze plan required; check Cloud Scheduler jobs exist after deploy. |
| Pages site is blank | Pages source must be "GitHub Actions"; check the build used the `VITE_FIREBASE_*` secrets. |
| Seed fails with auth errors | `GOOGLE_APPLICATION_CREDENTIALS` must point at a valid service-account JSON for *this* project. |

## Future work (deliberately out of scope)

SMS/Twilio (plug into `notify()` in `functions/src/gjallarhorn/notify.ts` — it's the
single choke point for all channels), payments, native mobile apps, SSO/SAML,
FDLE system integration, multi-tenant org separation.

---

*HEIMDALL · CADRE — Coordinated Academy Duty & Roster Engine · Sounded by Gjallarhorn*
