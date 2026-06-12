/**
 * Route guards. RequireAuth gates sign-in + account status; RequireStaff and
 * RequireAdmin layer the RBAC matrix on top (UI-level only — firestore.rules
 * is the real enforcement).
 */
import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { can } from '../lib/rbac';
import { Spinner } from '../components/Spinner';

export function RequireAuth() {
  const { firebaseUser, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageSpinner />;
  if (!firebaseUser) return <Navigate to="/signin" state={{ from: location }} replace />;
  if (profile && profile.status === 'pending') return <Navigate to="/pending" replace />;
  if (profile && profile.status === 'inactive') return <Navigate to="/signin" replace />;
  // Force first-time profile completion (no rank/agency yet)
  if (profile && !profile.rank && location.pathname !== '/welcome') {
    return <Navigate to="/welcome" replace />;
  }
  return <Outlet />;
}

export function RequireStaff() {
  const { role, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (!can.buildSchedules(role)) return <Navigate to="/" replace />;
  return <Outlet />;
}

export function RequireAdmin() {
  const { role, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (!can.manageOrg(role)) return <Navigate to="/" replace />;
  return <Outlet />;
}

function FullPageSpinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-watch-950">
      <Spinner className="text-bifrost-400" />
    </div>
  );
}
