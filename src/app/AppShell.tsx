/**
 * HEIMDALL app shell: persistent sidebar (with the CADRE section), topbar
 * with Gjallarhorn bell + user menu + global Create action.
 * Mobile: sidebar collapses behind a hamburger; everything keyboard-reachable.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../lib/firebase';
import { useAuth } from '../auth/AuthContext';
import { useOrg } from '../lib/useOrg';
import { billingState } from '../lib/subscription';
import { can } from '../lib/rbac';
import { useRoleLabels } from './providers';
import { useClickOutside } from '../lib/useClickOutside';
import { PoweredByHeimdall } from '../brand/OrgLogo';
import { WordmarkHorizontal } from '../brand/Logo';
import { NotificationBell } from '../components/NotificationBell';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { Button } from '../components/ui';

const ownerListOrgs = httpsCallable<void, { orgs: { orgId: string; legalName: string }[] }>(functions, 'ownerListOrgs');
const ownerSwitchOrg = httpsCallable<{ orgId: string }, { ok: boolean }>(functions, 'ownerSwitchOrg');

/** Platform-owner cross-org switching: load every org, switch the active tenant
 *  (claim+doc swap server-side), then hard-reload so the whole app re-queries. */
function useOrgSwitch(enabled: boolean) {
  const { orgId } = useAuth();
  const [orgs, setOrgs] = useState<{ orgId: string; legalName: string }[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    ownerListOrgs().then((r) => setOrgs(r.data.orgs)).catch(() => setOrgs([]));
  }, [enabled]);
  const switchTo = useCallback(
    async (target: string) => {
      if (!target || target === orgId || busy) return;
      setBusy(true);
      try {
        await ownerSwitchOrg({ orgId: target });
      } catch (e) {
        alert((e as Error).message || 'Could not switch organizations.');
        setBusy(false);
        return;
      }
      // Switch persisted (claim + doc). Refresh the token best-effort, then hard
      // reload REGARDLESS — a fresh boot re-reads the token and AuthContext
      // reconciles, so a transient getIdToken failure can't leave the session
      // half-switched (client filtering on the new org while rules see the old).
      try {
        await auth.currentUser?.getIdToken(true);
      } catch {
        /* the reload re-bootstraps auth and force-refreshes the token itself */
      }
      window.location.assign('/');
    },
    [orgId, busy]
  );
  return { orgs, switchTo, busy };
}

function NavItem({ to, label, end = false }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `block rounded-md px-3 py-2 text-sm transition-colors ${
          isActive
            ? 'bg-watch-800 font-semibold text-bifrost-300'
            : 'text-watch-200 hover:bg-watch-800/60 hover:text-watch-50'
        }`
      }
    >
      {label}
    </NavLink>
  );
}

/** Avatar dropdown — closes on outside click / Escape, not just re-click. */
function UserMenu({ displayName, onSignOut }: { displayName?: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-watch-100 hover:bg-watch-800"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-bifrost-500 text-xs font-bold text-watch-950">
          {displayName?.slice(0, 1).toUpperCase() ?? '?'}
        </span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-44 rounded-lg border border-watch-100 bg-white py-1 shadow-xl">
          <NavLink
            to="/profile"
            role="menuitem"
            className="block px-4 py-2 text-sm text-slate-700 hover:bg-watch-50"
            onClick={() => setOpen(false)}
          >
            Profile
          </NavLink>
          <button
            role="menuitem"
            className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-watch-50"
            onClick={onSignOut}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children, title }: { children?: React.ReactNode; title: string }) {
  return (
    <div className="mt-5 px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-watch-500" title={title}>
      {children}
    </div>
  );
}

