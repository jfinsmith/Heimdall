/**
 * App-level providers: Auth + the signed-in org's settings.
 * BrandProvider subscribes to `settings/{orgId}` and exposes it through
 * useGlobalSettings() / useRoleLabels(). (The name is historical — it no
 * longer themes the app; see the branding-split note below.)
 */
import React, { createContext, useContext } from 'react';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import { useDoc, orgConfigPath } from '../lib/firestore';
import { rankLabels } from '../lib/rbac';
import type { GlobalSettings, Role } from '../types';

const SettingsContext = createContext<GlobalSettings | null>(null);

export function useGlobalSettings(): GlobalSettings | null {
  return useContext(SettingsContext);
}

/** Rank display labels (key → label) with this org's editable overrides applied. */
export function useRoleLabels(): Record<Role, string> {
  return rankLabels(useGlobalSettings());
}

function BrandProvider({ children }: { children: React.ReactNode }) {
  // Per-org settings (doc id == orgId). Skip the read until orgId is known — the
  // legacy 'global' fallback doc is denied to clients post-Phase-5, so reading it
  // while auth is still resolving just throws a permissions error on every load.
  // A read-only Viewer may not read org settings (rules deny it) — skip the read.
  const { orgId, role } = useAuth();
  const { data: settings } = useDoc<GlobalSettings>(orgId && role !== 'viewer' ? orgConfigPath('settings', orgId) : null);

  // NOTE (branding split): org brand colors are NOT applied to the app UI — the
  // app is always Heimdall-branded; org colors appear only on PRINTED documents
  // (schedule covers, letterheads), which read settings.brand* directly.
  return <SettingsContext.Provider value={settings}>{children}</SettingsContext.Provider>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <BrandProvider>{children}</BrandProvider>
    </AuthProvider>
  );
}
