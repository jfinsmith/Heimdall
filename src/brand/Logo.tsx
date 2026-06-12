/**
 * HEIMDALL brand mark — the Gjallarhorn.
 *
 * A stylized curved Norse horn, drawn as a single currentColor glyph so it
 * inherits theme color and works in monochrome (sidebar, print, email mono
 * fallback). Three restrained band lines suggest the horn's binding rings —
 * the only ornament, and it survives 32px.
 *
 * Exports:
 *   <GjallarhornGlyph />     — the horn alone (square viewBox, icon use)
 *   <WordmarkHorizontal />   — horn + HEIMDALL side by side (topbar, email header)
 *   <WordmarkStacked />      — horn above HEIMDALL (login screen, print header)
 */
import React from 'react';

export interface LogoProps {
  /** Pixel size of the glyph (height). Defaults to 32. */
  size?: number;
  className?: string;
  title?: string;
}

/**
 * The horn path: a bold crescent sweeping up-right from a narrow mouthpiece to
 * a wide flared bell, with a small sound-wave arc at the bell to read as
 * "alert" at a glance. Built from filled shapes (not strokes) so it scales
 * crisply and stays legible at favicon size.
 */
export function GjallarhornGlyph({ size = 32, className, title = 'Gjallarhorn — HEIMDALL' }: LogoProps) {
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
      {/* Horn body: crescent from mouthpiece (lower-left) to bell (upper-right) */}
      <path
        d="M9 50
           C 7 47 7.5 43.5 10 41.5
           L 13.5 44.5
           C 17 36 24 27.5 33 21.5
           C 39.5 17.2 46.5 14.2 52.5 13
           L 50 8.5
           C 50 8.5 56.5 9.5 59 13.5
           C 61.5 17.5 60 24 60 24
           L 55.5 19.5
           C 50.5 21 44.5 23.8 39 27.5
           C 30.5 33.2 24 41 21 48.5
           L 24.5 51.5
           C 22.5 54 19 54.5 16 53
           Z"
        fill="currentColor"
      />
      {/* Horn band rings — restrained Norse binding detail */}
      <path d="M28.2 25.2 L 33.4 31.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" opacity="0.45" />
      <path d="M40.5 17.8 L 44.5 24" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" opacity="0.45" />
      {/* Sound arcs at the bell — the horn is sounding */}
      <path d="M57 30 a 12 12 0 0 0 4 -9" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" fill="none" opacity="0.85" />
    </svg>
  );
}

/** Horn + HEIMDALL wordmark, horizontal lockup. Inherits currentColor. */
export function WordmarkHorizontal({ size = 28, className }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <GjallarhornGlyph size={size} />
      <span
        className="font-display font-bold tracking-[0.18em] leading-none select-none"
        style={{ fontSize: size * 0.62 }}
      >
        HEIMDALL
      </span>
    </span>
  );
}

/** Horn above HEIMDALL, stacked lockup — login screen and print headers. */
export function WordmarkStacked({ size = 56, className }: LogoProps) {
  return (
    <span className={`inline-flex flex-col items-center gap-2 ${className ?? ''}`}>
      <GjallarhornGlyph size={size} />
      <span
        className="font-display font-bold tracking-[0.28em] leading-none select-none"
        style={{ fontSize: size * 0.4 }}
      >
        HEIMDALL
      </span>
    </span>
  );
}

export default GjallarhornGlyph;
