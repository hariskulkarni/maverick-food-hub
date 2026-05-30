/**
 * Store: the narrow surface every higher-level helper (wrap, tags, locks,
 * idempotency, rate-limit) calls into. Two implementations:
 *
 *   - MemoryStore — Map-backed, single-process. Used when REDIS_URL is empty.
 *   - RedisStore  — ioredis-backed. Used in production.
 *
 * Methods are intentionally Redis-flavoured (SETNX, INCR) because (a) Redis
 * primitives compose nicely into the higher-level helpers, and (b) the
 * MemoryStore can fake them with one Map + a tiny bit of bookkeeping while
 * keeping the contract identical. If we ever swap to a different KV (e.g.
 * Cloudflare KV, Memcached), this is the only file that changes.
 *
 * ALL keys passed to the Store are ALREADY-PREFIXED. The cache module's
 * higher layers prepend the namespace; the Store stays dumb.
 */

import type Redis from 'ioredis';
import type { Cluster } from 'ioredis';

export interface SetOptions {
  /** Time-to-live in milliseconds. Omit = persist until evicted/deleted. */
  ttlMs?: number;
  /** Only set if the key does NOT already exist (Redis SET ... NX). */
  ifAbsent?: boolean;
}

export interface Store {
  get(key: string): Promise<string | null>;
  /**
   * Returns true if the value was written. `ifAbsent` returning false is the
   * caller's signal that someone else won the race.
   */
  set(key: string, value: string, opts?: SetOptions): Promise<boolean>;
  /** Delete one or more keys. Returns the count deleted (best-effort). */
  del(keys: string | string[]): Promise<number>;
  /** Atomically increment a counter and optionally set its TTL (only on first write). */
  incr(key: string, ttlMs?: number): Promise<number>;
  /** Add `member` to a set, returns the new cardinality of the set. */
  sAdd(key: string, members: string | string[]): Promise<number>;
  /** Return all members of a set. */
  sMembers(key: string): Promise<string[]>;
  /** Remove `member` from a set. */
  sRem(key: string, members: string | string[]): Promise<number>;
  /** Set the TTL on an existing key. No-op if the key is absent. */
  expire(key: string, ttlMs: number): Promise<boolean>;
  /**
   * Compare-and-delete: delete `key` only if its current value === `expected`.
   * Powers the lock helper's release path so a process that already lost its
   * lock can't accidentally release someone else's.
   */
  delIfEqual(key: string, expected: string): Promise<boolean>;
  /** Best-effort scan + return matching keys. Used by the diag panel only. */
  scan(matchPrefix: string, limit: number): Promise<string[]>;
}

/* ─── MemoryStore ─────────────────────────────────────────────────────────── */

interface MemEntry {
  /** Stored value, or a Set instance for sAdd. */
  value: string | Set<string>;
  expiresAt: number | null;
}

export class MemoryStore implements Store {
  private map = new Map<string, MemEntry>();
  private lastSweep = 0;

  private gcSweep(now: number) {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [k, v] of this.map) {
      if (v.expiresAt !== null && v.expiresAt <= now) this.map.delete(k);
    }
  }

  private alive(entry: MemEntry, now: number): boolean {
    return entry.expiresAt === null || entry.expiresAt > now;
  }

  async get(key: string): Promise<string | null> {
    const now = Date.now();
    this.gcSweep(now);
    const e = this.map.get(key);
    if (!e || !this.alive(e, now)) return null;
    return typeof e.value === 'string' ? e.value : null;
  }

  async set(key: string, value: string, opts: SetOptions = {}): Promise<boolean> {
    const now = Date.now();
    const existing = this.map.get(key);
    if (opts.ifAbsent && existing && this.alive(existing, now)) return false;
    this.map.set(key, {
      value,
      expiresAt: opts.ttlMs ? now + opts.ttlMs : null,
    });
    return true;
  }

  async del(keys: string | string[]): Promise<number> {
    const arr = Array.isArray(keys) ? keys : [keys];
    let n = 0;
    for (const k of arr) if (this.map.delete(k)) n++;
    return n;
  }

  async incr(key: string, ttlMs?: number): Promise<number> {
    const now = Date.now();
    const e = this.map.get(key);
    if (e && this.alive(e, now) && typeof e.value === 'string') {
      const next = (Number(e.value) || 0) + 1;
      e.value = String(next);
      return next;
    }
    this.map.set(key, {
      value: '1',
      expiresAt: ttlMs ? now + ttlMs : null,
    });
    return 1;
  }

  async sAdd(key: string, members: string | string[]): Promise<number> {
    const arr = Array.isArray(members) ? members : [members];
    const now = Date.now();
    const e = this.map.get(key);
    let set: Set<string>;
    if (e && this.alive(e, now) && e.value instanceof Set) {
      set = e.value;
    } else {
      set = new Set();
      this.map.set(key, { value: set, expiresAt: null });
    }
    for (const m of arr) set.add(m);
    return set.size;
  }

  async sMembers(key: string): Promise<string[]> {
    const e = this.map.get(key);
    if (!e || !(e.value instanceof Set) || !this.alive(e, Date.now())) return [];
    return Array.from(e.value);
  }

  async sRem(key: string, members: string | string[]): Promise<number> {
    const e = this.map.get(key);
    if (!e || !(e.value instanceof Set)) return 0;
    const arr = Array.isArray(members) ? members : [members];
    let n = 0;
    for (const m of arr) if (e.value.delete(m)) n++;
    return n;
  }

  async expire(key: string, ttlMs: number): Promise<boolean> {
    const e = this.map.get(key);
    if (!e) return false;
    e.expiresAt = Date.now() + ttlMs;
    return true;
  }

  async delIfEqual(key: string, expected: string): Promise<boolean> {
    const e = this.map.get(key);
    if (!e || typeof e.value !== 'string' || e.value !== expected) return false;
    this.map.delete(key);
    return true;
  }

  async scan(matchPrefix: string, limit: number): Promise<string[]> {
    const out: string[] = [];
    for (const k of this.map.keys()) {
      if (k.startsWith(matchPrefix)) {
        out.push(k);
        if (out.length >= limit) break;
      }
    }
    return out;
  }
}

