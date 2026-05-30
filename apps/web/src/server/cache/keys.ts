/**
 * Cache key construction.
 *
 * Every key written through the cache module flows through ONE of these
 * builders. We don't ad-hoc keys at callsites because:
 *
 *   • A typo in a key bypasses the cache silently (you write to `restaur:abc`,
 *     read from `restaurant:abc`, nothing crashes — you just miss forever).
 *   • Tag-based invalidation needs every key to live under a known prefix
 *     so we can find them.
 *   • A versioned namespace ("flavrly:v1:") makes mass-invalidation safe: when
 *     a schema change makes cached payloads incompatible, bump REDIS_KEY_PREFIX
 *     and every old entry becomes invisible without a FLUSHDB.
 *
 * The prefix is loaded once at boot via getRuntime().prefix. We don't put it
 * in this file because changing the env var shouldn't require a code change.
 */

import { getRuntime } from './client';

/** Join key parts with ":" and apply the versioned namespace. */
export function k(...parts: (string | number)[]): string {
  return getRuntime().prefix + parts.join(':');
}

/**
 * Canonical key builders — the ONLY public way to construct a key. Keep this
 * file short; if a new caller needs a key shape, ADD A BUILDER here so the
 * full taxonomy stays in one place.
 *
 * Layout convention: `<domain>:<lookup>:<id-or-natural-key>`. Sub-keys (e.g.
 * a tag set's members) carry a small suffix like ":members".
 */
export const keys = {
  // Read-through caches
  restaurantBySlug: (slug: string) => k('restaurant', 'bySlug', slug),
  restaurantById: (id: string) => k('restaurant', 'byId', id),
  branchById: (id: string) => k('branch', 'byId', id),
  storefrontConfig: (restaurantId: string) => k('storefront', 'config', restaurantId),
  discoveryConfig: () => k('discovery', 'config'),
  platformSecurity: () => k('platform', 'security'),
  integrationConfig: (restaurantId: string, provider: string) =>
    k('integration', 'config', restaurantId, provider),
  /** User → restaurant memberships (tenancy.accessibleSet). */
  accessibleSet: (userId: string) => k('tenancy', 'accessible', userId),

  // Locks (auto-released via TTL)
  lock: (name: string) => k('lock', name),

  // Idempotency (write-once results)
  idempotency: (scope: string, key: string) => k('idem', scope, key),

  // Tag indices: a SET of cache keys grouped by an invalidation tag.
  tagMembers: (tag: string) => k('tag', tag, 'members'),

  // Rate limit (fixed-window). One key per logical bucket × identity.
  rateLimit: (bucket: string, identity: string) => k('rl', bucket, identity),

  // Pub/sub channels. Channels are NOT prefixed by `getRuntime().prefix` here
  // (they aren't keys), but we still namespace them so a future tenant on the
  // same Redis can coexist.
  pubsubChannel: (channel: string) => k('ps', channel),
};
