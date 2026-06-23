import React from 'react';
import ReactDOM from 'react-dom/client';
import { Providers } from './app/providers';
import { AppRouter } from './app/router';
import { reloadForChunkError } from './lib/chunkReload';
import './index.css';

// Vite fires this when a dynamically-imported chunk fails to load (stale chunk
// after a deploy, or a flaky connection). Recover by reloading the current build.
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  reloadForChunkError();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Providers>
      <AppRouter />
    </Providers>
  </React.StrictMode>
);
