import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * HEIMDALL — Vite config.
 *
 * We deploy to GitHub Pages with HashRouter, so `base: './'` keeps all asset
 * URLs relative and the app works at https://<user>.github.io/<repo>/ without
 * knowing the repo name at build time. (Tradeoff documented in README §Hosting.)
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
