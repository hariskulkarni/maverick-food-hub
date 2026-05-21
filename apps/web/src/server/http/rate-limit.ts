/**
 * Lightweight, production-ready rate limiting for API routes.
 *
 * Storage is behind a small interface so a single-instance deploy uses the
 * in-memory fixed-window store (zero dependencies, good enough for one Node
 * process behind pm2), and a multi-instance deploy can drop in a Redis-backed
 * store later WITHOUT touching any call site:
 *
 *   - `RateLimitStore` — the swap point. Implement `hit()` against Redis
 *     (INCR + EXPIRE, or a sliding-window script) and set the store via
 *     `setRateLimitStore()` at boot.
 *   - In-memory is the default. It is per-process: counters reset on restart and
 *     are NOT shared across instances. For the current single-pm2-process
 *     deployment that's fine; revisit when scaling horizontally.
 *
 * Usage in a route handler:
 *
 *   const rl = await rateLimit(req, { name: 'otp-send', limit: 5, windowMs: 60_000 });
 *   if (!rl.ok) return rl.response;   // 429 with Retry-After
 */

export interface RateLimitStore {
  /**
   * Register one hit for `key` within a `windowMs` window and return the running
   * count in the current window. Implementations must expire keys after the window.
   */
  hit(key: string, windowMs: number): Promise<number>;
}

/** Per-process fixed-window store. Resets on restart; not shared across instances. */
class MemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  async hit(key: string, windowMs: number): Promise<number> {
    const now = Date.now();
    // Opportunistic GC so the map can't grow unbounded under key churn.
    if (now - this.lastSweep > 60_000) {
      for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
      this.lastSweep = now;
    }
    const b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return 1;
    }
    b.count += 1;
    return b.count;
  }
}

let store: RateLimitStore = new MemoryRateLimitStore();

/** Swap the backing store (e.g. a Redis implementation) at boot. */
export function setRateLimitStore(s: RateLimitStore): void {
  store = s;
}

/**
 * Best-effort client IP from proxy headers. Behind nginx/Cloudflare the real IP
 * is in x-forwarded-for (first hop). Falls back to a constant so a missing
 * header degrades to a coarse global limit rather than no limit.
 */
export function clientIp(req: Request): string {
  const h = req.headers;
  const fwd = h.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return h.get('x-real-ip')?.trim() || 'unknown';
}

export interface RateLimitOptions {
  /** Logical bucket name (keeps different endpoints' counters separate). */
  name: string;
  /** Max requests allowed per window. */
  limit: number;
  /** Window length in ms. */
  windowMs: number;
  /** Extra key part (e.g. a phone number) to scope the limit beyond IP. */
  key?: string;
}

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; response: Response; retryAfterSec: number };

/**
 * Apply a rate limit for `req`. Keyed by `name` + client IP (+ optional `key`).
 * Returns `{ ok: true }` to proceed, or `{ ok: false, response }` — a ready 429
 * with a `Retry-After` header — when the limit is exceeded.
 */
export async function rateLimit(req: Request, opts: RateLimitOptions): Promise<RateLimitResult> {
  const ip = clientIp(req);
  const bucketKey = `${opts.name}:${ip}${opts.key ? ':' + opts.key : ''}`;
  const count = await store.hit(bucketKey, opts.windowMs);
  if (count > opts.limit) {
    const retryAfterSec = Math.ceil(opts.windowMs / 1000);
    return {
      ok: false,
      retryAfterSec,
      response: Response.json(
        { error: 'Too many requests. Please slow down and try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(retryAfterSec) } }
      ),
    };
  }
  return { ok: true, remaining: Math.max(0, opts.limit - count) };
}
