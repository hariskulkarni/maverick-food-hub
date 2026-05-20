/**
 * Platform-wide, non-secret settings (super-admin tunable).
 *
 * Currently: the customer DISCOVERY RADIUS — how far from a customer's location
 * we surface restaurants. Persisted in the existing platform config blob (see
 * 2fa.ts) so there's no extra table/migration.
 */

import { getPlatformSecurity, setPlatformSecurity } from './2fa';

/** Fallback radius when nothing is configured — matches the Branch.serviceRadiusKm default. */
export const DEFAULT_DISCOVERY_RADIUS_KM = 7;
export const MIN_DISCOVERY_RADIUS_KM = 1;
export const MAX_DISCOVERY_RADIUS_KM = 50;

/** Current platform discovery radius in km (clamped, defaulted). */
export async function getDiscoveryRadiusKm(): Promise<number> {
  const cfg = await getPlatformSecurity().catch(() => ({} as Awaited<ReturnType<typeof getPlatformSecurity>>));
  const v = cfg.discoveryRadiusKm;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return DEFAULT_DISCOVERY_RADIUS_KM;
  return Math.min(MAX_DISCOVERY_RADIUS_KM, Math.max(MIN_DISCOVERY_RADIUS_KM, v));
}

/** Persist a new discovery radius (km). Clamped to the allowed range. */
export async function setDiscoveryRadiusKm(km: number): Promise<number> {
  const clamped = Math.min(MAX_DISCOVERY_RADIUS_KM, Math.max(MIN_DISCOVERY_RADIUS_KM, Math.round(km)));
  await setPlatformSecurity({ discoveryRadiusKm: clamped });
  return clamped;
}
