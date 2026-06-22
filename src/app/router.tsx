/**
 * HEIMDALL router. BrowserRouter (clean URLs) — Firebase Hosting rewrites all
 * paths to /index.html (see firebase.json), so deep links work without a hash.
 * Page components are lazy-loaded (code-split) so the initial bundle stays small
 * — instructors don't download staff/admin or the heavy FullCalendar code until
 * they navigate to it.
 */
import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { RequireAdmin, RequireAuth, RequireStaff, RequirePlatformOwner } from '../auth/guards';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from '../components/ui';
// Auth/entry pages stay eager — they're small and needed immediately on load.
import { SignInPage } from '../auth/SignInPage';
import { PendingApprovalPage } from '../auth/PendingApprovalPage';
import { AwaitingOrgPage } from '../auth/AwaitingOrgPage';
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
const RoomsPage = lazy(() => import('../features/cadre/rooms/RoomsPage').then((m) => ({ default: m.RoomsPage })));
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
const CadetReportsPage = lazy(() => import('../features/cadre/reports/CadetReportsPage').then((m) => ({ default: m.CadetReportsPage })));
const CadetReportPrintPage = lazy(() => import('../features/cadre/reports/CadetReportPrintPage').then((m) => ({ default: m.CadetReportPrintPage })));
const DayRosterPrintPage = lazy(() => import('../features/cadre/roster/DayRosterPrintPage').then((m) => ({ default: m.DayRosterPrintPage })));
const FeedbackReportPage = lazy(() => import('../features/feedback/FeedbackReportPage').then((m) => ({ default: m.FeedbackReportPage })));
const FeedbackAdminPage = lazy(() => import('../features/feedback/FeedbackAdminPage').then((m) => ({ default: m.FeedbackAdminPage })));
const ReportFormsAdminPage = lazy(() => import('../features/admin/ReportFormsAdminPage').then((m) => ({ default: m.ReportFormsAdminPage })));
const OwnerConsolePage = lazy(() => import('../features/admin/OwnerConsolePage').then((m) => ({ default: m.OwnerConsolePage })));
const OwnerAuditPage = lazy(() => import('../features/admin/OwnerAuditPage').then((m) => ({ default: m.OwnerAuditPage })));
const BillingPage = lazy(() => import('../features/admin/BillingPage').then((m) => ({ default: m.BillingPage })));
const CompliancePage = lazy(() => import('../features/admin/CompliancePage').then((m) => ({ default: m.CompliancePage })));
const MarketingPage = lazy(() => import('../features/marketing/MarketingPage').then((m) => ({ default: m.MarketingPage })));

function RouteFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner className="text-bifrost-400" />
    </div>
  );
}

/** The public marketing site lives on the public domain (+ localhost for dev).
 *  Any other host — e.g. the agency-internal domain — is treated as app-only and
 *  skips straight to sign-in, so internal users land on the app, not the pitch. */
function isMarketingHost(): boolean {
  if (typeof window === 'undefined') return true;
  const h = window.location.hostname;
  return h.endsWith('heimdallscheduling.com') || h === 'localhost' || h === '127.0.0.1';
}

/**
 * The bare path "/". Signed-in users go to their dashboard (/overview), where
 * RequireAuth applies the usual pending/awaiting-org/profile gating. Signed-out
 * visitors see the marketing landing on the public domain, or go straight to
 * sign-in on app-only (internal) hosts.
 */
function RootGate() {
  const { firebaseUser, loading } = useAuth();
  if (loading) return <RouteFallback />;
  if (firebaseUser) return <Navigate to="/overview" replace />;
  if (!isMarketingHost()) return <Navigate to="/signin" replace />;
  return <MarketingPage />;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<RootGate />} />
          <Route path="/pricing" element={<MarketingPage />} />
          <Route path="/signin" element={<SignInPage />} />
          <Route path="/pending" element={<PendingApprovalPage />} />
          <Route path="/awaiting-org" element={<AwaitingOrgPage />} />

          <Route element={<RequireAuth />}>
            <Route path="/change-password" element={<ChangePasswordPage />} />
            <Route path="/welcome" element={<CompleteProfilePage />} />
            {/* Print views render outside the shell for a clean sheet */}
            <Route path="/reports/print/:academyId" element={<PrintableSchedulePage />} />
            <Route element={<RequireStaff />}>
              <Route path="/cadet-reports/print/:academyId/:reportId" element={<CadetReportPrintPage />} />
              <Route path="/roster/day/print/:academyId/:date" element={<DayRosterPrintPage />} />
            </Route>

            <Route element={<AppShell />}>
              {/* The app dashboard lives at /overview; the bare "/" is the public
                  marketing landing (RootGate) that redirects members here. */}
              <Route path="/overview" element={<OverviewPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/cadre/calendar" element={<CalendarPage />} />
              <Route path="/open-sessions" element={<BrowseOpenSessionsPage />} />
              <Route path="/my-schedule" element={<MySchedulePage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/feedback" element={<FeedbackReportPage />} />

              <Route element={<RequireStaff />}>
                <Route path="/cadre/academies" element={<AcademiesPage />} />
                <Route path="/cadre/academies/:academyId" element={<AcademyBuilderPage />} />
                <Route path="/cadre/academies/:academyId/roster" element={<AcademyRosterPage />} />
                <Route path="/cadre/staffing" element={<StaffingBoardPage />} />
                <Route path="/cadre/rooms" element={<RoomsPage />} />
                <Route path="/cadet-reports" element={<CadetReportsPage />} />
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
                <Route path="/admin/billing" element={<BillingPage />} />
                <Route path="/admin/compliance" element={<CompliancePage />} />
                <Route path="/admin/audit" element={<AuditLogPage />} />
              </Route>

              {/* Platform owner only — cross-org HEIMDALL operator console */}
              <Route element={<RequirePlatformOwner />}>
                <Route path="/owner" element={<OwnerConsolePage />} />
                <Route path="/owner/curricula" element={<CurriculumAdminPage scope="defaults" />} />
                <Route path="/owner/report-forms" element={<ReportFormsAdminPage />} />
                <Route path="/owner/feedback" element={<FeedbackAdminPage />} />
                <Route path="/owner/audit" element={<OwnerAuditPage />} />
              </Route>
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
