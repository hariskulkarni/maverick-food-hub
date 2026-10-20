import { describe, it, expect, vi, beforeEach } from 'vitest';

const { publish, findFirst, create, findUnique } = vi.hoisted(() => ({
  publish: vi.fn(), findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn()
}));
vi.mock('@/server/realtime', () => ({ publish }));
vi.mock('@/server/db', () => ({
  prisma: {
    orderStatusEvent: { findFirst, create },
    order: { findUnique }
  }
}));

import { arrivedPhases, maybeEmitArrival, ARRIVAL_RADIUS_M, __resetArrivalCache } from '@/server/arrival';

const pickup = { lat: 12.9716, lng: 77.5946 };
const drop = { lat: 12.9916, lng: 77.6146 };
// ~0.0005 deg lat ≈ 55 m
const nearPickup = { lat: 12.9721, lng: 77.5946 };
const far = { lat: 13.05, lng: 77.7 };

describe('arrivedPhases', () => {
  it('default radius is 120m', () => expect(ARRIVAL_RADIUS_M).toBe(120));
  it('detects pickup within radius', () => expect(arrivedPhases(nearPickup, pickup, drop)).toEqual(['pickup']));
  it('detects dropoff within radius', () => expect(arrivedPhases(drop, pickup, drop)).toEqual(['dropoff']));
  it('none when outside', () => expect(arrivedPhases(far, pickup, drop)).toEqual([]));
  it('handles missing coords', () => expect(arrivedPhases(nearPickup, null, null)).toEqual([]));
});

describe('maybeEmitArrival', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetArrivalCache();
    findFirst.mockResolvedValue(null);
    findUnique.mockResolvedValue({ status: 'OUT_FOR_DELIVERY' });
    create.mockResolvedValue({});
  });

  it('fires once on first in-radius ping: event + sse', async () => {
    await maybeEmitArrival('o1', nearPickup, pickup, drop);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.note).toBe('rider_arrived:pickup');
    expect(publish).toHaveBeenCalledWith('order:o1', expect.objectContaining({ kind: 'rider_arrived', orderId: 'o1', phase: 'pickup' }));
  });

  it('does not re-fire on second in-radius ping', async () => {
    await maybeEmitArrival('o1', nearPickup, pickup, drop);
    await maybeEmitArrival('o1', nearPickup, pickup, drop);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('does not re-fire if DB already has the marker (after restart)', async () => {
    findFirst.mockResolvedValue({ id: 'x' });
    await maybeEmitArrival('o2', nearPickup, pickup, drop);
    expect(publish).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('fires nothing outside radius', async () => {
    await maybeEmitArrival('o3', far, pickup, drop);
    expect(publish).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('fires each phase independently once', async () => {
    await maybeEmitArrival('o4', nearPickup, pickup, drop);
    await maybeEmitArrival('o4', drop, pickup, drop);
    await maybeEmitArrival('o4', drop, pickup, drop);
    expect(publish.mock.calls.map((c) => c[1].phase)).toEqual(['pickup', 'dropoff']);
  });
});
