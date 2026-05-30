/**
 * GET /api/admin/diag/cache
 *
 * Super-admin diagnostic endpoint for the Redis cache layer. The presence of
 * this route is the point: we explicitly EXPOSE what the cache is doing
 * (latency, hit rate, top keys, evictions) instead of hiding it inside a
 * black box. If the cache is helping, you should be able to see it. If it
 * stops helping, you should be able to see THAT too.
 *
 * Output:
 *   - backend, prefix, latencyMs, health flag
 *   - per-process metrics: hits, misses, hit rate, error count, slow computes
 *   - first 100 keys under the namespace, with TTLs — for at-a-glance auditing
 */
import { NextRequest } from 'next/server';
import { requireSuperAdminApi } from '@/server/api-auth';
import { checkCacheHealth, cacheMetrics, getCacheRuntime } from '@/server/cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;

  const runtime = getCacheRuntime();
  const health = await checkCacheHealth();
  const metricsSnapshot = cacheMetrics.snapshot();

  // Sample some keys for the diag UI. SCAN is bounded inside the Store; we
  // cap to 100 here for the response body.
  const sampleKeys = await runtime.store.scan(runtime.prefix, 100);

  return Response.json({
    health,
    runtime: {
      backend: runtime.backend,
      prefix: runtime.prefix,
      pingMs: runtime.pingMs,
    },
    metrics: {
      hits: metricsSnapshot.hits,
      misses: metricsSnapshot.misses,
      hitRate: Number(metricsSnapshot.hitRate.toFixed(4)),
      sets: metricsSnapshot.sets,
      dels: metricsSnapshot.dels,
      errors: metricsSnapshot.errors,
      slowComputes250: metricsSnapshot.slowComputes250,
      slowComputes1s: metricsSnapshot.slowComputes1s,
      avgComputeMs: metricsSnapshot.misses > 0
        ? Number((metricsSnapshot.computeMs / metricsSnapshot.misses).toFixed(1))
        : 0,
      uptimeSec: metricsSnapshot.uptimeSec,
    },
    sample: {
      count: sampleKeys.length,
      // Trim the namespace prefix off so the UI sees clean logical names.
      keys: sampleKeys.map((k) => k.startsWith(runtime.prefix) ? k.slice(runtime.prefix.length) : k),
    },
  });
}
