import { describe, it, expect } from 'vitest';
import { haversineKm, money, genOrderCode, genDeliveryOtp } from '../../src/lib/utils';

describe('utils', () => {
  it('haversine returns 0 for identical points', () => {
    expect(haversineKm({ lat: 12.97, lng: 77.64 }, { lat: 12.97, lng: 77.64 })).toBe(0);
  });
  it('haversine returns ~7km between Indiranagar and Koramangala approximately', () => {
    const d = haversineKm({ lat: 12.978, lng: 77.640 }, { lat: 12.935, lng: 77.614 });
    expect(d).toBeGreaterThan(4);
    expect(d).toBeLessThan(8);
  });
  it('money formats numbers as INR by default', () => {
    expect(money(100)).toMatch(/100/);
  });
  it('genOrderCode produces ORD- prefix + 6 chars', () => {
    expect(genOrderCode()).toMatch(/^ORD-[A-Z0-9]{6}$/);
  });
  it('genDeliveryOtp produces 4 digits', () => {
    expect(genDeliveryOtp()).toMatch(/^\d{4}$/);
  });
});
