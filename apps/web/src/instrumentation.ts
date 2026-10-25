/**
 * Next.js instrumentation hook — Observability Center boot.
 *
 * NOTE: this app uses the `src/` layout, so Next only loads
 * `src/instrumentation.ts`; the older `apps/web/instrumentation.ts` at the
 * project root is never executed (its Redis cache / rate-limit / pub-sub boot is
 * dormant — reported to the owner, left untouched here on purpose).
 *
 * The `if (process.env.NEXT_RUNTIME === 'nodejs') { await import(...) }` shape is
 * load-bearing: webpack constant-folds the condition and drops the Node-only
 * import from the Edge bundle. An early `return` does NOT get that treatment.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { startObservability } = await import('./server/observability/boot');
      startObservability();
    } catch {
      /* observability must never stop the app */
    }
  }
}

/**
 * Every uncaught exception in a route handler, server component or server
 * action lands in the observability error store (route-aware, redacted, deduped).
 */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routerKind: string; routePath: string; routeType: string; renderSource?: string },
) {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { captureRequestError } = await import('./server/observability/boot');
      await captureRequestError(err, request, context);
    } catch {
      /* never throw from the error hook */
    }
  }
}
