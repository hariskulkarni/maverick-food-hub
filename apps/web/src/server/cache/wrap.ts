/**
 * `wrap` — the read-through caching primitive.
 *
 * Pattern: "compute this expensive thing, cache the result, hand me the same
 * thing next time without recomputing". Three thing other naive wrappers get
 * wrong, and we get right:
 *
 *   1. SINGLE-FLIGHT. If 50 requests miss the cache simultaneously (cold key,
 *      app boot, deploy), the naive wrapper runs 50 DB queries in parallel —
 *      the "thundering herd". We deduplicate by an in-process Promise map: 50
 *      concurrent calls for the same key share a single underlying compute,
 *      and all 50 resolve with one DB hit.
 *
 *   2. NEGATIVE CACHING. If the computer returns `null` we cache that too,
 *      with a SHORTER TTL. Without this, every miss on "does this slug
 *      exist?" hammers Postgres forever. The short TTL bounds the window
 *      where a just-created row stays invisible.
 *
 *   3. STALE-WHILE-REVALIDATE. Optional. When `stale` is set, after a hit we
 *      may still trigger a background refresh if the cached entry has crossed
 *      the staleness threshold. The current request returns the stale value
 *      instantly; the next request sees fresh data. This kills tail latency
 *      on hot reads without ever showing the user a slow page.
 *
 * Tags: every wrap call can declare one or more tags. The tag → key index is
 * maintained transparently so a single `invalidateTag('restaurant:abc123')`
 * call wipes every cache entry that named that tag — including ones written
 * by a different code path.
 */

import { getRuntime } from './client';
import { metrics } from './metrics';
import { addKeyToTags } from './tags';
import { log } from '../log';

export interface WrapOptions {
  /** TTL on a successful (non-null) result, in milliseconds. */
  ttlMs: number;
  /**
   * TTL for a null/undefined result. Defaults to min(ttlMs, 30s). Set to 0
   * to skip negative caching entirely (rarely what you want).
   */
  nullTtlMs?: number;
  /**
   * Stale-while-revalidate window, in milliseconds. After this many ms the
   * cached value is still returned but a background refresh fires. The entry
   * keeps the same TTL until the refresh writes a newer one.
   *
   *   ttlMs = 5min, stale = 30s   → 30s of "fresh", 4.5min of "stale, refresh
   *                                  in background", then expire.
   */
  staleMs?: number;
  /**
   * Invalidation tags. Anyone calling `invalidateTag(tag)` will wipe this key.
   */
  tags?: string[];
  /** Optional namespace to group logs/metrics by — purely cosmetic. */
  label?: string;
}

interface Envelope<T> {
  v: T | null;
  /** Wall-clock ms at the time this entry was written. */
  at: number;
}

const inflight = new Map<string, Promise<unknown>>();

/**
 * `wrap(key, opts, compute)` returns the cached value if present (refreshing
 * in the background if stale), otherwise calls `compute()`, caches the result,
 * and returns it.
 *
 * The `compute` callback runs UNDER A LOCK in this process: concurrent callers
 * with the same key share its result without re-running it.
 */
export async function wrap<T>(
  keyParts: string[] | string,
  opts: WrapOptions,
  compute: () => Promise<T | null>,
): Promise<T | null> {
  const key = Array.isArray(keyParts) ? keyParts.join(':') : keyParts;
  const { store } = getRuntime();

  // 1) Read.
  const raw = await store.get(key);
  if (raw !== null) {
    const parsed = parseEnvelope<T>(raw);
    if (parsed) {
      metrics.hit();
      const age = Date.now() - parsed.at;
      // Stale-while-revalidate: serve fresh-looking, refresh quietly.
      if (opts.staleMs && age > opts.staleMs) {
        scheduleRefresh(key, opts, compute, parsed.v);
      }
      return parsed.v;
    }
    // Corrupt JSON — treat as a miss, delete defensively.
    await store.del(key).catch(() => {});
  }
  metrics.miss();

  // 2) Compute under single-flight.
  return runOnceShared(key, opts, compute);
}

/**
 * In-process dedupe. The first caller to miss owns the compute; everyone else
 * receives the same Promise. We DON'T use Redis SETNX for this — it would add
 * a round-trip to the hot miss path. The wrap-level dedupe is the cheap one;
 * the lock helper (locks.ts) is for cross-process exclusion when you actually
 * need it (settlement runs, etc.).
 */
function runOnceShared<T>(
  key: string,
  opts: WrapOptions,
  compute: () => Promise<T | null>,
): Promise<T | null> {
  const existing = inflight.get(key) as Promise<T | null> | undefined;
  if (existing) return existing;

  const p = (async () => {
    const startedAt = Date.now();
    let value: T | null = null;
    try {
      value = await compute();
    } catch (err) {
      // The compute fn threw. Don't cache a failure — let the next call retry.
      log.warn({ err: (err as Error).message, key, label: opts.label }, '[cache] compute threw');
      throw err;
    } finally {
      const elapsed = Date.now() - startedAt;
      metrics.computed(elapsed);
    }
    await writeEnvelope(key, value, opts);
    return value;
  })();

  inflight.set(key, p);
  // Whether the promise resolves or rejects, drop it from inflight so the
  // next caller can retry on failure.
  p.finally(() => inflight.delete(key));
  return p;
}

function scheduleRefresh<T>(
  key: string,
  opts: WrapOptions,
  compute: () => Promise<T | null>,
  prev: T | null,
): void {
  // Run after the current microtask so we DON'T add latency to the hit path.
  // setImmediate would also work; queueMicrotask is fine because compute is
  // async — it yields to the event loop on its first await.
  queueMicrotask(() => {
    runOnceShared(key, opts, compute).catch(() => {
      // Swallow — the stale value was already returned. Log lightly so a
      // permanent compute failure doesn't disappear.
      log.warn({ key, label: opts.label, prevWasNull: prev === null }, '[cache] background refresh failed');
    });
  });
}

async function writeEnvelope<T>(key: string, value: T | null, opts: WrapOptions): Promise<void> {
  const envelope: Envelope<T> = { v: value, at: Date.now() };
  const ttl = value === null
    ? Math.min(opts.nullTtlMs ?? Math.min(opts.ttlMs, 30_000), opts.ttlMs)
    : opts.ttlMs;
  const { store } = getRuntime();
  const ok = await store.set(key, JSON.stringify(envelope), { ttlMs: ttl });
  if (ok) metrics.set();
  if (opts.tags && opts.tags.length > 0) {
    // Register this key under each tag so invalidateTag can find it later.
    // The tag set's TTL is set to ttl + a slack window — if the cache entry
    // expires before invalidation, the tag set quietly cleans itself up.
    await addKeyToTags(key, opts.tags, ttl + 60_000);
  }
}

function parseEnvelope<T>(raw: string): Envelope<T> | null {
  try {
    const parsed = JSON.parse(raw) as Envelope<T>;
    if (typeof parsed !== 'object' || parsed === null) return null;
    if (typeof parsed.at !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}
