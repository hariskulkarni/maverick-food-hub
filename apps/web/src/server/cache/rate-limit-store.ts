/**
 * Adapter that lets the existing rate-limit code (server/http/rate-limit.ts)
 * use our Redis-backed Store. Tiny, no logic of its own — just shape glue.
 *
 * Why a thin adapter and not "use the cache module directly in rate-limit.ts":
 *   The rate-limit module was designed BEFORE the cache module existed, with
 *   its own zero-dep interface (`RateLimitStore`). We want to preserve that
 *   independence — the rate-limit module shouldn't import the whole cache
 *   surface (and risk circular imports with logging / metrics). So we expose
 *   ONE shape-matching adapter here and the boot code wires it in.
 */

import type { RateLimitStore } from '../http/rate-limit';
import { getRuntime } from './client';
import { keys } from './keys';

/**
 * Build a RateLimitStore that increments a fixed-window counter in Redis.
 * Failures fall back to "1" (let the request through) — a cache outage
 * MUST NOT lock every customer out of placing orders.
 */
export function buildRedisRateLimitStore(): RateLimitStore {
  return {
    async hit(key: string, windowMs: number): Promise<number> {
      const { store } = getRuntime();
      // Bucket key is whatever the rate-limit layer hands us; we prefix with
      // our namespace via keys.rateLimit so it lives under the same
      // versioned tree as everything else.
      const fullKey = keys.rateLimit('hit', key);
      return store.incr(fullKey, windowMs);
    },
  };
}
