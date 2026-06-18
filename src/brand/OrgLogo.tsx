/**
 * Per-tenant branding marks.
 *
 *  <OrgLogo>          — the signed-in org's own logo (settings.logoUrl), shown
 *                       prominently; falls back to the Heimdall wordmark when the
 *                       org hasn't set one (or before settings load).
 *  <PoweredByHeimdall> — a small, persistent "Powered by HEIMDALL" mark for
 *                       footers, so Heimdall branding stays visible even when an
 *                       org's logo is front-and-center.
 */
import React from 'react';
import { useGlobalSettings } from '../app/providers';
import { GjallarhornGlyph, WordmarkHorizontal, WordmarkStacked } from './Logo';

export interface OrgLogoProps {
  /** Pixel height. */
  size?: number;
  className?: string;
  /** Which Heimdall wordmark to fall back to when the org has no logo. */
  fallback?: 'horizontal' | 'stacked' | 'glyph';
}

export function OrgLogo({ size = 32, className, fallback = 'horizontal' }: OrgLogoProps) {
  const settings = useGlobalSettings();
  const logoUrl = settings?.logoUrl?.trim();
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={settings?.orgName ? `${settings.orgName} logo` : 'Organization logo'}
        className={className}
        style={{ height: size, width: 'auto', maxWidth: size * 6, display: 'inline-block', objectFit: 'contain' }}
      />
    );
  }
  if (fallback === 'stacked') return <WordmarkStacked size={size} className={className} />;
  if (fallback === 'glyph') return <GjallarhornGlyph size={size} className={className} />;
  return <WordmarkHorizontal size={size} className={className} />;
}

export function PoweredByHeimdall({ className }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] text-slate-400 ${className ?? ''}`}
      title="Powered by HEIMDALL Scheduling"
    >
      <GjallarhornGlyph size={14} />
      <span className="font-medium tracking-wide">Powered by HEIMDALL</span>
    </span>
  );
}
