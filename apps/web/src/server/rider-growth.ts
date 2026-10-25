/**
 * Rider growth — tier (loyalty ladder) logic and referral codes.
 *
 * The tier system turns lifetime stats (`totalDeliveries` + `rating`) into a
 * four-rung ladder — BRONZE → SILVER → GOLD → PLATINUM — each with a clear
 * requirement and a motivating perks list. `computeTier` is pure: given a
 * profile snapshot it returns the current rung, the next rung, progress toward
 * it, the current perks, and the full ladder for an "all tiers" overview.
 *
 * Referral codes: the rider's shareable `RIDE-XXXXXX` is derived
 * deterministically from their profile id; each referral row gets a unique
 * suffixed code (`newReferralRowCode`).
 */
import crypto from 'node:crypto';

export { TIERS, computeTier, tierSurgeShareBonus } from '@/lib/rider-tiers';
export type { TierName, TierDef, ComputedTier } from '@/lib/rider-tiers';

/**
 * Deterministic, memorable referral code for a rider profile — `RIDE-XXXXXX`
 * where the suffix is six unambiguous base-32 chars (no 0/O/1/I/L) derived
 * from a SHA-256 of the profile id. Stable across calls, so it can be handed
 * out without persisting anything.
 */
export function genReferralCode(riderProfileId: string): string {
  // Crockford-ish alphabet — drops easily-confused characters.
  const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const hash = crypto.createHash('sha256').update(String(riderProfileId)).digest();
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += ALPHABET[hash[i] % ALPHABET.length];
  }
  return `RIDE-${suffix}`;
}

/**
 * Unique per-row code for a RiderReferral (`RIDE-XXXXXX-YYYY`). The rider's
 * shareable code stays deterministic; each referral row needs its own value
 * because `RiderReferral.code` is @unique (P1-13).
 */
export function newReferralRowCode(riderCode: string): string {
  const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(4);
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += ALPHABET[bytes[i] % ALPHABET.length];
  return `${riderCode}-${suffix}`;
}
