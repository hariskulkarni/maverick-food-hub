/**
 * Next.js instrumentation hooks.
 *
 *  register()        — runs once when the server process boots. We start the
 *                      observability probe runner here (Node runtime only).
 *  onRequestError()  — Next.js calls this for EVERY server-side error (RSC,
 *                      route handlers, SSR). It's the low-touch way to capture
 *                      all server errors — including the same `digest` shown on
 *                      the error page — without wrapping 250+ route handlers.
 *
 * Both are defensive: telemetry must never interfere with serving requests.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { startObservabilityRunner } = await import('./server/observability/runner');
    startObservabilityRunner();
  } catch {
    /* never block boot on telemetry */
  }
}

// Signature per Next 15: (error, request, context)
export async function onRequestError(
  err: unknown,
  request: { path?: string; method?: string; headers?: Record<string, string> },
  context: { routePath?: string; routerKind?: string; routeType?: string }
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { recordError } = await import('./server/observability/store');
    const e = err as { message?: string; stack?: string; digest?: string };
    // "where": prefer the matched route path; fall back to the request path.
    const source =
      (context?.routePath ? `${context.routeType ?? 'route'} ${context.routePath}` : null) ??
      request?.path ??
      'server';
    await recordError({
      level: 'ERROR',
      source,
      message: e?.message || String(err),
      digest: e?.digest ?? null,
      stack: e?.stack ?? null,
      method: request?.method ?? null,
      path: request?.path ?? null,
    });
  } catch {
    /* telemetry must never throw */
  }
}
