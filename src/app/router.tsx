/**
 * HEIMDALL router. BrowserRouter (clean URLs) — Firebase Hosting rewrites all
 * paths to /index.html (see firebase.json), so deep links work without a hash.
 * Page components are lazy-loaded (code-split) so the initial bundle stays small
 * — instructors don't download staff/admin or the heavy FullCalendar code until
 * they navigate to it.
 */
import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { RequireAdmin, RequireAuth, RequireStaff } from '../auth/guards';
import { Spinner } from '../components/ui';
// Auth/entry pages stay eager — they're small and needed immediately on load.
import { SignInPage } from '../auth/SignInPage';
import { PendingApprovalPage } from '../auth/PendingApprovalPage';
import { CompleteProfilePage } from '../auth/CompleteProfilePage';
import { ChangePasswordPage } from '../auth/ChangePasswordPage';

// Lazy page chunks.
const OverviewPage = lazy(() => import('../features/OverviewPage').then((m) => ({ default: m.OverviewPage })));
const NotificationsPage = lazy(() => import('../features/NotificationsPage').then((m) => ({ default: m.NotificationsPage })));
const CalendarPage = lazy(() => import('../features/cadre/CalendarPage').then((m) => ({ default: m.CalendarPage })));
const AcademiesPage = lazy(() => import('../features/cadre/AcademiesPage').then((m) => ({ default: m.AcademiesPage })));
const AcademyBuilderPage = lazy(() => import('../features/cadre/AcademyBuilderPage').then((m) => ({ default: m.AcademyBuilderPage })));
const AcademyRosterPage = lazy(() => import('../features/cadre/roster/RosterPage').then((m) => ({ default: m.RosterPage })));
const StaffingBoardPage = lazy(() => import('../features/cadre/StaffingBoardPage').then((m) => ({ default: m.StaffingBoardPage })));
const BrowseOpenSessionsPage = lazy(() => import('../features/instructor/BrowseOpenSessionsPage').then((m) => ({ default: m.BrowseOpenSessionsPage })));
const MySchedulePage = lazy(() => import('../features/instructor/MySchedulePage').then((m) => ({ default: m.MySchedulePage })));
const ProfilePage = lazy(() => import('../features/instructor/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const UsersAdminPage = lazy(() => import('../features/admin/UsersAdminPage').then((m) => ({ default: m.UsersAdminPage })));
const RosterPage = lazy(() => import('../features/admin/RosterPage').then((m) => ({ default: m.RosterPage })));
const PermissionsPage = lazy(() => import('../features/admin/PermissionsPage').then((m) => ({ default: m.PermissionsPage })));
const CurriculumAdminPage = lazy(() => import('../features/admin/CurriculumAdminPage').then((m) => ({ default: m.CurriculumAdminPage })));
const HolidaysAdminPage = lazy(() => import('../features/admin/HolidaysAdminPage').then((m) => ({ default: m.HolidaysAdminPage })));
const SettingsAdminPage = lazy(() => import('../features/admin/SettingsAdminPage').then((m) => ({ default: m.SettingsAdminPage })));
const GjallarhornSettingsPage = lazy(() => import('../features/admin/GjallarhornSettingsPage').then((m) => ({ default: m.GjallarhornSettingsPage })));
const AuditLogPage = lazy(() => import('../features/admin/AuditLogPage').then((m) => ({ default: m.AuditLogPage })));
const ReportsPage = lazy(() => import('../features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const PrintableSchedulePage = lazy(() => import('../features/reports/PrintableSchedulePage').then((m) => ({ default: m.PrintableSchedulePage })));

function RouteFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner className="text-bifrost-400" />
    </div>
  );
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/signin" element={<SignInPage />} />
          <Route path="/pending" element={<PendingApprovalPage />} />

          <Route element={<RequireAuth />}>
            <Route path="/change-password" element={<ChangePasswordPage />} />
            <Route path="/welcome" element={<CompleteProfilePage />} />
            {/* Print view renders outside the shell for a clean sheet */}
            <Route path="/reports/print/:academyId" element={<PrintableSchedulePage />} />

            <Route element={<AppShell />}>
              <Route index element={<OverviewPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/cadre/calendar" element={<CalendarPage />} />
              <Route path="/open-sessions" element={<BrowseOpenSessionsPage />} />
              <Route path="/my-schedule" element={<MySchedulePage />} />
              <Route path="/profile" element={<ProfilePage />} />

              <Route element={<RequireStaff />}>
                <Route path="/cadre/academies" element={<AcademiesPage />} />
                <Route path="/cadre/academies/:academyId" element={<AcademyBuilderPage />} />
                <Route path="/cadre/academies/:academyId/roster" element={<AcademyRosterPage />} />
                <Route path="/cadre/staffing" element={<StaffingBoardPage />} />
                <Route path="/reports" element={<ReportsPage />} />
              </Route>

              <Route element={<RequireAdmin />}>
                <Route path="/admin/users" element={<UsersAdminPage />} />
                <Route path="/admin/roster" element={<RosterPage />} />
                <Route path="/admin/permissions" element={<PermissionsPage />} />
                <Route path="/admin/curriculum" element={<CurriculumAdminPage />} />
                <Route path="/admin/holidays" element={<HolidaysAdminPage />} />
                <Route path="/admin/settings" element={<SettingsAdminPage />} />
                <Route path="/admin/gjallarhorn" element={<GjallarhornSettingsPage />} />
                <Route path="/admin/audit" element={<AuditLogPage />} />
              </Route>
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
