/**
 * Tag-based invalidation.
 *
 * Mental model: when a caller `wrap`s a value, they declare zero or more
 * tags. Tags are independent of the keys themselves — they group keys by what
 * they're ABOUT, not where they live.
 *
 *   wrap(['restaurant:bySlug', slug], { tags: [`restaurant:${id}`] }, ...)
 *   wrap(['storefront:config', id],   { tags: [`restaurant:${id}`] }, ...)
 *
 * Now `invalidateTag(`restaurant:${id}`)` wipes both, even though the keys
 * live in different code paths.
 *
 * Implementation: each tag is a Redis Set whose members are the keys that
 * named it. `addKeyToTags` adds membership at write time. `invalidateTag`
 * loads the set, deletes every key in it, and removes the set itself.
 *
 * This costs O(1) sAdd per write and O(N) deletes per invalidation, which is
 * the right trade-off for our access pattern (writes are cheap, invalidations
 * are rare but should be thorough).
 */

import { getRuntime } from './client';
import { keys } from './keys';
import { metrics } from './metrics';

/**
 * Register `key` as a member of each tag's index. The tag set's own TTL is
 * stamped to `tagTtlMs` so an abandoned tag (no further writes, no
 * invalidations) eventually disappears without manual cleanup.
 */
export async function addKeyToTags(key: string, tags: string[], tagTtlMs: number): Promise<void> {
  if (tags.length === 0) return;
  const { store } = getRuntime();
  await Promise.all(
    tags.map(async (tag) => {
      const setKey = keys.tagMembers(tag);
      await store.sAdd(setKey, key);
      await store.expire(setKey, tagTtlMs);
    }),
  );
}

/**
 * Wipe every cache entry registered under `tag`. Idempotent (safe to call
 * even if no keys are tagged). Returns the number of keys deleted.
 */
export async function invalidateTag(tag: string): Promise<number> {
  const { store } = getRuntime();
  const setKey = keys.tagMembers(tag);
  const members = await store.sMembers(setKey);
  if (members.length === 0) {
    // Tag is empty — still drop the (possibly stale) set itself.
    await store.del(setKey);
    return 0;
  }
  const deleted = await store.del(members);
  await store.del(setKey);
  metrics.del(deleted);
  return deleted;
}

/** Invalidate multiple tags in one go. */
export async function invalidateTags(tags: string[]): Promise<number> {
  if (tags.length === 0) return 0;
  const counts = await Promise.all(tags.map((t) => invalidateTag(t)));
  return counts.reduce((a, b) => a + b, 0);
}
