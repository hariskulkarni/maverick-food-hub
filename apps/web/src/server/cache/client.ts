/**
 * Redis client + transparent in-memory fallback.
 *
 * The rest of the cache module talks to a tiny `Store` interface (see store.ts).
 * This file picks the implementation at boot:
 *
 *   • REDIS_URL is set       → ioredis-backed store. Tries to ping; if the ping
 *                              fails repeatedly we DON'T blow up the request
 *                              path — calls degrade to "miss" so the app keeps
 *                              serving from Postgres. Production stays available
 *                              through transient Redis blips.
 *
 *   • REDIS_URL is empty     → in-memory store. Identical surface, per-process.
 *                              Used for local dev so a contributor doesn't have
 *                              to install Redis to boot the app, and as the
 *                              break-glass fallback above.
 *
 * One process holds two Redis connections: a "main" client for GET/SET/INCR
 * (commands you do dozens of times per request) and a dedicated "sub" client
 * for pub/sub. ioredis blocks the connection it's subscribed on, so the two
 * MUST be separate — sharing them silently breaks every other command.
 *
 * The Store interface is intentionally narrow: get / set / del / incr / expire
 * / sIsMember-ish via a small set of opinionated helpers. We don't expose a
 * raw Redis handle from this module; doing so encourages "just one direct
 * Redis call here" and the abstraction rots. If you need a primitive we don't
 * expose, add it to the interface here.
 */

import { EventEmitter } from 'node:events';
import type Redis from 'ioredis';
import type { Cluster } from 'ioredis';

import { Store, MemoryStore, RedisStore } from './store';
import { log } from '../log';

declare global {
  // eslint-disable-next-line no-var
  var __cacheRuntime: CacheRuntime | undefined;
}

/** Stable describes-what-runs handle; everything else imports `getRuntime()`. */
export interface CacheRuntime {
  /** Whichever Store is wired up — Redis or Memory. Always non-null. */
  store: Store;
  /** Tagged "redis" | "memory" so health + boot logs can label themselves. */
  backend: 'redis' | 'memory';
  /** Versioned key prefix; everything written via the cache module is namespaced. */
  prefix: string;
  /** Subscribe-side Redis client. null on the memory backend. */
  sub: Redis | Cluster | null;
  /** Publish-side Redis client. null on the memory backend. */
  pub: Redis | Cluster | null;
  /** Last successful PING latency, in ms. -1 if never measured. */
  pingMs: number;
  /** Event emitter for connection state changes — health probes hook into this. */
  events: EventEmitter;
  /** Best-effort, never throws. Closes both clients. */
  close: () => Promise<void>;
}

/** Build (or return) the singleton. Safe to call from anywhere. */
export function getRuntime(): CacheRuntime {
  if (global.__cacheRuntime) return global.__cacheRuntime;
  global.__cacheRuntime = boot();
  return global.__cacheRuntime;
}

/**
 * Build the runtime. Called exactly once per process (via getRuntime's lazy
 * init OR `instrumentation.ts` at boot — whichever runs first wins, and the
 * other becomes a no-op thanks to the global cache).
 */
function boot(): CacheRuntime {
  const url = (process.env.REDIS_URL ?? '').trim();
  const prefix = (process.env.REDIS_KEY_PREFIX ?? 'flavrly:v1:').trim();
  const events = new EventEmitter();
  events.setMaxListeners(0);

  if (!url) {
    // Local dev / fallback path. Keep the boot log unambiguous so a missing
    // Redis is obvious in pm2 logs (the difference between "Redis is down"
    // and "we never tried" matters at 2 AM).
    log.info({ backend: 'memory', prefix }, '[cache] memory store (no REDIS_URL configured)');
    return {
      store: new MemoryStore(),
      backend: 'memory',
      prefix,
      sub: null,
      pub: null,
      pingMs: -1,
      events,
      async close() {
        /* memory store has nothing to close */
      },
    };
  }

  // Defer `require` so a build that doesn't run Node code (e.g. static prerender
  // of a CSS-only page) never pulls ioredis in. The dependency lives in
  // package.json regardless.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const IORedis: typeof Redis = require('ioredis');

  const client: Redis = new IORedis(url, {
    // Lazy connect so the process can boot even if Redis is briefly down. The
    // first command triggers the connection; we PING up-front below to make
    // the boot log honest about what actually happened.
    lazyConnect: true,
    // Sane retry: backoff up to 2s. Don't loop forever in CI — give up after
    // ~10 retries and let the runtime fall back gracefully (see RedisStore).
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy(times) {
      if (times > 20) return null;
      return Math.min(50 * Math.pow(2, times), 2000);
    },
  });

  // Pub/sub clients block their connection while subscribed, so they get their
  // own duplicate connection. This is the ioredis-recommended pattern.
  const sub: Redis = client.duplicate({ lazyConnect: true });
  const pub: Redis = client.duplicate({ lazyConnect: true });

  // Operational logging. We deliberately log connection lifecycle events at
  // info level — they're rare and crucial when debugging a degraded prod.
  client.on('connect', () => log.info({ backend: 'redis' }, '[cache] redis connecting'));
  client.on('ready', () => {
    const started = Date.now();
    client.ping().then(
      () => {
        const ms = Date.now() - started;
        runtime.pingMs = ms;
        events.emit('ready', ms);
        log.info({ backend: 'redis', prefix, latencyMs: ms }, '[cache] redis ready');
      },
      (err) => log.warn({ err: (err as Error).message }, '[cache] redis ping failed at ready'),
    );
  });
  client.on('error', (err) => {
    // Don't crash. ioredis emits these for every reconnect attempt — log
    // sparingly to avoid filling pm2 logs.
    events.emit('error', err);
    log.warn({ err: err.message }, '[cache] redis error');
  });
  client.on('close', () => events.emit('close'));
  client.on('end', () => events.emit('end'));

  // Wake all three connections eagerly (in the background) so the first user
  // request doesn't pay the TCP handshake cost. Failures here are logged but
  // never thrown — the in-band retry strategy will pick up later.
  Promise.allSettled([client.connect(), sub.connect(), pub.connect()]).then((results) => {
    for (const r of results) {
      if (r.status === 'rejected') {
        log.warn({ err: (r.reason as Error).message }, '[cache] eager redis connect failed (will retry)');
      }
    }
  });

  const runtime: CacheRuntime = {
    store: new RedisStore(client, prefix),
    backend: 'redis',
    prefix,
    sub,
    pub,
    pingMs: -1,
    events,
    async close() {
      // Quit politely if connected; otherwise force-disconnect. Either way,
      // never throw from close() — it's called from shutdown hooks where a
      // raised error would mask the real shutdown reason.
      await Promise.allSettled([
        client.quit().catch(() => client.disconnect()),
        sub.quit().catch(() => sub.disconnect()),
        pub.quit().catch(() => pub.disconnect()),
      ]);
    },
  };
  return runtime;
}
