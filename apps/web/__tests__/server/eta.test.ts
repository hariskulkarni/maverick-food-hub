import { describe, it, expect } from 'vitest';
import { computeEta, formatEta, DEFAULT_RIDER_SPEED_KPH } from '@/server/eta';
import { haversineKm } from '@/lib/utils';

describe('computeEta', () => {
  const branch = { lat: 12.97, lng: 77.64 };

  it('returns 0 minutes when from === to', () => {
    const r = computeEta(branch, branch);
    expect(r).toBe(0);
  });

  it('formatEta renders 0 minutes as ~1 min (min 1)', () => {
    expect(formatEta(0)).toBe('~1 min');
  });

  it('returns expected minutes at 25 km/h for a ~5 km hop', () => {
    const dest = { lat: 13.0151, lng: 77.64 }; // ~5 km north of branch
    const km = haversineKm(branch, dest);
    const expectedMin = (km / DEFAULT_RIDER_SPEED_KPH) * 60;
    const r = computeEta(branch, dest);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(expectedMin, 5);
    // sanity: 5 km / 25 km/h = 0.2 h = 12 minutes
    expect(r!).toBeGreaterThan(11.5);
    expect(r!).toBeLessThan(12.5);
  });

  it('honors a custom speed override', () => {
    const dest = { lat: 13.0151, lng: 77.64 };
    const fast = computeEta(branch, dest, 50);
    const slow = computeEta(branch, dest, 25);
    expect(fast).not.toBeNull();
    expect(slow).not.toBeNull();
    // doubling the speed should halve the ETA
    expect(fast!).toBeCloseTo(slow! / 2, 5);
  });

  it('returns null if either coordinate is missing', () => {
    expect(computeEta(null, branch)).toBeNull();
    expect(computeEta(branch, undefined)).toBeNull();
  });

  it('returns null for non-positive speed', () => {
    expect(computeEta(branch, { lat: 13, lng: 77.65 }, 0)).toBeNull();
  });
});
