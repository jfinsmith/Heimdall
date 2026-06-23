/**
 * App-level providers: Auth + runtime brand theming.
 * BrandProvider reads `settings/global` and applies brandPrimaryColor /
 * brandAccentColor as CSS custom properties so admins can retheme without a
 * code change.
 */
import React, { createContext, useContext, useEffect } from 'react';
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
  const { orgId } = useAuth();
  const { data: settings } = useDoc<GlobalSettings>(orgId ? orgConfigPath('settings', orgId) : null);

  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    if (settings.brandPrimaryColor) root.style.setProperty('--brand-primary', settings.brandPrimaryColor);
    if (settings.brandAccentColor) root.style.setProperty('--brand-accent', settings.brandAccentColor);
  }, [settings]);

  return <SettingsContext.Provider value={settings}>{children}</SettingsContext.Provider>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <BrandProvider>{children}</BrandProvider>
    </AuthProvider>
  );
}
