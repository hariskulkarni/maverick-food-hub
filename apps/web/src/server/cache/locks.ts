/**
 * Distributed locks.
 *
 * `withLock(name, opts, fn)` runs `fn` while holding a mutually-exclusive
 * lock named `name`. Useful for:
 *
 *   • Settlement runs (only one process should sweep payouts for a given week)
 *   • Webhook retries (de-dupe at-least-once delivery)
 *   • Cron-like sweepers that go off in every pm2 worker (which we don't have
 *     today, but the door is now open to a multi-worker cluster)
 *
 * Implementation: SET NX PX. The lock's value is a random fingerprint unique
 * to this acquisition; release uses compare-and-delete so a process that
 * already lost its lock (TTL expired, someone else acquired it) cannot
 * accidentally release the new holder's lock — the classic Redlock pitfall.
 *
 * Acquisition strategy: bounded retry with jittered backoff. If the lock is
 * busy for the whole `waitMs` budget, we throw `LockTimeoutError`. The caller
 * decides whether that's a hard fail (settlement) or "skip this tick"
 * (sweeper).
 */

import { randomBytes } from 'node:crypto';
import { getRuntime } from './client';
import { keys } from './keys';

export class LockTimeoutError extends Error {
  constructor(public name: string, public waitedMs: number) {
    super(`Lock '${name}' busy after ${waitedMs}ms`);
  }
}

export interface LockOptions {
  /** Max wall time the lock may be held. The cluster releases it after this even if the holder crashes. */
  ttlMs: number;
  /** How long to wait for an in-use lock before giving up. 0 = single try. Default: 0. */
  waitMs?: number;
  /** Lower bound on the per-retry backoff (default 25 ms). */
  minBackoffMs?: number;
  /** Upper bound on the per-retry backoff (default 200 ms). */
  maxBackoffMs?: number;
}

/**
 * Acquire `name`, run `fn`, release. Always releases — even if `fn` throws.
 * Returns whatever `fn` returns.
 */
export async function withLock<T>(name: string, opts: LockOptions, fn: () => Promise<T>): Promise<T> {
  const key = keys.lock(name);
  const fingerprint = randomBytes(16).toString('hex');
  const { store } = getRuntime();

  const deadline = Date.now() + (opts.waitMs ?? 0);
  let attempt = 0;
  while (true) {
    const got = await store.set(key, fingerprint, { ttlMs: opts.ttlMs, ifAbsent: true });
    if (got) break;
    if (Date.now() >= deadline) {
      throw new LockTimeoutError(name, opts.waitMs ?? 0);
    }
    attempt++;
    await sleepJittered(opts.minBackoffMs ?? 25, opts.maxBackoffMs ?? 200, attempt);
  }

  try {
    return await fn();
  } finally {
    // Release only if we still own the lock. If the TTL expired mid-function
    // and someone else acquired it, do NOT delete their token.
    await store.delIfEqual(key, fingerprint).catch(() => {
      /* swallow — losing the release is bounded by TTL */
    });
  }
}

/** Sleep with bounded exponential backoff + uniform jitter. */
function sleepJittered(minMs: number, maxMs: number, attempt: number): Promise<void> {
  const expo = Math.min(maxMs, minMs * Math.pow(2, Math.max(0, attempt - 1)));
  const jitter = Math.random() * expo;
  return new Promise((resolve) => setTimeout(resolve, jitter));
}
