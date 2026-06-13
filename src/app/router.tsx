/**
 * HEIMDALL router. HashRouter is used for GitHub Pages — no server-side
 * rewrites needed; the tradeoff (URLs contain `#/`) is documented in the README.
 */
import React from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { RequireAdmin, RequireAuth, RequireStaff } from '../auth/guards';
import { SignInPage } from '../auth/SignInPage';
import { PendingApprovalPage } from '../auth/PendingApprovalPage';
import { CompleteProfilePage } from '../auth/CompleteProfilePage';
import { OverviewPage } from '../features/OverviewPage';
import { CalendarPage } from '../features/cadre/CalendarPage';
import { AcademiesPage } from '../features/cadre/AcademiesPage';
import { AcademyBuilderPage } from '../features/cadre/AcademyBuilderPage';
import { StaffingBoardPage } from '../features/cadre/StaffingBoardPage';
import { BrowseOpenSessionsPage } from '../features/instructor/BrowseOpenSessionsPage';
import { MySchedulePage } from '../features/instructor/MySchedulePage';
import { ProfilePage } from '../features/instructor/ProfilePage';
import { UsersAdminPage } from '../features/admin/UsersAdminPage';
import { PermissionsPage } from '../features/admin/PermissionsPage';
import { SettingsAdminPage } from '../features/admin/SettingsAdminPage';
import { GjallarhornSettingsPage } from '../features/admin/GjallarhornSettingsPage';
import { AuditLogPage } from '../features/admin/AuditLogPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { PrintableSchedulePage } from '../features/reports/PrintableSchedulePage';

export function AppRouter() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/signin" element={<SignInPage />} />
        <Route path="/pending" element={<PendingApprovalPage />} />

        <Route element={<RequireAuth />}>
          <Route path="/welcome" element={<CompleteProfilePage />} />
          {/* Print view renders outside the shell for a clean sheet */}
          <Route path="/reports/print/:academyId" element={<PrintableSchedulePage />} />

          <Route element={<AppShell />}>
            <Route index element={<OverviewPage />} />
            <Route path="/cadre/calendar" element={<CalendarPage />} />
            <Route path="/open-sessions" element={<BrowseOpenSessionsPage />} />
            <Route path="/my-schedule" element={<MySchedulePage />} />
            <Route path="/profile" element={<ProfilePage />} />

            <Route element={<RequireStaff />}>
              <Route path="/cadre/academies" element={<AcademiesPage />} />
              <Route path="/cadre/academies/:academyId" element={<AcademyBuilderPage />} />
              <Route path="/cadre/staffing" element={<StaffingBoardPage />} />
              <Route path="/reports" element={<ReportsPage />} />
            </Route>

            <Route element={<RequireAdmin />}>
              <Route path="/admin/users" element={<UsersAdminPage />} />
              <Route path="/admin/permissions" element={<PermissionsPage />} />
              <Route path="/admin/settings" element={<SettingsAdminPage />} />
              <Route path="/admin/gjallarhorn" element={<GjallarhornSettingsPage />} />
              <Route path="/admin/audit" element={<AuditLogPage />} />
            </Route>
          </Route>
        </Route>
      </Routes>
    </HashRouter>
  );
}
