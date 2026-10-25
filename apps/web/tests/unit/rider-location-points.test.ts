import { describe, it, expect } from 'vitest';
import {
  classifyPoints,
  pointsToPersist,
  isActiveDelivery,
  LIVE_MAX_AGE_MS,
  MAX_AGE_MS,
  FUTURE_SKEW_MS
} from '@/server/rider-location-points';

const NOW = 1_800_000_000_000;

describe('classifyPoints', () => {
  it('sorts by fix time and marks only a fresh newest point as live', () => {
    const r = classifyPoints(
      [
        { lat: 3, lng: 3, recordedAt: NOW - 1_000 },
        { lat: 1, lng: 1, recordedAt: NOW - 20_000 },
        { lat: 2, lng: 2, recordedAt: NOW - 10_000 }
      ],
      NOW,
      undefined
    );
    expect(r.accepted.map((p) => p.lat)).toEqual([1, 2, 3]);
    expect(r.live?.lat).toBe(3);
    expect(r.lastAcceptedAt).toBe(NOW - 1_000);
  });

  it('drops points at or before the high-water mark, from the future, or too old', () => {
    const r = classifyPoints(
      [
        { lat: 1, lng: 1, recordedAt: NOW - 5_000 },
        { lat: 2, lng: 2, recordedAt: NOW + FUTURE_SKEW_MS + 1 },
        { lat: 3, lng: 3, recordedAt: NOW - MAX_AGE_MS - 1 },
        { lat: 4, lng: 4, recordedAt: NOW - 1_000 }
      ],
      NOW,
      NOW - 5_000
    );
    expect(r.accepted.map((p) => p.lat)).toEqual([4]);
  });

  it('keeps stale points for the trail without a live point', () => {
    const r = classifyPoints([{ lat: 1, lng: 1, recordedAt: NOW - LIVE_MAX_AGE_MS - 1 }], NOW, undefined);
    expect(r.accepted).toHaveLength(1);
    expect(r.live).toBeNull();
  });

  it('applies the sentAt clock offset and uses server time when recordedAt is missing', () => {
    const r = classifyPoints([{ lat: 1, lng: 1, recordedAt: 1_000 }], NOW, undefined, 2_000);
    expect(r.accepted[0].t).toBe(NOW - 1_000);
    expect(classifyPoints([{ lat: 1, lng: 1 }], NOW, undefined).accepted[0].t).toBe(NOW);
  });
});

describe('pointsToPersist', () => {
  it('thins to one point per 3 s by fix time', () => {
    const pts = [0, 1_000, 3_000, 3_500, 7_000].map((d, i) => ({ lat: i, lng: i, t: NOW + d }));
    expect(pointsToPersist(pts, undefined).persist.map((p) => p.lat)).toEqual([0, 2, 4]);
    expect(pointsToPersist(pts, NOW - 1_000).persist.map((p) => p.lat)).toEqual([2, 4]);
  });
});

describe('isActiveDelivery', () => {
  it('is true only for accepted / picked-up assignments on open orders', () => {
    expect(isActiveDelivery('ACCEPTED', 'RIDER_ASSIGNED')).toBe(true);
    expect(isActiveDelivery('PICKED_UP', 'CUSTOMER_UNREACHABLE')).toBe(true);
    expect(isActiveDelivery('PICKED_UP', 'DELIVERY_FAILED')).toBe(false);
    expect(isActiveDelivery('DELIVERED', 'DELIVERED')).toBe(false);
    expect(isActiveDelivery('CANCELLED', 'CANCELLED_BY_ADMIN')).toBe(false);
    expect(isActiveDelivery('PENDING', 'READY')).toBe(false);
  });
});
