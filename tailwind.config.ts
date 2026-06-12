import type { Config } from 'tailwindcss';

/**
 * HEIMDALL design tokens.
 *
 * Palette: "the night watch" — deep navy/slate base with a single restrained
 * Bifröst-amber accent for primary actions and the HEIMDALL mark.
 * Status colors map to staffing state across the whole app:
 *   green = fully staffed, amber = understaffed, red = critical, gray = draft.
 *
 * These are also mirrored in `settings/global` (brandPrimaryColor /
 * brandAccentColor) so an admin can tune them without a code change; the shell
 * applies the Firestore values as CSS custom properties at runtime.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Night-watch navy/slate base
        watch: {
          50: '#f4f6fb',
          100: '#e8ecf6',
          200: '#c9d3e8',
          300: '#a3b3d4',
          400: '#6f86b5',
          500: '#4a6296',
          600: '#374b78',
          700: '#2b3a5e',
          800: '#1f2a45',
          900: '#16203a',
          950: '#0d1426'
        },
        // Bifröst amber — the one accent. Used sparingly: primary actions, the mark.
        bifrost: {
          50: '#fdf8ec',
          100: '#faedcb',
          200: '#f4da93',
          300: '#edc35b',
          400: '#e7ad33',
          500: '#d99320',
          600: '#bc7318',
          700: '#965417',
          800: '#7b4319',
          900: '#683819',
          950: '#3c1d0a'
        },
        // Staffing status tokens
        status: {
          staffed: '#15803d',   // green-700 — fully staffed
          open: '#b45309',      // amber-700 — understaffed / open
          critical: '#b91c1c',  // red-700 — critical / inside alert window
          draft: '#64748b'      // slate-500 — draft
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        // Wordmark-only display face: slightly condensed, characterful, still readable.
        display: ['"Archivo Narrow"', 'Inter', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
} satisfies Config;