/* ─── RedisStore ──────────────────────────────────────────────────────────── */

/**
 * Lua script for compare-and-delete. Pulled out so it can be EVAL'd directly;
 * inlined as a string because ioredis's `defineCommand` registration would
 * fire before the connection is ready and we'd lose the convenience.
 */
const CAD_LUA = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end
`;

export class RedisStore implements Store {
  constructor(private client: Redis | Cluster, private prefix: string) {}

  /**
   * All Redis ops are wrapped in this: on failure, log and return a neutral
   * value (null / 0 / false). Cache MUST NOT crash a request — the worst it
   * should do is degrade to "miss" and let the request fall through to
   * Postgres. This is the difference between a cache that's an asset and one
   * that's a liability.
   */
  private async safe<T>(op: () => Promise<T>, fallback: T, label: string): Promise<T> {
    try {
      return await op();
    } catch (err) {
      // Local require to avoid a circular import — `log` itself never depends
      // on the cache module.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { log } = require('../log');
      log.warn({ err: (err as Error).message, label }, '[cache] redis op degraded');
      return fallback;
    }
  }

  async get(key: string): Promise<string | null> {
    return this.safe(() => this.client.get(key), null, 'get');
  }

  async set(key: string, value: string, opts: SetOptions = {}): Promise<boolean> {
    return this.safe(
      async () => {
        const args: (string | number)[] = [key, value];
        if (opts.ttlMs && opts.ttlMs > 0) args.push('PX', opts.ttlMs);
        if (opts.ifAbsent) args.push('NX');
        // ioredis's `set` accepts a variadic positional list; the result is
        // 'OK' on a successful write or null when NX rejected.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = await (this.client.set as any)(...args);
        return r === 'OK';
      },
      false,
      'set',
    );
  }

  async del(keys: string | string[]): Promise<number> {
    const arr = Array.isArray(keys) ? keys : [keys];
    if (arr.length === 0) return 0;
    return this.safe(() => this.client.del(...arr), 0, 'del');
  }

  async incr(key: string, ttlMs?: number): Promise<number> {
    return this.safe(
      async () => {
        // INCR + EXPIRE in a single pipeline so the window TTL is set
        // atomically on the FIRST hit only. We always call expire — Redis
        // refreshes the TTL each call, which is what the rate-limit fixed-
        // window semantics actually want.
        if (ttlMs && ttlMs > 0) {
          const pipeline = this.client.multi();
          pipeline.incr(key);
          pipeline.pexpire(key, ttlMs);
          const res = await pipeline.exec();
          const incrResult = res?.[0];
          if (incrResult && incrResult[0] === null) return Number(incrResult[1]) || 1;
          return 1;
        }
        return Number(await this.client.incr(key));
      },
      1,
      'incr',
    );
  }

  async sAdd(key: string, members: string | string[]): Promise<number> {
    const arr = Array.isArray(members) ? members : [members];
    return this.safe(() => this.client.sadd(key, ...arr), 0, 'sadd');
  }

  async sMembers(key: string): Promise<string[]> {
    return this.safe(() => this.client.smembers(key), [], 'smembers');
  }

  async sRem(key: string, members: string | string[]): Promise<number> {
    const arr = Array.isArray(members) ? members : [members];
    return this.safe(() => this.client.srem(key, ...arr), 0, 'srem');
  }

  async expire(key: string, ttlMs: number): Promise<boolean> {
    return this.safe(
      async () => (await this.client.pexpire(key, ttlMs)) === 1,
      false,
      'expire',
    );
  }

  async delIfEqual(key: string, expected: string): Promise<boolean> {
    return this.safe(
      async () => {
        const r = await this.client.eval(CAD_LUA, 1, key, expected);
        return Number(r) === 1;
      },
      false,
      'cad',
    );
  }

  async scan(matchPrefix: string, limit: number): Promise<string[]> {
    return this.safe(
      async () => {
        const out: string[] = [];
        let cursor = '0';
        // Cap iterations so a runaway scan can't stall a diag request.
        for (let iter = 0; iter < 20 && out.length < limit; iter++) {
          const [next, batch] = await this.client.scan(cursor, 'MATCH', matchPrefix + '*', 'COUNT', 200);
          out.push(...batch);
          cursor = next;
          if (cursor === '0') break;
        }
        return out.slice(0, limit);
      },
      [],
      'scan',
    );
  }
}
