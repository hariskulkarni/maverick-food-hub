/**
 * Safety-alert settings: defaults, clamping/normalisation, and patch-merge
 * persistence into the shared platform config blob (mocked 2fa store).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let store: any = {};
vi.mock('@/server/2fa', () => ({
  getPlatformSecurity: async () => ({ ...store }),
  setPlatformSecurity: async (patch: any) => { store = { ...store, ...patch }; },
}));

import {
  normalizeSafetyAlerts,
  getSafetyAlertSettings,
  setSafetyAlertSettings,
  SAFETY_ALERT_DEFAULTS,
} from '@/server/safety/settings';

beforeEach(() => { store = {}; });

describe('normalizeSafetyAlerts', () => {
  it('fills complete defaults from an empty/undefined blob', () => {
    expect(normalizeSafetyAlerts(undefined)).toEqual(SAFETY_ALERT_DEFAULTS);
  });
  it('clamps out-of-range numbers and ignores non-booleans', () => {
    const n = normalizeSafetyAlerts({
      routeDeviation: { enabled: true, minutes: 0, metres: 9999 },
      etaBreach: { enabled: 'nope' as any, minutes: 999 },
      longWaitAtRestaurant: { minutes: -4 },
      signalLoss: { minutes: 'abc' as any },
    });
    expect(n.routeDeviation.minutes).toBe(1); // clamped up from 0
    expect(n.routeDeviation.metres).toBe(5000); // clamped down
    expect(n.etaBreach.enabled).toBe(true); // non-boolean → default
    expect(n.etaBreach.minutes).toBe(240); // clamped to max
    expect(n.longWaitAtRestaurant.minutes).toBe(1); // clamped up from negative
    expect(n.signalLoss.minutes).toBe(SAFETY_ALERT_DEFAULTS.signalLoss.minutes); // non-finite → default
  });
});

describe('get/set', () => {
  it('returns defaults when nothing stored', async () => {
    expect(await getSafetyAlertSettings()).toEqual(SAFETY_ALERT_DEFAULTS);
  });

  it('merges a partial patch and persists the clamped result', async () => {
    const after = await setSafetyAlertSettings({ etaBreach: { minutes: 25 }, signalLoss: { enabled: false } });
    expect(after.etaBreach).toEqual({ enabled: true, minutes: 25 });
    expect(after.signalLoss.enabled).toBe(false);
    // Untouched types keep their defaults.
    expect(after.routeDeviation).toEqual(SAFETY_ALERT_DEFAULTS.routeDeviation);
    // Persisted and read back identically.
    expect(await getSafetyAlertSettings()).toEqual(after);
  });

  it('toggling one type off does not disturb the others on re-read', async () => {
    await setSafetyAlertSettings({ routeDeviation: { enabled: false } });
    const read = await getSafetyAlertSettings();
    expect(read.routeDeviation.enabled).toBe(false);
    expect(read.etaBreach.enabled).toBe(true);
    expect(read.longWaitAtRestaurant.enabled).toBe(true);
  });
});
