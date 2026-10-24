import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time check of a request-supplied secret against the expected value
 * (T-17). False when either is missing or empty. Only the length can leak.
 */
export function secretMatches(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
