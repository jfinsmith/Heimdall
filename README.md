# HEIMDALL

**Watch staffing. Sound the alert.**

HEIMDALL is a multi-tenant scheduling, staffing and records platform for
law-enforcement and corrections training academies. Coordinators build full
academy schedules; instructors sign up for the sessions they are qualified to
teach; cadet rosters, grades, attendance and paperwork live alongside the
schedule; an automated backend reminds, alerts and escalates.

| Name | What it is |
|---|---|
| **HEIMDALL** | The platform / brand. A codename with meaning, not an acronym. |
| **CADRE** | *Coordinated Academy Duty & Roster Engine* — the scheduling side: academies, builder, calendar, staffing board, rooms, rosters. |
| **Gjallarhorn** | The notification engine — bell notifications, email, reminders, understaffing alerts, escalation. |

## Stack

- **Frontend:** React 18 + TypeScript + Vite, Tailwind CSS, React Router v6 (BrowserRouter), FullCalendar
- **Backend:** Firebase — Auth (custom claims), Cloud Firestore, Cloud Storage, Cloud Functions v2 (Node 22, TypeScript, `us-east1`)
- **Email:** Resend, sent by the `sendQueuedEmail` function from the `mailQueue` collection
- **Billing:** Stripe subscriptions (checkout, billing portal, webhook)
- **Hosting:** Firebase Hosting, deployed by GitHub Actions on every push to `main`
- **Data reads:** lightweight `onSnapshot` hooks (`src/lib/firestore.ts`)

## Repository map

```
/src
  /app        router, app shell (sidebar / top bar / bell), settings provider
  /auth       AuthContext, route guards, sign-in / registration funnel pages
  /components shared UI (Modal, buttons, bulk import, error boundary)
  /lib        firebase init, Firestore hooks, rbac, holidays, pay periods, csv, ics
  /types      the Firestore data model
  /features
    /instructor  browse open sessions, my schedule, profile & qualifications
    /sessions    session detail modal, sign-up wrapper
    /cadre       academies, builder, calendar, staffing board, rooms, remediation,
                 limbo, roster (attendance / grades / discipline), documents
    /reports     CSV exports, printable schedule
    /admin       users & roles, curriculum, settings, Gjallarhorn, billing,
                 compliance, and the platform-owner console
    /feedback    report-a-problem and the owner's triage view
    /public      the public class portal (token link, no sign-in)
    /marketing, /legal   public site
/functions/src
  /admin       account, role and organization callables; account purge; roster
  /gjallarhorn triggers, notify(), email templates, mail sender, sweeps, ICS feed
  /sessions    sign-up / withdraw / reservation callables
  /rooms       room reservation callables
  /billing     Stripe
  /public      getPublicClassPortal — the only unauthenticated read
/tests/emulator  security-rules and sign-up concurrency tests
/scripts         operator tools (Admin SDK; need service-account.json — never commit it)
firestore.rules / storage.rules / firestore.indexes.json / firebase.json
```

## Local development

```bash
npm install
cp .env.example .env      # fill in the VITE_FIREBASE_* web-app config
npm run dev               # http://localhost:5173
```

## Checks

```bash
npm run build                       # type-check + production build
npm run lint
npm test                            # unit tests
cd functions && npx tsc --noEmit    # functions type-check
```

The rules tests need a Java runtime for the Firebase emulator:

```bash
firebase emulators:exec --only firestore,auth,storage --project demo-heimdall "npm run test:emulator"
```

## Deploying

| What | How |
|---|---|
| Web app (Hosting) | Push to `main`. CI runs lint, build and unit tests, then deploys. |
| Firestore rules + indexes, Storage rules | Same push. Deployed by CI **only if the emulator tests pass**. |
| Cloud Functions | **Manual:** `firebase deploy --only functions` |

The client and the functions deploy at different times, so callable request and
response shapes must stay backward compatible in both directions.

Function secrets (set once with `firebase functions:secrets:set <NAME>`):
`RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`.

Scheduled functions (Cloud Scheduler, America/New_York):

| Function | Schedule | Does |
|---|---|---|
| `gjallarhornDailySweep` | daily, 07:00 | reminders, understaffing alerts, expiring certifications, mail retention |
| `gjallarhornWeeklyDigest` | Mondays, 06:00 | weekly staffing digest |
| `gjallarhornChangeFlush` | every 2 minutes | sends queued schedule-change notices after the quiet period |
| `accountPurgeDaily` | daily, 07:30 | warns, then removes accounts never linked to an organization |

## Tenancy and security model

- Every organization is a tenant. Org-owned documents carry a non-null `orgId`,
  and the rules compare it with the caller's `orgId` token claim. Client list
  queries must filter by `orgId`.
- Roles: `instructor` < `coordinator` < `sergeant` < `lieutenant` = `director`.
  Coordinator and above are staff; sergeant and above are admins. Lieutenant and
  director have identical permissions. Acting on another member requires a
  strictly lower rank.
- The rules trust the **token claims** (`role`, `orgId`, `platformOwner`,
  `status`). Claims are minted only by callables. A `status` claim of
  `suspended`, `inactive` or `pending` blocks all organization reads; `pending`
  is set when an account joins an organization and removed when an admin
  approves it.
- Sign-ups, withdrawals, reservations and room holds run in server-side
  transactions (callables). Clients never write role slots.
- Qualifications: the member-writable `qualifications[].verified` flag is
  display data only. The staff-only `verifiedQualKeys` list is the authority.
- Public (signed-out) data is served only by `getPublicClassPortal`. The rules
  stay closed to unauthenticated reads.
- All outgoing email is written to `mailQueue` by functions and is not readable
  by any client.
- No Social Security numbers are stored anywhere.

## Setting up an organization

1. Seat the platform owner once: `npx tsx scripts/set-platform-owner.ts <email>`.
2. In the app, open **Platform → Owner Console**, create the organization, then
   create its first administrator.
3. That administrator adds members under **Admin → Users & Roles**, or shares
   the organization's join link so members can register and be approved.

For an existing account, `scripts/assign-org.ts` and `scripts/set-role.ts` do the
same from the command line.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `auth/unauthorized-domain` on sign-in | Add the domain under Firebase Auth → Settings → Authorized domains. |
| A member sees `permission-denied` everywhere | Their token has no role yet, or still says `pending` — approve them under Users & Roles (that mints the claims), or run `scripts/set-role.ts`. |
| A role change does not take effect | The app refreshes the token when the profile changes; otherwise sign out and in. |
| A query fails with "requires an index" | Add it to `firestore.indexes.json` and push. |
| Emails never arrive | Check the `delivery` field on the `mailQueue` document and `firebase functions:log --only sendQueuedEmail`. |
| A bare "internal" error when saving or signing up | A network filter is blocking `*.run.app` / `*.cloudfunctions.net`. |
| Scheduled jobs do not run | Check that the four Cloud Scheduler jobs exist after a functions deploy. |

---

*HEIMDALL · CADRE — Coordinated Academy Duty & Roster Engine · Sounded by Gjallarhorn*
