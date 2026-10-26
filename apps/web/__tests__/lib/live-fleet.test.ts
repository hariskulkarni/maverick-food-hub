import { describe, it, expect } from 'vitest';
import {
  deriveRiderLive,
  computeFleetStats,
  mergePolled,
  mergeSse,
  isStale,
  formatAgo,
  withWaitingRiders,
  RIDER_SIGNAL_STALE_MS,
  type RiderInput,
  type FleetRider,
} from '@/lib/live-fleet';

const NOW = Date.parse('2026-10-25T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms);
const branch = { latitude: 16.30, longitude: 80.43 };
const address = { latitude: 16.32, longitude: 80.45 };

function rider(over: Partial<RiderInput> = {}): RiderInput {
  return {
    id: 'r1',
    name: 'Ravi',
    currentLat: 16.31,
    currentLng: 80.44,
    updatedAt: ago(60 * 60_000),
    heartbeat: { lastSeenAt: ago(10_000), lastLocationAt: ago(15_000) },
    assignments: [],
    ...over,
  };
}

describe('deriveRiderLive', () => {
  it('uses the real GPS-fix time, not "now" (stale positions must not look fresh)', () => {
    const r = deriveRiderLive(rider({ heartbeat: { lastSeenAt: ago(30 * 60_000), lastLocationAt: ago(30 * 60_000) } }), NOW)!;
    expect(r.at).toBe(ago(30 * 60_000).toISOString());
    expect(r.stale).toBe(true);
  });

  it('falls back to the profile update time when no fix time is recorded', () => {
    const r = deriveRiderLive(rider({ heartbeat: null }), NOW)!;
    expect(r.at).toBe(ago(60 * 60_000).toISOString());
    expect(r.stale).toBe(true);
  });

  it('a recently-heard rider is not stale', () => {
    expect(deriveRiderLive(rider(), NOW)!.stale).toBe(false);
  });

  it('returns null when there is no position to plot', () => {
    expect(deriveRiderLive(rider({ currentLat: null }), NOW)).toBeNull();
  });

  it('idle rider has no leg and no ETA destination', () => {
    const r = deriveRiderLive(rider(), NOW)!;
    expect(r.status).toBe('IDLE');
    expect(r.dest).toBeNull();
    expect(r.activeOrders).toBe(0);
  });

  it('heading to pickup → destination is the restaurant', () => {
    const r = deriveRiderLive(rider({ assignments: [
      { status: 'ACCEPTED', order: { id: 'o1', status: 'RIDER_ASSIGNED', branch, address } },
    ] }), NOW)!;
    expect(r.status).toBe('ACCEPTED');
    expect(r.dest).toEqual({ lat: 16.30, lng: 80.43 });
    expect(r.orderId).toBe('o1');
  });

  it('picked up → destination is the customer', () => {
    const r = deriveRiderLive(rider({ assignments: [
      { status: 'PICKED_UP', order: { id: 'o1', status: 'OUT_FOR_DELIVERY', branch, address } },
    ] }), NOW)!;
    expect(r.status).toBe('PICKED_UP');
    expect(r.dest).toEqual({ lat: 16.32, lng: 80.45 });
  });

  it('batched rider: counts every active order and shows the most advanced leg', () => {
    const r = deriveRiderLive(rider({ assignments: [
      { status: 'ACCEPTED', order: { id: 'o2', status: 'READY', branch, address } },
      { status: 'PICKED_UP', order: { id: 'o1', status: 'OUT_FOR_DELIVERY', branch, address } },
      { status: 'PENDING', order: { id: 'o3', status: 'READY', branch, address } },
    ] }), NOW)!;
    expect(r.activeOrders).toBe(3);
    expect(r.status).toBe('PICKED_UP');
    expect(r.orderId).toBe('o1');
  });

  it('ignores assignments whose order is already closed (delivered / cancelled)', () => {
    const r = deriveRiderLive(rider({ assignments: [
      { status: 'PICKED_UP', order: { id: 'o1', status: 'DELIVERED', branch, address } },
      { status: 'ACCEPTED', order: { id: 'o2', status: 'CANCELLED_BY_ADMIN', branch, address } },
    ] }), NOW)!;
    expect(r.status).toBe('IDLE');
    expect(r.activeOrders).toBe(0);
  });

  it('offer not yet accepted → PENDING with no ETA leg', () => {
    const r = deriveRiderLive(rider({ assignments: [
      { status: 'PENDING', order: { id: 'o1', status: 'READY', branch, address } },
    ] }), NOW)!;
    expect(r.status).toBe('PENDING');
    expect(r.dest).toBeNull();
  });
});

describe('computeFleetStats', () => {
  const base: FleetRider = { riderId: 'x', lat: 16.31, lng: 80.44, at: ago(5_000).toISOString(), seenAt: ago(5_000).toISOString() };
  it('online counts only riders with a live signal; quiet ones are "signal lost"', () => {
    const s = computeFleetStats([
      { ...base, riderId: 'a', status: 'IDLE' },
      { ...base, riderId: 'b', status: 'IDLE', seenAt: ago(RIDER_SIGNAL_STALE_MS + 1).toISOString() },
    ], NOW);
    expect(s.online).toBe(1);
    expect(s.signalLost).toBe(1);
    expect(s.idle).toBe(1);
  });

  it('heading to pickup vs on delivery are split by leg', () => {
    const s = computeFleetStats([
      { ...base, riderId: 'a', status: 'ACCEPTED' },
      { ...base, riderId: 'b', status: 'PENDING' },
      { ...base, riderId: 'c', status: 'PICKED_UP' },
    ], NOW);
    expect(s.headingToPickup).toBe(2);
    expect(s.onDelivery).toBe(1);
    expect(s.idle).toBe(0);
  });

  it('avg ETA uses each rider\'s own current leg and skips stale riders', () => {
    const s = computeFleetStats([
      { ...base, riderId: 'a', status: 'PICKED_UP', dest: { lat: 16.32, lng: 80.45 } },
      { ...base, riderId: 'b', status: 'PICKED_UP', dest: { lat: 20, lng: 85 }, seenAt: ago(RIDER_SIGNAL_STALE_MS + 1).toISOString() },
    ], NOW);
    expect(s.avgEta).not.toBeNull();
    expect(s.avgEta!).toBeLessThan(10);
  });

  it('no riders → no ETA', () => {
    expect(computeFleetStats([], NOW).avgEta).toBeNull();
  });
});

describe('mergePolled / mergeSse', () => {
  const sse: FleetRider = { riderId: 'r1', lat: 1.002, lng: 2.002, at: ago(1_000).toISOString(), status: 'IDLE' };
  const polled: FleetRider = { riderId: 'r1', lat: 1.001, lng: 2.001, at: ago(4_000).toISOString(), status: 'PICKED_UP', dest: { lat: 3, lng: 4 }, orderId: 'o1' };

  it('poll never rewinds a newer SSE fix, but takes the workflow status/leg', () => {
    const m = mergePolled(sse, polled);
    expect(m.lat).toBe(1.002);
    expect(m.at).toBe(sse.at);
    expect(m.status).toBe('PICKED_UP');
    expect(m.dest).toEqual({ lat: 3, lng: 4 });
    expect(m.orderId).toBe('o1');
  });

  it('poll with a newer fix moves the pin', () => {
    const m = mergePolled({ ...sse, at: ago(10_000).toISOString() }, polled);
    expect(m.lat).toBe(1.001);
  });

  it('out-of-order SSE frame is dropped', () => {
    expect(mergeSse(sse, { riderId: 'r1', lat: 9, lng: 9, at: ago(5_000).toISOString() })).toBeNull();
  });

  it('SSE frame keeps status/leg and clears "signal lost"', () => {
    const m = mergeSse({ ...polled, stale: true }, { riderId: 'r1', lat: 5, lng: 6, at: ago(0).toISOString() })!;
    expect(m.lat).toBe(5);
    expect(m.status).toBe('PICKED_UP');
    expect(m.stale).toBe(false);
  });
});

describe('isStale / formatAgo', () => {
  it('stale boundary matches the heartbeat sweep window', () => {
    expect(isStale(ago(RIDER_SIGNAL_STALE_MS - 1000), NOW)).toBe(false);
    expect(isStale(ago(RIDER_SIGNAL_STALE_MS + 1000), NOW)).toBe(true);
    expect(isStale(undefined, NOW)).toBe(true);
  });
  it('formats relative times', () => {
    expect(formatAgo(ago(2_000).toISOString(), NOW)).toBe('just now');
    expect(formatAgo(ago(45_000).toISOString(), NOW)).toBe('45s ago');
    expect(formatAgo(ago(3 * 60_000).toISOString(), NOW)).toBe('3m ago');
    expect(formatAgo(ago(3 * 3_600_000).toISOString(), NOW)).toBe('3h ago');
  });
});

describe('test riders and riders waiting for GPS', () => {
  it('carries the test flag through and never counts a test rider', () => {
    const real = deriveRiderLive(rider({ id: 'real' }), NOW)!;
    const test = deriveRiderLive(rider({ id: 'test', isTest: true }), NOW)!;
    expect(test.isTest).toBe(true);
    expect(real.isTest).toBeUndefined();
    expect(computeFleetStats([real, test], NOW)).toEqual(computeFleetStats([real], NOW));
  });

  it('keeps the test flag across SSE and poll merges', () => {
    const test = deriveRiderLive(rider({ id: 'test', isTest: true }), NOW)!;
    const sse = mergeSse(test, { riderId: 'test', lat: 16.4, lng: 80.5, at: new Date(NOW).toISOString() })!;
    expect(sse.isTest).toBe(true);
    expect(mergePolled(sse, test).isTest).toBe(true);
  });

  it('counts online riders without a GPS fix (fresh as online + idle, silent as signal lost), never test ones', () => {
    const base = computeFleetStats([], NOW);
    const stats = withWaitingRiders(
      base,
      [
        { riderId: 'a', seenAt: ago(20_000).toISOString(), stale: false },
        { riderId: 'b', seenAt: ago(RIDER_SIGNAL_STALE_MS + 60_000).toISOString(), stale: true },
        { riderId: 't', seenAt: ago(5_000).toISOString(), stale: false, isTest: true },
      ],
      NOW
    );
    expect(stats).toMatchObject({ online: 1, idle: 1, signalLost: 1 });
  });
});

