/**
 * HEIMDALL brand mark — Gjallarhorn + clock.
 *
 * A clock face set in a knotwork ring (the watch), cradled by a flared
 * drinking horn (the alert) — echoing the engraved horn-and-clock insignia
 * the brand is based on. Single currentColor glyph: works in monochrome,
 * inherits theme color, verified legible at 32px.
 *
 * Exports:
 *   <GjallarhornGlyph />     — the mark alone (square viewBox, icon use)
 *   <WordmarkHorizontal />   — mark + HEIMDALL/SCHEDULING (topbar, email)
 *   <WordmarkStacked />      — mark above HEIMDALL/SCHEDULING (login, print)
 */
import React from 'react';

export interface LogoProps {
  /** Pixel size of the glyph (height). Defaults to 32. */
  size?: number;
  className?: string;
  title?: string;
  /** Show the SCHEDULING sub-line in lockups. Defaults to true. */
  subtitle?: boolean;
}

export function GjallarhornGlyph({ size = 32, className, title = 'HEIMDALL — Gjallarhorn' }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      className={className}
    >
      <title>{title}</title>
      {/* Horn: tapered crescent cradling the clock — flared bell upper-right
          with a scooped mouth, tip narrowing at the left */}
      <path
        d="M 56.8 20.6 C 61 22, 63.3 26.5, 62 30.8 C 56.5 44.5, 44.5 54.8, 31 55.6
           C 19.5 56.4, 10 50, 6.5 39.5 C 5.6 36, 6.1 32.6, 7.8 29.8 L 10.6 31.8
           C 9.9 33.5, 10 35.3, 10.8 37.3 C 13.8 44.6, 21 49.3, 30.5 48.8
           C 41 48, 50.2 40.6, 54.2 30.2 C 54.9 28.2, 55 26.3, 54.6 24.6
           C 53.8 23.2, 54.6 21.6, 56.8 20.6 Z"
        fill="currentColor"
      />
      {/* Horn band near the bell */}
      <path d="M 54.2 33.6 L 60.8 30.8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity="0.5" />
      {/* Knotwork ring (rope-segment suggestion — survives 32px) */}
      <circle cx="32" cy="22" r="15" stroke="currentColor" strokeWidth="2" strokeDasharray="2.8 2.2" opacity="0.45" />
      {/* Clock face */}
      <circle cx="32" cy="22" r="11.5" stroke="currentColor" strokeWidth="2.5" />
      <path d="M 32 22 L 27.4 19.3" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
      <path d="M 32 22 L 38.4 18.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="32" cy="22" r="1.7" fill="currentColor" />
    </svg>
  );
}

/** Mark + HEIMDALL (with SCHEDULING sub-line), horizontal lockup. */
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

/** Mark above HEIMDALL / SCHEDULING, stacked lockup — login and print. */
export function WordmarkStacked({ size = 56, className, subtitle = true }: LogoProps) {
  return (
    <span className={`inline-flex flex-col items-center gap-2.5 ${className ?? ''}`}>
      <GjallarhornGlyph size={size} />
      <span className="flex flex-col items-center gap-1.5 leading-none select-none">
        <span className="font-display font-bold tracking-[0.3em]" style={{ fontSize: size * 0.36, marginLeft: size * 0.3 * 0.36 }}>
          HEIMDALL
        </span>
        {subtitle && (
          <span className="font-sans font-medium tracking-[0.42em] opacity-60" style={{ fontSize: size * 0.16, marginLeft: size * 0.42 * 0.16 }}>
            SCHEDULING
          </span>
        )}
      </span>
    </span>
  );
}

export default GjallarhornGlyph;
