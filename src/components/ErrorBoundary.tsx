/**
 * App-level error boundary — catches render-time crashes so a single broken page
 * shows a recoverable message instead of a blank white screen. (Async Firestore
 * errors don't throw during render; those are surfaced via the hooks' `error`.)
 */
import React from 'react';
import { Button } from './ui';

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
    console.error('Render error caught by ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.error) {
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
