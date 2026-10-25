'use client';
/**
 * Shared React error-boundary UI for the app shells (Next `error.tsx`). Reports
 * the error to the observability beacon once, then offers a retry.
 */
import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { reportClientError } from './report-client-error';

export function RouteError({ error, reset, area }: { error: Error & { digest?: string }; reset: () => void; area: string }) {
  useEffect(() => {
    reportClientError(error, { type: 'boundary', componentStack: `area: ${area}${error.digest ? ` · digest ${error.digest}` : ''}` });
  }, [error, area]);
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="max-w-md text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-warning" />
        <h2 className="mt-3 text-lg font-semibold">Something went wrong</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This page hit an unexpected error. It has been reported to the platform team. Try again — it is usually temporary.
        </p>
        {error.digest ? <p className="mt-2 font-mono text-xs text-muted-foreground">Reference: {error.digest}</p> : null}
        <button
          onClick={reset}
          className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <RefreshCw className="h-4 w-4" /> Try again
        </button>
      </div>
    </div>
  );
}
