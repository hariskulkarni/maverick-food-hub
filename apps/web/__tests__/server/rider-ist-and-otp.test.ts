/** P1-16 IST periods/pay windows (TZ-independent) + P1-5 CSPRNG delivery OTP. */
import { describe, it, expect, vi } from 'vitest';
import { istStartOfDay, istStartOfWeek, istDayKey, istParts } from '@/lib/ist';
import { computeFromRule } from '@/lib/payout-math';
import { genDeliveryOtp } from '@/lib/utils';

describe('IST helpers', () => {
  it('start of day / week are IST midnights regardless of server TZ', () => {
    const t = new Date('2026-10-25T20:00:00Z'); // 01:30 IST Mon 26 Oct
    expect(istStartOfDay(t).toISOString()).toBe('2026-10-25T18:30:00.000Z');
    expect(istDayKey(t)).toBe('2026-10-26');
    expect(istStartOfWeek(t).toISOString()).toBe('2026-10-25T18:30:00.000Z'); // Monday
    expect(istStartOfWeek(new Date('2026-10-25T10:00:00Z')).toISOString()).toBe('2026-10-18T18:30:00.000Z');
    expect(istParts(t).dayOfWeek).toBe(1);
  });
  it('pay engine applies lunch peak at 13:00 IST (07:30 UTC) and weekend on IST Sunday', () => {
    const lunch = computeFromRule({ lunchPeakBonus: 10 }, { distanceKm: 0, subtotal: 0, placedAt: new Date('2026-10-21T07:30:00Z') });
    expect(lunch.peakBonus).toBe(10);
    const notLunch = computeFromRule({ lunchPeakBonus: 10 }, { distanceKm: 0, subtotal: 0, placedAt: new Date('2026-10-21T13:00:00Z') });
    expect(notLunch.peakBonus).toBe(0);
    // Sat 23:00 UTC = Sun 04:30 IST → weekend
    const sun = computeFromRule({ weekendBonus: 25 }, { distanceKm: 0, subtotal: 0, placedAt: new Date('2026-10-24T23:00:00Z') });
    expect(sun.weekendBonus).toBe(25);
  });
});

describe('genDeliveryOtp', () => {
  it('uses crypto.getRandomValues and stays in 1000-9999', () => {
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues');
    const mathSpy = vi.spyOn(Math, 'random');
    for (let i = 0; i < 500; i++) {
      const c = genDeliveryOtp();
      expect(c).toMatch(/^\d{4}$/);
      expect(Number(c)).toBeGreaterThanOrEqual(1000);
    }
    expect(spy).toHaveBeenCalled();
    expect(mathSpy).not.toHaveBeenCalled();
  });
});
