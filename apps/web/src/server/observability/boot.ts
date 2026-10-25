/**
 * Observability boot — called once per Node process from instrumentation.ts.
 * Installs the HTTP recorder, the event-loop monitor and the periodic flush of
 * per-minute aggregates. Everything is best-effort; nothing here can stop boot.
 */
import { installHttpRecorder } from './http-recorder';
import { startEventLoopMonitor } from './process-stats';
import { flushAggregates } from './aggregator';
import { recordError } from './store';
import { routeTemplate } from './routes';

declare global {
  // eslint-disable-next-line no-var
  var __obsFlushTimer: ReturnType<typeof setInterval> | undefined;
}

const FLUSH_MS = 30_000;

export function startObservability(): void {
  if (process.env.OBS_DISABLED === '1') return;
  try {
    installHttpRecorder();
  } catch {
    /* ignore */
  }
  try {
    startEventLoopMonitor();
  } catch {
    /* ignore */
  }
  if (!global.__obsFlushTimer) {
    global.__obsFlushTimer = setInterval(() => void flushAggregates(), FLUSH_MS);
    global.__obsFlushTimer.unref?.();
    const final = () => void flushAggregates();
    process.once('beforeExit', final);
    process.once('SIGTERM', final);
  }
}

/** Next.js `onRequestError` → the error store (route-aware, redacted). */
export async function captureRequestError(
  err: unknown,
  request: { path?: string; method?: string },
  context: { routePath?: string; routeType?: string; renderSource?: string },
): Promise<void> {
  const e = err as { message?: string; stack?: string; digest?: string } | null;
  const path = request?.path?.split('?')[0] ?? null;
  const route = context?.routePath ? context.routePath.replace(/\/(page|route)$/, '') || '/' : path ? routeTemplate(path) : null;
  await recordError({
    level: 'ERROR',
    kind: 'SERVER',
    source: `${context?.routeType ?? 'request'} ${route ?? path ?? ''}`.trim(),
    message: e?.message ?? String(err),
    stack: e?.stack ?? null,
    digest: e?.digest ?? null,
    method: request?.method ?? null,
    path,
    route,
    statusCode: 500,
  });
}
