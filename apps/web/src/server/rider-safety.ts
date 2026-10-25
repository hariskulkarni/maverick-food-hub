/**
 * Shared helpers for the rider Safety & SOS feature bundle.
 *
 * Kept dependency-free (Node's crypto only) so the route handlers stay thin and
 * the token-generation logic has a single home.
 */
import { randomStringFromAlphabet } from '@/server/secure-random';

/** URL-safe alphabet — no look-alike characters (0/O, 1/l/I) to keep links readable. */
const TOKEN_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/**
 * Generate a URL-safe random token (~10 chars) for a shareable live-trip link.
 * Uses crypto-strong randomness so tokens aren't guessable.
 */
export function genShareToken(length = 10): string {
  return randomStringFromAlphabet(TOKEN_ALPHABET, length);
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

/** Storage folder for a rider's incident photos (files land at /uploads/<folder>/…). */
export function incidentPhotoFolder(riderProfileId: string): string {
  return `rider-incidents/${riderProfileId}`;
}

/**
 * True when `url` is a photo this rider uploaded via POST
 * /api/rider/incidents/photo — local `/uploads/rider-incidents/<id>/…` or the
 * same key on the configured S3 bucket. Stops a report from carrying an
 * arbitrary external URL into the ops review screen.
 */
export function isOwnIncidentPhotoUrl(url: string, riderProfileId: string): boolean {
  if (url.includes('..') || /[\s"'<>]/.test(url)) return false;
  const keyPrefix = `/uploads/${incidentPhotoFolder(riderProfileId)}/`;
  if (url.startsWith(keyPrefix)) return true;
  const bucket = process.env.S3_BUCKET;
  const region = process.env.S3_REGION;
  if (bucket && region) {
    return url.startsWith(`https://${bucket}.s3.${region}.amazonaws.com${keyPrefix}`);
  }
  return false;
}
