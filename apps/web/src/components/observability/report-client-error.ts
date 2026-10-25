/**
 * Browser-side error beacon → POST /api/telemetry/client-error.
 * Throttled per page load (≤ 10 reports, identical messages once) and uses
 * navigator.sendBeacon so it survives page unloads. Never throws.
 */
const MAX_PER_PAGE = 10;
let sent = 0;
const seen = new Set<string>();

export function reportClientError(
  err: unknown,
  opts: { type?: 'error' | 'unhandledrejection' | 'boundary'; componentStack?: string | null } = {},
): void {
  try {
    if (typeof window === 'undefined' || sent >= MAX_PER_PAGE) return;
    const e = err as { message?: string; stack?: string; digest?: string } | null;
    const message = String(e?.message ?? (typeof err === 'string' ? err : 'Unknown error')).slice(0, 2000);
    const key = `${opts.type ?? 'error'}|${message}`;
    if (!message || seen.has(key)) return;
    seen.add(key);
    sent += 1;
    const body = JSON.stringify({
      message,
      stack: e?.stack ? String(e.stack).slice(0, 8000) : null,
      componentStack: opts.componentStack ? opts.componentStack.slice(0, 4000) : null,
      source: 'web',
      type: opts.type ?? 'error',
      // Path only — never the query string (it can carry tokens).
      url: window.location.pathname,
    });
    const url = '/api/telemetry/client-error';
    const blob = new Blob([body], { type: 'application/json' });
    if (!(navigator.sendBeacon && navigator.sendBeacon(url, blob))) {
      void fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
    }
  } catch {
    /* never throw from the reporter */
  }
}
