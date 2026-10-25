/**
 * Dispatch settings (super-admin tunable, platform-wide). Stored in the
 * existing platform config blob (see 2fa.ts → PlatformSecurity.dispatchJit),
 * so no settings table is needed. JIT invitations are OFF unless enabled.
 */
import { getPlatformSecurity, setPlatformSecurity } from '../2fa';

export interface DispatchJitConfig {
  /** Master switch. OFF ⇒ dispatch behaves exactly as before (riders invited when food is marked ready). */
  enabled: boolean;
  /** Minutes subtracted from the release time as safety margin. */
  bufferMin: number;
  /** Haversine → road distance multiplier. */
  roadFactor: number;
  /** Assumed rider speed for travel estimates. */
  speedKph: number;
  /** An idle rider farther than this from the restaurant does not count as "near". */
  rangeKm: number;
  /** Delivery promise used when an order has no estimatedDeliveryAt (placedAt + this). */
  promiseSlaMin: number;
}

export const JIT_DEFAULTS: DispatchJitConfig = {
  enabled: false,
  bufferMin: 3,
  roadFactor: 1.35,
  speedKph: 20,
  rangeKm: 5,
  promiseSlaMin: 45,
};

const BOUNDS: Record<Exclude<keyof DispatchJitConfig, 'enabled'>, [number, number]> = {
  bufferMin: [0, 15],
  roadFactor: [1, 2.5],
  speedKph: [5, 60],
  rangeKm: [0.5, 20],
  promiseSlaMin: [15, 120],
};

function clampNum(v: unknown, key: keyof typeof BOUNDS): number {
  const [lo, hi] = BOUNDS[key];
  const n = typeof v === 'number' && Number.isFinite(v) ? v : JIT_DEFAULTS[key];
  return Math.min(hi, Math.max(lo, n));
}

/** Normalise any stored/partial value into a complete, clamped config. */
export function normalizeJitConfig(raw: Partial<DispatchJitConfig> | null | undefined): DispatchJitConfig {
  const r = raw ?? {};
  return {
    enabled: r.enabled === true,
    bufferMin: clampNum(r.bufferMin, 'bufferMin'),
    roadFactor: clampNum(r.roadFactor, 'roadFactor'),
    speedKph: clampNum(r.speedKph, 'speedKph'),
    rangeKm: clampNum(r.rangeKm, 'rangeKm'),
    promiseSlaMin: clampNum(r.promiseSlaMin, 'promiseSlaMin'),
  };
}

export async function getJitConfig(): Promise<DispatchJitConfig> {
  const cfg = await getPlatformSecurity().catch(() => ({} as Awaited<ReturnType<typeof getPlatformSecurity>>));
  return normalizeJitConfig(cfg.dispatchJit);
}

export async function setJitConfig(patch: Partial<DispatchJitConfig>): Promise<DispatchJitConfig> {
  const current = await getJitConfig();
  const next = normalizeJitConfig({ ...current, ...patch });
  await setPlatformSecurity({ dispatchJit: next });
  return next;
}

export const JIT_BOUNDS = BOUNDS;
