/**
 * Rider safety & anomaly alert settings (super-admin tunable).
 *
 * Thresholds + per-type on/off toggles for the safety-alerts sweep
 * (server/safety/alerts.ts). Stored in the shared platform config blob (see
 * 2fa.ts / platform-settings.ts) so there's no extra table/migration; the keys
 * are typed locally here so the shared PlatformSecurity interface needn't change.
 *
 * Every value is clamped and defaulted here, so the sweep and UI can trust it.
 */
import { getPlatformSecurity, setPlatformSecurity } from '../2fa';

export interface AlertToggleMin {
  enabled: boolean;
  minutes: number;
}

export interface SafetyAlertSettings {
  /** Persistently off the expected corridor for `minutes` by more than `metres`. */
  routeDeviation: { enabled: boolean; minutes: number; metres: number };
  /** Elapsed past the promised delivery time by `minutes`. */
  etaBreach: AlertToggleMin;
  /** At the restaurant geofence, order READY, but not picked up after `minutes`. */
  longWaitAtRestaurant: AlertToggleMin;
  /** No GPS ping for `minutes` on an active delivery. */
  signalLoss: AlertToggleMin;
}

export const SAFETY_ALERT_DEFAULTS: SafetyAlertSettings = {
  routeDeviation: { enabled: true, minutes: 3, metres: 300 },
  etaBreach: { enabled: true, minutes: 15 },
  longWaitAtRestaurant: { enabled: true, minutes: 12 },
  signalLoss: { enabled: true, minutes: 10 },
};

type StoredSafetyAlerts = Partial<{
  routeDeviation: Partial<SafetyAlertSettings['routeDeviation']>;
  etaBreach: Partial<AlertToggleMin>;
  longWaitAtRestaurant: Partial<AlertToggleMin>;
  signalLoss: Partial<AlertToggleMin>;
}>;

type Blob = { safetyAlerts?: StoredSafetyAlerts };

function clampMin(v: unknown, fallback: number, min = 1, max = 240): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clampMetres(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(5000, Math.max(50, Math.round(n)));
}

function toggle(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** Normalise a stored (possibly partial / absent) blob to a complete, clamped config. */
export function normalizeSafetyAlerts(stored: StoredSafetyAlerts | undefined): SafetyAlertSettings {
  const d = SAFETY_ALERT_DEFAULTS;
  const s = stored ?? {};
  return {
    routeDeviation: {
      enabled: toggle(s.routeDeviation?.enabled, d.routeDeviation.enabled),
      minutes: clampMin(s.routeDeviation?.minutes, d.routeDeviation.minutes),
      metres: clampMetres(s.routeDeviation?.metres, d.routeDeviation.metres),
    },
    etaBreach: {
      enabled: toggle(s.etaBreach?.enabled, d.etaBreach.enabled),
      minutes: clampMin(s.etaBreach?.minutes, d.etaBreach.minutes),
    },
    longWaitAtRestaurant: {
      enabled: toggle(s.longWaitAtRestaurant?.enabled, d.longWaitAtRestaurant.enabled),
      minutes: clampMin(s.longWaitAtRestaurant?.minutes, d.longWaitAtRestaurant.minutes),
    },
    signalLoss: {
      enabled: toggle(s.signalLoss?.enabled, d.signalLoss.enabled),
      minutes: clampMin(s.signalLoss?.minutes, d.signalLoss.minutes),
    },
  };
}

export async function getSafetyAlertSettings(): Promise<SafetyAlertSettings> {
  const cfg = (await getPlatformSecurity().catch(() => ({}))) as Blob;
  return normalizeSafetyAlerts(cfg.safetyAlerts);
}

/** Merge a partial patch into the stored settings and persist the clamped result. */
export async function setSafetyAlertSettings(patch: DeepPartial<SafetyAlertSettings>): Promise<SafetyAlertSettings> {
  const current = await getSafetyAlertSettings();
  const next: SafetyAlertSettings = {
    routeDeviation: { ...current.routeDeviation, ...(patch.routeDeviation ?? {}) },
    etaBreach: { ...current.etaBreach, ...(patch.etaBreach ?? {}) },
    longWaitAtRestaurant: { ...current.longWaitAtRestaurant, ...(patch.longWaitAtRestaurant ?? {}) },
    signalLoss: { ...current.signalLoss, ...(patch.signalLoss ?? {}) },
  };
  const normalized = normalizeSafetyAlerts(next);
  await setPlatformSecurity({ safetyAlerts: normalized } as Parameters<typeof setPlatformSecurity>[0]);
  return normalized;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };
