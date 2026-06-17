/**
 * App-level providers: Auth + runtime brand theming.
 * BrandProvider reads `settings/global` and applies brandPrimaryColor /
 * brandAccentColor as CSS custom properties so admins can retheme without a
 * code change.
 */
import React, { createContext, useContext, useEffect } from 'react';
import { AuthProvider } from '../auth/AuthContext';
import { useDoc } from '../lib/firestore';
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
  const { data: settings } = useDoc<GlobalSettings>('settings/global');

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
