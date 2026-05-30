/**
 * Cache health probe. Plugged into the global /api/system/health route AND
 * the dedicated /api/admin/diag/cache panel.
 *
 * "Healthy" criteria:
 *   • backend === 'redis'  → we can PING in <250ms and get PONG.
 *   • backend === 'memory' → always healthy (in-process, can't fail).
 *
 * We measure latency at probe time (not just on connect) so a slow Redis is
 * surfaced even if it's still reachable.
 */

import { getRuntime } from './client';

export interface CacheHealth {
  backend: 'redis' | 'memory';
  status: 'OK' | 'DEGRADED' | 'DOWN';
  latencyMs: number | null;
  prefix: string;
  /** Free-form message for diag UI — never logged anywhere sensitive. */
  detail?: string;
}

const SLOW_THRESHOLD_MS = 250;

export async function checkCacheHealth(): Promise<CacheHealth> {
  const runtime = getRuntime();
  if (runtime.backend === 'memory') {
    return {
      backend: 'memory',
      status: 'OK',
      latencyMs: 0,
      prefix: runtime.prefix,
      detail: 'In-process memory store (REDIS_URL not set).',
    };
  }

  // Redis backend. PING through the Store path so we exercise the same
  // error-degradation surface that real callers hit.
  const sentinelKey = runtime.prefix + 'health:ping';
  const startedAt = Date.now();
  try {
    const ok = await runtime.store.set(sentinelKey, '1', { ttlMs: 10_000 });
    const latencyMs = Date.now() - startedAt;
    if (!ok) {
      return {
        backend: 'redis',
        status: 'DEGRADED',
        latencyMs,
        prefix: runtime.prefix,
        detail: 'Redis write was rejected without throwing — check NX semantics.',
      };
    }
    return {
      backend: 'redis',
      status: latencyMs > SLOW_THRESHOLD_MS ? 'DEGRADED' : 'OK',
      latencyMs,
      prefix: runtime.prefix,
      detail: latencyMs > SLOW_THRESHOLD_MS ? `Slow (>${SLOW_THRESHOLD_MS}ms)` : undefined,
    };
  } catch (err) {
    return {
      backend: 'redis',
      status: 'DOWN',
      latencyMs: null,
      prefix: runtime.prefix,
      detail: (err as Error).message,
    };
  }
}
