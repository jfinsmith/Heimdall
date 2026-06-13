/**
 * HEIMDALL brand mark — the engraved horn-and-clock insignia supplied by the
 * agency (public/brand/*.png, optimized from the source PNGs in the repo
 * root). The artwork has its own metallic coloring, so unlike the earlier SVG
 * mark it does not inherit currentColor — it reads well on both the navy
 * shell and white surfaces.
 *
 * Exports:
 *   <GjallarhornGlyph />     — the horn mark alone (topbar, bell, favicon-ish use)
 *   <WordmarkHorizontal />   — mark + HEIMDALL/SCHEDULING text (sidebar, email)
 *   <WordmarkStacked />      — the full engraved lockup (login, print headers)
 */
import React from 'react';

const MARK_SRC = `${import.meta.env.BASE_URL}brand/heimdall-mark.png`;
const FULL_SRC = `${import.meta.env.BASE_URL}brand/heimdall-full.png`;

/** Mark aspect ratio (480×344 source). */
const MARK_RATIO = 480 / 344;
/** Full lockup aspect ratio (1200×655 source). */
const FULL_RATIO = 1200 / 655;

export interface LogoProps {
  /** Pixel height of the rendered logo. Defaults to 32. */
  size?: number;
  className?: string;
  title?: string;
  /** Show the SCHEDULING sub-line in the horizontal lockup. Defaults to true. */
  subtitle?: boolean;
}

export function GjallarhornGlyph({ size = 32, className, title = 'HEIMDALL — Gjallarhorn' }: LogoProps) {
  return (
    <img
      src={MARK_SRC}
      width={Math.round(size * MARK_RATIO)}
      height={size}
      alt={title}
      className={className}
      style={{ display: 'inline-block', objectFit: 'contain' }}
    />
  );
}

/** Mark + HEIMDALL (with SCHEDULING sub-line) — sidebar/topbar lockup. */
export function WordmarkHorizontal({ size = 28, className, subtitle = true }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ''}`}>
      <GjallarhornGlyph size={size} />
      <span className="flex flex-col leading-none select-none">
        <span className="font-display font-bold tracking-[0.22em]" style={{ fontSize: size * 0.56 }}>
          HEIMDALL
        </span>
        {subtitle && (
          <span className="mt-1 font-sans font-medium tracking-[0.34em] opacity-60" style={{ fontSize: size * 0.26 }}>
            SCHEDULING
          </span>
        )}
      </span>
    </span>
  );
}

/** The full engraved lockup (mark + runic HEIMDALL SCHEDULING) — login and print. */
export function WordmarkStacked({ size = 120, className, title = 'HEIMDALL Scheduling' }: LogoProps) {
  return (
    <img
      src={FULL_SRC}
      width={Math.round(size * FULL_RATIO)}
      height={size}
      alt={title}
      className={className}
      style={{ display: 'inline-block', objectFit: 'contain' }}
    />
  );
}

export default GjallarhornGlyph;
