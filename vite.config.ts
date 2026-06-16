import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * HEIMDALL — Vite config.
 *
 * Served from the domain root on Firebase Hosting with BrowserRouter, so assets
 * must use absolute paths (`base: '/'`). A relative base would resolve assets
 * against the current deep-link path (e.g. /cadre/academies/x) and 404.
 */
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
