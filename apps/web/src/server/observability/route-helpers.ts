/**
 * Small helpers shared by the observability API routes.
 */
import { timingSafeEqual } from 'node:crypto';

const cache = new Map<string, { at: number; value: unknown }>();

/**
 * Short TTL memo for dashboard reads, so several open tabs auto-refreshing
 * don't multiply DB load. Keyed by tab + range (+ filters).
 */
export async function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Constant-time check of the cron secret header. */
export function cronSecretMatches(header: string | null): boolean {
  const secret = process.env.INTERNAL_CRON_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export const NO_STORE = { 'Cache-Control': 'no-store' } as const;