export function AppShell() {
  const { profile, role, platformOwner, signOut } = useAuth();
  const roleLabels = useRoleLabels();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const staff = can.buildSchedules(role);
  const admin = can.manageOrg(role);
  const { orgs: switchOrgs, switchTo, busy: switchBusy } = useOrgSwitch(platformOwner);
  const impersonating = platformOwner && !!profile?.homeOrgId && profile.orgId !== profile.homeOrgId;
  const activeOrgName = switchOrgs.find((o) => o.orgId === profile?.orgId)?.legalName ?? profile?.orgId ?? '';
  // Subscription gating (Phase 14): only shows when commercialization is on for
  // this org AND it's lapsed — never for the founding/complimentary tenants.
  const { data: org } = useOrg();
  const billing = billingState(org);
  const showBillingBanner = billing.gated && (!billing.active || billing.inGrace);

  const nav = (
    <nav aria-label="Main navigation" className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
      <NavItem to="/overview" label="Overview" end />
      <NavItem to="/how-to" label="How To" />
      {/* CADRE — Coordinated Academy Duty & Roster Engine */}
      <SectionLabel title="CADRE — Coordinated Academy Duty & Roster Engine">CADRE</SectionLabel>
      <NavItem to="/cadre/calendar" label="Calendar" />
      {staff && <NavItem to="/cadre/academies" label="Academies" />}
      {staff && <NavItem to="/cadre/staffing" label="Staffing Board" />}
      {staff && <NavItem to="/cadre/rooms" label="Room Reservations" />}
      {staff && <NavItem to="/cadre/remediation" label="Remediation" />}
      {/* Cadet Reports hidden from nav — duplicative of the per-academy Reports tab. Route still works; re-enable by uncommenting.
      {staff && <NavItem to="/cadet-reports" label="Cadet Reports" />} */}
      {staff && <NavItem to="/reports" label="Exports" />}
      <SectionLabel title="Instructor tools">Instructor</SectionLabel>
      <NavItem to="/open-sessions" label="Browse Open Sessions" />
      <NavItem to="/my-schedule" label="My Schedule" />
      <NavItem to="/profile" label="Profile & Qualifications" />
      <NavItem to="/feedback" label="Report a Problem" />
      {admin && (
        <>
          <SectionLabel title="Administration">Admin</SectionLabel>
          <NavItem to="/admin/users" label="Users & Roles" />
          <NavItem to="/admin/roster" label="Roster & Certifications" />
          <NavItem to="/admin/permissions" label="Roles & Permissions" />
          <NavItem to="/admin/curriculum" label="Curriculum & Hours" />
          <NavItem to="/admin/holidays" label="Holidays" />
          <NavItem to="/admin/settings" label="Org Settings" />
          <NavItem to="/admin/gjallarhorn" label="Gjallarhorn & Email" />
          <NavItem to="/admin/billing" label="Billing" />
          <NavItem to="/admin/compliance" label="Compliance & Data" />
          <NavItem to="/admin/audit" label="Audit Log" />
        </>
      )}
      {platformOwner && (
        <>
          <SectionLabel title="HEIMDALL platform operator">Platform</SectionLabel>
          <NavItem to="/owner" label="Owner Console" end />
          <NavItem to="/owner/curricula" label="Default Curricula" />
          <NavItem to="/owner/report-forms" label="Report Forms" />
          <NavItem to="/owner/feedback" label="Bug & Feature Reports" />
          <NavItem to="/owner/audit" label="Audit Log (all orgs)" />
        </>
      )}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* Sidebar — sticky: stays put while the main column scrolls */}
      <aside
        className={`no-print fixed inset-y-0 left-0 z-30 flex h-screen w-60 flex-col bg-watch-950 transition-transform md:sticky md:top-0 md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-14 items-center px-4">
          <NavLink to="/overview" className="text-watch-50 [&_svg]:text-bifrost-400">
            {/* HEIMDALL platform branding in the app UI (org branding is for printed documents). */}
            <WordmarkHorizontal size={26} />
          </NavLink>
        </div>
        {platformOwner && switchOrgs.length > 0 && (
          <div className="border-b border-watch-800 px-3 pb-3 pt-1">
            <label htmlFor="org-switch" className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-watch-500">
              Viewing organization
            </label>
            <select
              id="org-switch"
              value={profile?.orgId ?? ''}
              disabled={switchBusy}
              onChange={(e) => switchTo(e.target.value)}
              className="w-full rounded-md border border-watch-700 bg-watch-900 px-2 py-1.5 text-sm text-watch-100 focus:border-bifrost-400 focus:outline-none disabled:opacity-50"
            >
              {switchOrgs.map((o) => (
                <option key={o.orgId} value={o.orgId}>{o.legalName}</option>
              ))}
            </select>
          </div>
        )}
        {nav}
        <div className="border-t border-watch-800 px-4 py-3 text-xs text-watch-400">
          <div className="font-medium text-watch-200">{profile?.displayName}</div>
          <div>{role ? roleLabels[role] : ''}</div>
        </div>
      </aside>
      {sidebarOpen && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-20 bg-watch-950/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b border-watch-100 bg-watch-900 px-4">
          <button
            className="rounded-md p-2 text-watch-200 hover:bg-watch-800 md:hidden"
            aria-label="Open navigation"
            onClick={() => setSidebarOpen(true)}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path d="M3 5h14v2H3V5zm0 4h14v2H3V9zm0 4h14v2H3v-2z" />
            </svg>
          </button>
          <div className="hidden text-xs font-medium uppercase tracking-[0.2em] text-watch-400 md:block">
            Watch staffing · Sound the alert
          </div>
          <div className="flex items-center gap-2">
            {staff && (
              <Button variant="primary" onClick={() => navigate('/cadre/academies?create=1')}>
                + Create
              </Button>
            )}
            <NotificationBell />
            <UserMenu displayName={profile?.displayName} onSignOut={() => signOut()} />
          </div>
        </header>
        {impersonating && (
          <div className="no-print flex flex-wrap items-center justify-between gap-2 border-b border-amber-300 bg-amber-100 px-4 py-2 md:px-8" role="status">
            <p className="text-sm text-amber-900">
              <i className="ti ti-eye" aria-hidden="true" /> Platform owner — viewing <strong>{activeOrgName}</strong>. Changes you make affect this organization.
            </p>
            <Button
              variant="ghost"
              className="text-amber-900 hover:bg-amber-200"
              disabled={switchBusy}
              onClick={() => profile?.homeOrgId && switchTo(profile.homeOrgId)}
            >
              Return to my organization
            </Button>
          </div>
        )}
        {profile?.status === 'suspended' && (
          <div className="no-print border-b border-red-200 bg-red-50 px-4 py-3 md:px-8" role="alert">
            <p className="text-sm font-semibold text-red-800">Your account is suspended.</p>
            <p className="text-sm text-red-700">
              Please contact Academy Leadership to resolve this and restore your access.
              {profile.suspensionReason ? <span className="block">Reason: {profile.suspensionReason}</span> : null}
            </p>
          </div>
        )}
        {showBillingBanner && (
          <div
            className={`no-print flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 md:px-8 ${
              billing.inGrace ? 'border-amber-300 bg-amber-100 text-amber-900' : 'border-red-200 bg-red-50 text-red-800'
            }`}
            role="status"
          >
            <p className="text-sm">
              {billing.inGrace
                ? 'A subscription payment is past due — please update billing to avoid interruption.'
                : 'Your subscription is inactive. Creating and publishing new academies is paused; existing records stay available.'}
            </p>
            {admin && (
              <Link
                to="/admin/billing"
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
                  billing.inGrace ? 'text-amber-900 hover:bg-amber-200' : 'text-red-800 hover:bg-red-100'
                }`}
              >
                Manage billing →
              </Link>
            )}
          </div>
        )}
        <main className="flex-1 px-4 py-6 md:px-8">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
        <footer className="no-print px-8 py-4 text-center text-xs text-watch-300">
          <div>CADRE — Coordinated Academy Duty &amp; Roster Engine · Sounded by Gjallarhorn</div>
          <div className="mt-1 flex justify-center"><PoweredByHeimdall className="!text-watch-400" /></div>
        </footer>
      </div>
    </div>
  );
}
