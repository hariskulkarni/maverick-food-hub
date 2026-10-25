'use client';
/**
 * Root error boundary (replaces the root layout when it crashes). Reports to the
 * observability beacon and offers a reload.
 */
import { useEffect } from 'react';
import { reportClientError } from '@/components/observability/report-client-error';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError(error, { type: 'boundary', componentStack: `area: root${error.digest ? ` · digest ${error.digest}` : ''}` });
  }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', margin: 0, padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h2 style={{ fontSize: 18, fontWeight: 600 }}>Something went wrong</h2>
          <p style={{ fontSize: 14, color: '#666' }}>The app hit an unexpected error. It has been reported. Please try again.</p>
          {error.digest ? <p style={{ fontSize: 12, color: '#888', fontFamily: 'monospace' }}>Reference: {error.digest}</p> : null}
          <button onClick={reset} style={{ marginTop: 12, height: 40, padding: '0 16px', borderRadius: 6, border: 0, background: '#111', color: '#fff', cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
