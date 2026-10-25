/** Delivery presets: zone payloads validate against the real schema and the preview matches the live fee engine. */
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/server/db', () => ({ prisma: {} }));

import { DELIVERY_PRESETS, presetToZoneBody, previewFee, validatePreset } from '@/lib/onboarding/delivery-presets';
import { ZoneBody, zoneData } from '@/server/delivery/zone-schema';
import { computeZoneDelivery } from '@/server/delivery/zones';

const branch = { id: 'b1', latitude: 12.93, longitude: 77.62 };

describe('delivery presets', () => {
  it('every preset produces a valid CIRCLE zone body', () => {
    for (const p of DELIVERY_PRESETS) {
      expect(validatePreset(p.values)).toEqual([]);
      const parsed = ZoneBody.safeParse(presetToZoneBody(p.values, branch, p.title));
      expect(parsed.success).toBe(true);
    }
  });

  it('3 km flat ₹30 → 3000 paise bracket; slabs → paise tiers', () => {
    const flat = presetToZoneBody(DELIVERY_PRESETS[0]!.values, branch, 'Flat');
    expect(flat).toMatchObject({ radiusKm: 3, feeBrackets: [{ minSubtotal: 0, charge: 3000 }], distanceTiers: [] });
    const slabs = presetToZoneBody(DELIVERY_PRESETS[1]!.values, branch, 'Slabs');
    expect(slabs.distanceTiers).toEqual([{ uptoKm: 2, charge: 2000 }, { uptoKm: 5, charge: 3500 }, { uptoKm: 8, charge: 5000 }]);
  });

  it('preview matches computeZoneDelivery for a grid of distances and baskets', () => {
    for (const p of DELIVERY_PRESETS) {
      const zone = { ...zoneData(ZoneBody.parse(presetToZoneBody(p.values, branch, p.title))), minOrder: p.values.minOrder } as any;
      for (const km of [0.5, 1.9, 2, 3, 4.2, 5, 7.9]) {
        for (const subtotal of [100, 350, 499, 500, 1200]) {
          const preview = previewFee(p.values, km, subtotal);
          if (km > p.values.radiusKm) { expect(preview).toBeNull(); continue; }
          const live = computeZoneDelivery(zone, subtotal * 100, km);
          expect(live.available).toBe(true);
          expect(preview!.fee * 100).toBe(live.feePaise);
        }
      }
    }
  });

  it('worked example: 4.2 km, ₹350 on distance slabs pays ₹35; free above ₹499 works', () => {
    expect(previewFee(DELIVERY_PRESETS[1]!.values, 4.2, 350)).toEqual({ fee: 35, belowMinimum: false });
    expect(previewFee(DELIVERY_PRESETS[2]!.values, 3, 520)!.fee).toBe(0);
    expect(previewFee(DELIVERY_PRESETS[0]!.values, 3.5, 300)).toBeNull();
    expect(previewFee(DELIVERY_PRESETS[0]!.values, 1, 100)!.belowMinimum).toBe(true);
  });

  it('validatePreset catches nonsense', () => {
    expect(validatePreset({ ...DELIVERY_PRESETS[1]!.values, radiusKm: 4 })).toEqual([expect.stringMatching(/beyond the delivery radius/)]);
    expect(validatePreset({ ...DELIVERY_PRESETS[0]!.values, baseFee: -5, etaMinutes: 0 })).toHaveLength(2);
  });
});
