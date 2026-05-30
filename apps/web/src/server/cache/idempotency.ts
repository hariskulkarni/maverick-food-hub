/**
 * Idempotency keys — run an effect at most once.
 *
 * Pattern: external systems retry. A payment-gateway webhook may arrive
 * twice. A scheduled job ticking on two boxes may try to settle the same
 * week twice. We protect against this by namespacing each effect under a
 * caller-supplied key and storing the result of the FIRST execution.
 *
 *   const r = await idempotent('webhook', evt.id, '24h', () => process(evt));
 *
 * Mechanics:
 *
 *   • IF the key is unset → set a sentinel ("running"), execute fn, write
 *     the JSON result, return it.
 *
 *   • IF the key already holds a result → return it without executing fn.
 *
 *   • IF the key holds the "running" sentinel → wait a bit, retry. The
 *     sentinel has a short TTL so a crashed first runner doesn't park
 *     subsequent retries forever.
 *
 * Only JSON-serialisable returns are supported. The key + scope are arbitrary
 * strings; convention is `scope = 'webhook' | 'settlement' | ...` and `key =
 * the inbound identifier you trust to be unique`.
 */

import { getRuntime } from './client';
import { keys } from './keys';
import { sleep } from './util';

const RUNNING_SENTINEL = '__running__';
const RUNNING_TTL_MS = 30_000; // first runner has 30s to write the result before retries kick in

interface ResultEnvelope<T> {
  ok: boolean;
  v: T | null;
  err?: string;
  at: number;
}

export async function idempotent<T>(
  scope: string,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const fullKey = keys.idempotency(scope, key);
  const { store } = getRuntime();

  // Stage 1: try to claim the slot.
  const claimed = await store.set(fullKey, RUNNING_SENTINEL, {
    ttlMs: RUNNING_TTL_MS,
    ifAbsent: true,
  });
  if (claimed) {
    return executeAndStore(fullKey, ttlMs, fn);
  }

  // Stage 2: someone else owns it. Poll for their result.
  return waitForResult(fullKey, fn, ttlMs);
}

async function executeAndStore<T>(
  fullKey: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const { store } = getRuntime();
  try {
    const v = await fn();
    const env: ResultEnvelope<T> = { ok: true, v, at: Date.now() };
    await store.set(fullKey, JSON.stringify(env), { ttlMs });
    return v;
  } catch (err) {
    // Record the failure so subsequent retries see "we already tried, it
    // failed" instead of re-running a broken effect. TTL is shorter than the
    // success TTL — failures get re-attempted sooner than successes get
    // re-executed (which is "never" within the success TTL).
    const env: ResultEnvelope<T> = {
      ok: false,
      v: null,
      err: err instanceof Error ? err.message : String(err),
      at: Date.now(),
    };
    await store.set(fullKey, JSON.stringify(env), { ttlMs: Math.min(ttlMs, 60_000) });
    throw err;
  }
}

async function waitForResult<T>(
  fullKey: string,
  fn: () => Promise<T>,
  ttlMs: number,
): Promise<T> {
  const { store } = getRuntime();
  const start = Date.now();
  // Poll up to RUNNING_TTL_MS — after that we assume the first runner died
  // and become the new runner.
  while (Date.now() - start < RUNNING_TTL_MS) {
    await sleep(100);
    const raw = await store.get(fullKey);
    if (raw === null || raw === RUNNING_SENTINEL) continue;
    try {
      const env = JSON.parse(raw) as ResultEnvelope<T>;
      if (env.ok) return env.v as T;
      throw new Error(env.err ?? 'idempotent fn failed');
    } catch (err) {
      // Corrupt JSON — fall through to a fresh attempt.
      break;
    }
  }
  // First runner timed out; take over.
  await store.del(fullKey);
  return executeAndStore(fullKey, ttlMs, fn);
}
