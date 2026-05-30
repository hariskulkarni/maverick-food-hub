/**
 * Cache metrics — per-process counters, exposed for the diag endpoint.
 *
 * Why not Prometheus / OpenTelemetry: this project doesn't ship those yet and
 * pulling them in for one module would be heavyweight. Counters live in a
 * module-level object; the diag endpoint reads them. When/if observability
 * tooling lands, swap this for proper instruments without touching callers.
 *
 * Counters reset on process restart. That's intentional — they describe THIS
 * process's behaviour, which is what you want when diagnosing pm2-rm-web hot
 * paths or comparing two deploys.
 */

declare global {
  // eslint-disable-next-line no-var
  var __cacheMetrics: Metrics | undefined;
}

interface Metrics {
  hits: number;
  misses: number;
  sets: number;
  dels: number;
  errors: number;
  /** Cumulative latency, in ms, for `wrap` callbacks that we had to recompute. */
  computeMs: number;
  /** Histogram-lite: count of compute calls slower than 250 ms / 1 s. */
  slowComputes250: number;
  slowComputes1s: number;
  startedAt: number;
}

function ensure(): Metrics {
  if (!global.__cacheMetrics) {
    global.__cacheMetrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      dels: 0,
      errors: 0,
      computeMs: 0,
      slowComputes250: 0,
      slowComputes1s: 0,
      startedAt: Date.now(),
    };
  }
  return global.__cacheMetrics;
}

export const metrics = {
  hit(): void {
    ensure().hits++;
  },
  miss(): void {
    ensure().misses++;
  },
  set(): void {
    ensure().sets++;
  },
  del(n = 1): void {
    ensure().dels += n;
  },
  error(): void {
    ensure().errors++;
  },
  computed(ms: number): void {
    const m = ensure();
    m.computeMs += ms;
    if (ms >= 1000) m.slowComputes1s++;
    else if (ms >= 250) m.slowComputes250++;
  },
  snapshot(): Metrics & { hitRate: number; uptimeSec: number } {
    const m = ensure();
    const total = m.hits + m.misses;
    return {
      ...m,
      hitRate: total === 0 ? 0 : m.hits / total,
      uptimeSec: Math.floor((Date.now() - m.startedAt) / 1000),
    };
  },
};
