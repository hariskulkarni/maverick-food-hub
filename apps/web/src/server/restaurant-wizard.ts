/**
 * Pure helpers used by the super-admin restaurant creation wizard.
 *
 * Keeping them out of the route handler means the unit tests can import the
 * logic without dragging in `prisma`, `next-auth`, etc. — and the wizard's
 * slug-validation / password-generation behaviour is the part most likely to
 * regress, so it's worth testing pure.
 */
import { slugifyName } from './brands';

/**
 * Slugs that must never be allowed as a Restaurant slug — they will eventually
 * be claimed by subdomain routing (see docs/SUBDOMAIN-TENANCY.md). Keeping the
 * list central lets the wizard, the Restaurant update form, and any future
 * tenancy guard share the same rule.
 */
export const RESERVED_RESTAURANT_SLUGS = new Set<string>([
  'www', 'admin', 'platform', 'kitchen', 'rider', 'api'
]);

/** Returns the normalised slug, or null if invalid / reserved. */
export function normaliseRestaurantSlug(raw: string | null | undefined, fallbackName?: string): string | null {
  const base = (raw && raw.trim()) || (fallbackName ? slugifyName(fallbackName) : '');
  const slug = slugifyName(base);
  if (!slug || slug.length < 2) return null;
  if (RESERVED_RESTAURANT_SLUGS.has(slug)) return null;
  return slug;
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_RESTAURANT_SLUGS.has(slugifyName(slug));
}

/**
 * Generate a temporary password for new ADMIN/KITCHEN accounts created via the
 * wizard. 12 chars from an unambiguous mixed-case alphanumeric set (no 0/O, no
 * 1/l/I) so the super-admin can read it out over chat without confusion.
 *
 * Crypto-grade entropy via `globalThis.crypto.getRandomValues` — works in both
 * Node 19+ (server) and any modern bundle target.
 */
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
export function generateTempPassword(length = 12): string {
  if (length < 8) length = 8;
  const out: string[] = [];
  const cryptoObj: Crypto | undefined = (globalThis as any).crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const buf = new Uint32Array(length);
    cryptoObj.getRandomValues(buf);
    for (let i = 0; i < length; i++) {
      out.push(PASSWORD_ALPHABET[buf[i]! % PASSWORD_ALPHABET.length]!);
    }
  } else {
    // Fallback — never used in prod but keeps tests deterministic-friendly.
    for (let i = 0; i < length; i++) {
      out.push(PASSWORD_ALPHABET[Math.floor(Math.random() * PASSWORD_ALPHABET.length)]!);
    }
  }
  return out.join('');
}

/** Validate (lat, lng) are inside the legal coordinate space. */
export function isValidLatLng(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}
