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

/** Training gate: when on, riders can't go online until shift-blocking safety modules are passed. Default off. */
export async function getTrainingShiftGate(): Promise<boolean> {
  const cfg = await getPlatformSecurity().catch(() => ({} as Awaited<ReturnType<typeof getPlatformSecurity>>));
  return cfg.trainingShiftGate === true;
}

export async function setTrainingShiftGate(on: boolean): Promise<boolean> {
  await setPlatformSecurity({ trainingShiftGate: on });
  return on;
}

// ── Rider operations (rider audit r3, 2026-10-25) ────────────────────────────
// Stored in the same platform config blob. The extra keys are typed locally so
// the shared PlatformSecurity interface (2fa.ts) needn't change.
type RiderOpsConfig = {
  riderKycGate?: boolean;
  riderMaxActiveOrders?: number;
  riderDailyGoal?: number;
  riderWeeklyGoal?: number;
};

async function riderOps(): Promise<RiderOpsConfig> {
  return ((await getPlatformSecurity().catch(() => ({}))) ?? {}) as RiderOpsConfig;
}

export const DEFAULT_RIDER_MAX_ACTIVE_ORDERS = 2;
export const DEFAULT_RIDER_DAILY_GOAL = 1500;
export const DEFAULT_RIDER_WEEKLY_GOAL = 9000;

/** KYC gate: riders need every required KYC document approved to go online / get work. Default ON. */
export async function getRiderKycGate(): Promise<boolean> {
  return (await riderOps()).riderKycGate !== false;
}

/** Max simultaneous active deliveries per rider (pool claims + batch adds + admin assigns). */
export async function getRiderMaxActiveOrders(): Promise<number> {
  const n = Number((await riderOps()).riderMaxActiveOrders);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : DEFAULT_RIDER_MAX_ACTIVE_ORDERS;
}

/** Earnings goals shown on the rider app's Earnings tab (₹). */
export async function getRiderEarningsGoals(): Promise<{ daily: number; weekly: number }> {
  const c = await riderOps();
  const daily = Number(c.riderDailyGoal);
  const weekly = Number(c.riderWeeklyGoal);
  return {
    daily: Number.isFinite(daily) && daily > 0 ? daily : DEFAULT_RIDER_DAILY_GOAL,
    weekly: Number.isFinite(weekly) && weekly > 0 ? weekly : DEFAULT_RIDER_WEEKLY_GOAL,
  };
}

export interface RiderOpsSettings {
  kycGate: boolean;
  maxActiveOrders: number;
  dailyGoal: number;
  weeklyGoal: number;
}

export async function getRiderOpsSettings(): Promise<RiderOpsSettings> {
  const [kycGate, maxActiveOrders, goals] = await Promise.all([getRiderKycGate(), getRiderMaxActiveOrders(), getRiderEarningsGoals()]);
  return { kycGate, maxActiveOrders, dailyGoal: goals.daily, weeklyGoal: goals.weekly };
}

export async function setRiderOpsSettings(patch: Partial<RiderOpsSettings>): Promise<RiderOpsSettings> {
  const next: RiderOpsConfig = {};
  if (patch.kycGate !== undefined) next.riderKycGate = patch.kycGate;
  if (patch.maxActiveOrders !== undefined) next.riderMaxActiveOrders = patch.maxActiveOrders;
  if (patch.dailyGoal !== undefined) next.riderDailyGoal = patch.dailyGoal;
  if (patch.weeklyGoal !== undefined) next.riderWeeklyGoal = patch.weeklyGoal;
  await setPlatformSecurity(next as Parameters<typeof setPlatformSecurity>[0]);
  return getRiderOpsSettings();
}
