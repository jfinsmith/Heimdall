/**
 * HEIMDALL app shell: persistent sidebar (with the CADRE section), topbar
 * with Gjallarhorn bell + user menu + global Create action.
 * Mobile: sidebar collapses behind a hamburger; everything keyboard-reachable.
 */
import React, { useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { can, ROLE_LABELS } from '../lib/rbac';
import { useClickOutside } from '../lib/useClickOutside';
import { WordmarkHorizontal } from '../brand/Logo';
import { NotificationBell } from '../components/NotificationBell';
import { Button } from '../components/ui';

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
  const { profile, role, signOut } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const staff = can.buildSchedules(role);
  const admin = can.manageOrg(role);

  const nav = (
    <nav aria-label="Main navigation" className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
      <NavItem to="/" label="Overview" end />
      {/* CADRE — Coordinated Academy Duty & Roster Engine */}
      <SectionLabel title="CADRE — Coordinated Academy Duty & Roster Engine">CADRE</SectionLabel>
      <NavItem to="/cadre/calendar" label="Calendar" />
      {staff && <NavItem to="/cadre/academies" label="Academies & Builder" />}
      {staff && <NavItem to="/cadre/staffing" label="Staffing Board" />}
      <SectionLabel title="Instructor tools">Instructor</SectionLabel>
      <NavItem to="/open-sessions" label="Browse Open Sessions" />
      <NavItem to="/my-schedule" label="My Schedule" />
      <NavItem to="/profile" label="Profile & Qualifications" />
      {staff && (
        <>
          <SectionLabel title="Reporting">Reports</SectionLabel>
          <NavItem to="/reports" label="Reports & Export" />
        </>
      )}
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
          <NavItem to="/admin/audit" label="Audit Log" />
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
          <NavLink to="/" className="text-watch-50 [&_svg]:text-bifrost-400">
            <WordmarkHorizontal size={26} />
          </NavLink>
        </div>
        {nav}
        <div className="border-t border-watch-800 px-4 py-3 text-xs text-watch-400">
          <div className="font-medium text-watch-200">{profile?.displayName}</div>
          <div>{role ? ROLE_LABELS[role] : ''}</div>
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
        {profile?.status === 'suspended' && (
          <div className="no-print border-b border-red-200 bg-red-50 px-4 py-3 md:px-8" role="alert">
            <p className="text-sm font-semibold text-red-800">Your account is suspended.</p>
            <p className="text-sm text-red-700">
              Please contact Academy Leadership to resolve this and restore your access.
              {profile.suspensionReason ? <span className="block">Reason: {profile.suspensionReason}</span> : null}
            </p>
          </div>
        )}
        <main className="flex-1 px-4 py-6 md:px-8">
          <Outlet />
        </main>
        <footer className="no-print px-8 py-4 text-center text-xs text-watch-300">
          HEIMDALL · CADRE — Coordinated Academy Duty &amp; Roster Engine · Sounded by Gjallarhorn
        </footer>
      </div>
    </div>
  );
}
