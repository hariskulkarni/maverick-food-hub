'use client';
/**
 * Last-resort error boundary — it replaces the ROOT layout, so it renders when
 * the layout itself crashed.
 *
 * Deliberately styled with inline CSS and no component imports. Anything this
 * page depends on is something that can take the page down with it, and a
 * broken error page means a blank white screen with no way out. Brand colours
 * are hardcoded here for the same reason: no Tailwind, no design tokens, no
 * font loading. The one import is the observability beacon, which is already
 * guarded internally.
 */
import { useEffect } from 'react';
import { reportClientError } from '@/components/observability/report-client-error';

const CORAL = '#f23e5c';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError(error, {
      type: 'boundary',
      componentStack: `area: root${error.digest ? ` · digest ${error.digest}` : ''}`,
    });
  }, [error]);

  return (
    <html lang="en">
      <head>
        <title>Something went wrong · Flavrly</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
      </head>
      <body
        style={{
          margin: 0,
          padding: 24,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily:
            '"Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          background: `radial-gradient(60% 50% at 20% 10%, rgba(242,62,92,0.10), transparent 60%), #fffdfb`,
          color: '#1c1917',
        }}
      >
        <div style={{ maxWidth: 440, textAlign: 'center' }}>
          <div
            aria-hidden
            style={{
              width: 48,
              height: 48,
              margin: '0 auto 20px',
              borderRadius: 14,
              background: 'rgba(242,62,92,0.14)',
              color: CORAL,
              display: 'grid',
              placeItems: 'center',
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            !
          </div>

          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: '-0.01em' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#57534e', marginTop: 10 }}>
            Flavrly hit an unexpected error and this page couldn&apos;t load. It has been reported to
            the team automatically. Your order and account details are unaffected.
          </p>

          {error.digest ? (
            <p style={{ fontSize: 12, color: '#78716c', fontFamily: 'ui-monospace, monospace', marginTop: 14 }}>
              Reference: {error.digest}
            </p>
          ) : null}

          <div style={{ marginTop: 22, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={reset}
              style={{
                height: 40,
                padding: '0 18px',
                borderRadius: 8,
                border: 0,
                background: CORAL,
                color: '#fff',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                height: 40,
                padding: '0 18px',
                borderRadius: 8,
                border: '1px solid rgba(0,0,0,0.12)',
                color: '#1c1917',
                fontSize: 14,
                fontWeight: 600,
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              Go home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
