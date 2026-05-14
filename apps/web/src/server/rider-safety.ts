/**
 * Shared helpers for the rider Safety & SOS feature bundle.
 *
 * Kept dependency-free (Node's crypto only) so the route handlers stay thin and
 * the token-generation logic has a single home.
 */
import crypto from 'node:crypto';

/** URL-safe alphabet — no look-alike characters (0/O, 1/l/I) to keep links readable. */
const TOKEN_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/**
 * Generate a URL-safe random token (~10 chars) for a shareable live-trip link.
 * Uses crypto-strong randomness so tokens aren't guessable.
 */
export function genShareToken(length = 10): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  }
  return out;
}

/** How long a freshly-created live-trip share link stays valid. */
export const TRIP_SHARE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

/** Build the public-facing share URL for a trip token. */
export function buildShareUrl(token: string): string {
  const base = process.env.NEXTAUTH_URL ?? '';
  return `${base}/trip/${token}`;
}

/** The set of valid IncidentType values, for defensive input validation. */
export const INCIDENT_TYPES = [
  'ACCIDENT',
  'HARASSMENT',
  'VEHICLE_BREAKDOWN',
  'THEFT',
  'UNSAFE_LOCATION',
  'CUSTOMER_DISPUTE',
  'OTHER',
] as const;

export type IncidentTypeValue = (typeof INCIDENT_TYPES)[number];

/** Narrow an unknown value to a valid IncidentType. */
export function isIncidentType(v: unknown): v is IncidentTypeValue {
  return typeof v === 'string' && (INCIDENT_TYPES as readonly string[]).includes(v);
}

/** Coerce an unknown value to a finite number, or undefined. */
export function toFiniteNumber(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return v;
}

/** Coerce an unknown value to a trimmed non-empty string, or undefined. */
export function toTrimmedString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}
