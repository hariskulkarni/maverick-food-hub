/**
 * Public cache API.
 *
 * Everything outside this folder imports from here, not from individual
 * files. That keeps the surface stable: if we ever migrate from ioredis to
 * something else, only files INSIDE the folder change.
 *
 *   import { cache, withLock, idempotent, pub, sub, keys, invalidateTag } from '@/server/cache';
 *
 * The `cache` namespace bundles the most-used helpers — pick whichever style
 * the callsite prefers.
 */

export { keys } from './keys';
export { wrap } from './wrap';
export { withLock, LockTimeoutError, type LockOptions } from './locks';
export { idempotent } from './idempotency';
export { publishMessage as pub, subscribeMessage as sub } from './pubsub';
export { invalidateTag, invalidateTags } from './tags';
export { checkCacheHealth, type CacheHealth } from './health';
export { metrics as cacheMetrics } from './metrics';
export { getRuntime as getCacheRuntime } from './client';
export { buildRedisRateLimitStore } from './rate-limit-store';
export { parseTtl } from './util';

// A grouped namespace import for places that prefer `cache.wrap(...)` over
// `wrap(...)`. Both work; this is purely ergonomic.
import { wrap as _wrap } from './wrap';
import { withLock as _withLock } from './locks';
import { idempotent as _idempotent } from './idempotency';
import { invalidateTag as _invalidateTag, invalidateTags as _invalidateTags } from './tags';
import { publishMessage as _pub, subscribeMessage as _sub } from './pubsub';
import { keys as _keys } from './keys';
import { getRuntime as _getRuntime } from './client';

export const cache = {
  wrap: _wrap,
  withLock: _withLock,
  idempotent: _idempotent,
  invalidateTag: _invalidateTag,
  invalidateTags: _invalidateTags,
  pub: _pub,
  sub: _sub,
  keys: _keys,
  /** Direct store access — escape hatch. Use sparingly. */
  store: () => _getRuntime().store,
};
