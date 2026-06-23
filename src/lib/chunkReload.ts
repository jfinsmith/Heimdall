/**
 * Self-recovery for failed dynamic-import (route code-split) loads. These fail
 * when a chunk can't be fetched — almost always a STALE chunk after a new deploy
 * (an old tab references a hash that no longer exists) or a transient NETWORK
 * blip. Instead of dumping the user on the error screen, reload once to pull the
 * current build. Guarded so a persistent failure (e.g. still offline) can't loop.
 */
export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(msg);
}

const RELOAD_KEY = 'hd_chunk_reload_at';

export function reloadForChunkError(): void {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || '0');
    // Only auto-reload once per 20s window so a still-failing chunk (e.g. the
    // connection is still down) doesn't trap the user in a reload loop.
    if (Date.now() - last < 20000) return;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    /* sessionStorage unavailable (private mode quota) — fall through and reload */
  }
  window.location.reload();
}
