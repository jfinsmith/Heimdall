/**
 * App-level error boundary — catches render-time crashes so a single broken page
 * shows a recoverable message instead of a blank white screen. (Async Firestore
 * errors don't throw during render; those are surfaced via the hooks' `error`.)
 */
import React from 'react';
import { Button } from './ui';
import { isChunkLoadError, reloadForChunkError } from '../lib/chunkReload';

interface Props {
  children: React.ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // A failed route-chunk load (stale chunk after deploy, or a network blip) —
    // self-heal by reloading the current build instead of showing the error.
    if (isChunkLoadError(error)) {
      reloadForChunkError();
      return;
    }
    console.error('Render error caught by ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.error) {
      // Chunk-load failure: a reload is already in flight — show a calm interim
      // message rather than the alarming error screen.
      if (isChunkLoadError(this.state.error)) {
        return (
          <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
            <h1 className="text-lg font-semibold text-watch-900">Updating to the latest version…</h1>
            <p className="max-w-md text-sm text-slate-500">One moment — reloading the app.</p>
          </div>
        );
      }
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
          <h1 className="text-lg font-semibold text-watch-900">Something went wrong</h1>
          <p className="max-w-md text-sm text-slate-500">
            An unexpected error stopped this page from rendering. Reloading usually clears it; if it keeps
            happening, let an administrator know.
          </p>
          <Button variant="primary" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
