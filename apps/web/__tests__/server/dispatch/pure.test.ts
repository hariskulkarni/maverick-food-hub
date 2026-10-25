/**
 * Dispatch telemetry — pure functions: event mapping, settings clamps, prep
 * prediction choice, JIT timing math + release conditions, stationary
 * detection, H3 bucketing, IST ranges and KPI shaping.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/server/db', () => ({ prisma: {} }));
vi.mock('@/server/realtime', () => ({ publish: vi.fn() }));
vi.mock('@/server/2fa', () => ({ getPlatformSecurity: vi.fn(async () => ({})), setPlatformSecurity: vi.fn() }));

import { dedupeKeyFor, eventTypeForStatus, sourceForRole, recordOrderEvent } from '@/server/dispatch/events';
import { normalizeJitConfig, JIT_DEFAULTS } from '@/server/dispatch/settings';
import { istHour, quotedPrepMinutes, choosePrediction } from '@/server/dispatch/prep';
import { decideJitRelease, travelMinutes, promisedAtFor } from '@/server/dispatch/jit';
import { isStationary } from '@/server/dispatch/stationary';
import { bucketStart, cellFor, aggregateZones, NO_FIX_CELL } from '@/server/dispatch/zones';
import { istRange, defaultRange, istToday, toKpiBlock, csvRows, CSV_HEADERS } from '@/server/dispatch/insights';

const MIN = 60_000;

describe('order event mapping', () => {
  it('maps status transitions to milestones', () => {
    expect(eventTypeForStatus('ACCEPTED')).toBe('ACCEPTED');
    expect(eventTypeForStatus('PREPARING')).toBe('PREP_STARTED');
    expect(eventTypeForStatus('READY')).toBe('FOOD_READY');
    expect(eventTypeForStatus('OUT_FOR_DELIVERY')).toBe('PICKED_UP');
    expect(eventTypeForStatus('PICKED_UP')).toBe('PICKED_UP');
    expect(eventTypeForStatus('RIDER_REACHED_RESTAURANT')).toBe('ARRIVED_RESTAURANT');
    expect(eventTypeForStatus('RIDER_REACHED_CUSTOMER')).toBe('ARRIVED_CUSTOMER');
    expect(eventTypeForStatus('DELIVERED')).toBe('DELIVERED');
    expect(eventTypeForStatus('CANCELLED_BY_CUSTOMER')).toBe('CANCELLED');
    expect(eventTypeForStatus('REFUNDED')).toBeNull();
    expect(eventTypeForStatus('PAYMENT_PENDING')).toBeNull();
  });

  it('dedupes once-only milestones but not repeatable ones', () => {
    expect(dedupeKeyFor('FOOD_READY')).toBe('FOOD_READY');
    expect(dedupeKeyFor('ASSIGNED')).toBeNull();
    expect(dedupeKeyFor('INVITED')).toBeNull();
    expect(dedupeKeyFor('INVITED', 'INVITED:pool')).toBe('INVITED:pool');
  });

  it('attributes restaurant staff to KITCHEN and platform roles to ADMIN', () => {
    expect(sourceForRole('KITCHEN')).toBe('KITCHEN');
    expect(sourceForRole('ADMIN')).toBe('KITCHEN');
    expect(sourceForRole('SUPER_ADMIN')).toBe('ADMIN');
    expect(sourceForRole('ADMIN_ASSIST')).toBe('ADMIN');
    expect(sourceForRole('RIDER')).toBe('RIDER');
    expect(sourceForRole(undefined)).toBe('SYSTEM');
  });

  it('never throws when the database write fails', async () => {
    await expect(recordOrderEvent({ orderId: 'o1', type: 'ACCEPTED', source: 'SYSTEM' })).resolves.toBe(false);
  });
});

describe('JIT settings', () => {
  it('defaults OFF and clamps every tunable', () => {
    expect(normalizeJitConfig(undefined)).toEqual(JIT_DEFAULTS);
    expect(JIT_DEFAULTS.enabled).toBe(false);
    const c = normalizeJitConfig({ enabled: true, bufferMin: 99, roadFactor: 0.2, speedKph: NaN, rangeKm: -1, promiseSlaMin: 1000 });
    expect(c).toEqual({ enabled: true, bufferMin: 15, roadFactor: 1, speedKph: JIT_DEFAULTS.speedKph, rangeKm: 0.5, promiseSlaMin: 120 });
    expect(normalizeJitConfig({ enabled: 'yes' as unknown as boolean }).enabled).toBe(false);
  });
});

describe('prep prediction', () => {
  it('computes IST hour', () => {
    expect(istHour(new Date('2026-10-20T08:00:00Z'))).toBe(13);
    expect(istHour(new Date('2026-10-20T19:00:00Z'))).toBe(0);
  });
  it('quotes the slowest item, default 20', () => {
    expect(quotedPrepMinutes([10, 25, null, 15])).toBe(25);
    expect(quotedPrepMinutes([])).toBe(20);
    expect(quotedPrepMinutes([null, undefined, 0])).toBe(20);
  });
  it('uses the hour bucket at ≥30 samples, then all-hours, then the quote', () => {
    const stats = [{ hourBucket: 13, samples: 30, p60Min: 18 }, { hourBucket: -1, samples: 200, p60Min: 22 }];
    expect(choosePrediction(stats, 13, 25)).toMatchObject({ minutes: 18, source: 'hour' });
    expect(choosePrediction([{ ...stats[0], samples: 29 }, stats[1]], 13, 25)).toMatchObject({ minutes: 22, source: 'all' });
    expect(choosePrediction([{ hourBucket: -1, samples: 10, p60Min: 9 }], 13, 25)).toMatchObject({ minutes: 25, source: 'quoted', samples: 10 });
    expect(choosePrediction([], 13, 25)).toMatchObject({ minutes: 25, source: 'quoted', samples: 0 });
  });
});

describe('JIT timing math', () => {
  const cfg = { bufferMin: 3, roadFactor: 1.35, speedKph: 20, rangeKm: 5 };
  const acceptedAt = new Date('2026-10-20T08:00:00Z');
  const base = { acceptedAt, predictedPrepMin: 20, deliveryKm: 2, promisedAt: new Date(acceptedAt.getTime() + 60 * MIN), cfg };

  it('travel = km × road factor ÷ speed', () => {
    expect(travelMinutes(2, 1.35, 20)).toBeCloseTo(8.1, 5);
    expect(travelMinutes(0, 1.35, 20)).toBe(0);
  });

  it('holds until accepted + prep − travel − buffer', () => {
    // 2 km → 8.1 min travel; release = +20 − 8.1 − 3 = +8.9 min
    const d = decideJitRelease({ ...base, now: new Date(acceptedAt.getTime() + MIN), nearestRiderKm: 2 });
    expect(d.release).toBe(false);
    expect((d.releaseAt.getTime() - acceptedAt.getTime()) / MIN).toBeCloseTo(8.9, 5);
    expect(d.predictedReadyAt.getTime()).toBe(acceptedAt.getTime() + 20 * MIN);
    expect(d.travelMin).toBeCloseTo(8.1, 5);
  });

  it('releases once the release time has passed (jit_due)', () => {
    const d = decideJitRelease({ ...base, now: new Date(acceptedAt.getTime() + 9 * MIN), nearestRiderKm: 2 });
    expect(d).toMatchObject({ release: true, reason: 'jit_due' });
  });

  it('releases immediately when no eligible rider is within range', () => {
    expect(decideJitRelease({ ...base, now: acceptedAt, nearestRiderKm: null })).toMatchObject({ release: true, reason: 'no_rider_in_range' });
    expect(decideJitRelease({ ...base, now: acceptedAt, nearestRiderKm: 5.01 })).toMatchObject({ release: true, reason: 'no_rider_in_range' });
    expect(decideJitRelease({ ...base, now: acceptedAt, nearestRiderKm: 5 }).reason).not.toBe('no_rider_in_range');
  });

  it('releases immediately when the promise has no slack', () => {
    // ready +20, delivery leg 2 km ≈ 8.1, buffer 3 → best case +31.1 ≥ promise +30
    const d = decideJitRelease({ ...base, promisedAt: new Date(acceptedAt.getTime() + 30 * MIN), now: acceptedAt, nearestRiderKm: 1 });
    expect(d).toMatchObject({ release: true, reason: 'promise_at_risk' });
    const ok = decideJitRelease({ ...base, promisedAt: new Date(acceptedAt.getTime() + 32 * MIN), now: acceptedAt, nearestRiderKm: 1 });
    expect(ok.release).toBe(false);
  });

  it('a long rider trip pulls the release earlier, never later than ready', () => {
    const near = decideJitRelease({ ...base, now: acceptedAt, nearestRiderKm: 0.5 });
    const far = decideJitRelease({ ...base, now: acceptedAt, nearestRiderKm: 4 });
    expect(far.releaseAt.getTime()).toBeLessThan(near.releaseAt.getTime());
    expect(near.releaseAt.getTime()).toBeLessThanOrEqual(near.predictedReadyAt.getTime());
  });

  it('promise = ETA when recorded, else placed + SLA', () => {
    const placedAt = new Date('2026-10-20T08:00:00Z');
    expect(promisedAtFor({ estimatedDeliveryAt: null, placedAt }, 45).getTime()).toBe(placedAt.getTime() + 45 * MIN);
    const eta = new Date('2026-10-20T08:50:00Z');
    expect(promisedAtFor({ estimatedDeliveryAt: eta, placedAt }, 45)).toBe(eta);
  });
});

describe('stationary detection', () => {
  const cfg = { windowMin: 8, moveM: 50, geofenceM: 150, debounceMin: 30, maxFixAgeMin: 3 };
  const now = new Date('2026-10-20T08:00:00Z');
  const spot = { lat: 12.99, lng: 77.6 };
  const anchor = { ...spot, at: new Date(now.getTime() - 9 * MIN) };
  const latest = { lat: 12.9902, lng: 77.6, at: new Date(now.getTime() - 30_000) }; // ~22 m
  const pickup = { lat: 12.9716, lng: 77.5946 };
  const base = { now, anchor, latest, maxMoveM: 25, pickup, drop: { lat: 12.95, lng: 77.62 }, cfg };

  it('flags < 50 m over ≥ 8 min away from both geofences', () => {
    expect(isStationary(base)).toEqual({ stationary: true, minutes: 9, reason: 'stationary' });
  });
  it('needs a full observation window and a fresh fix', () => {
    expect(isStationary({ ...base, anchor: null }).reason).toBe('no_anchor');
    expect(isStationary({ ...base, anchor: { ...anchor, at: new Date(now.getTime() - 5 * MIN) } }).reason).toBe('no_anchor');
    expect(isStationary({ ...base, latest: { ...latest, at: new Date(now.getTime() - 5 * MIN) } }).reason).toBe('stale_fix');
  });
  it('is not stationary after moving ≥ 50 m', () => {
    expect(isStationary({ ...base, maxMoveM: 60 }).reason).toBe('moved');
    expect(isStationary({ ...base, maxMoveM: 0, latest: { lat: 12.9906, lng: 77.6, at: latest.at } }).reason).toBe('moved'); // ~67 m
  });
  it('ignores riders waiting at the restaurant or the customer', () => {
    expect(isStationary({ ...base, pickup: spot }).reason).toBe('at_pickup');
    expect(isStationary({ ...base, drop: spot }).reason).toBe('at_drop');
    expect(isStationary({ ...base, pickup: null, drop: null }).stationary).toBe(true);
  });
});

describe('zones', () => {
  it('floors to 5-minute buckets', () => {
    expect(bucketStart(new Date('2026-10-20T08:07:59Z')).toISOString()).toBe('2026-10-20T08:05:00.000Z');
    expect(bucketStart(new Date('2026-10-20T08:05:00Z')).toISOString()).toBe('2026-10-20T08:05:00.000Z');
  });
  it('maps coordinates to H3 res-8 cells (and bad fixes to "none")', () => {
    const c = cellFor(12.9716, 77.5946);
    expect(c).toMatch(/^88[0-9a-f]{13}$/);
    expect(cellFor(12.97161, 77.59461)).toBe(c);
    expect(cellFor(null, 77.5)).toBe(NO_FIX_CELL);
    expect(cellFor(200, 77.5)).toBe(NO_FIX_CELL);
  });
  it('aggregates orders and idle/busy riders per cell', () => {
    const m = aggregateZones(
      [{ lat: 12.9716, lng: 77.5946 }, { lat: 12.9716, lng: 77.5946 }, { lat: null, lng: null }],
      [
        { lat: 12.9716, lng: 77.5946, busy: false, fresh: true },
        { lat: 12.9716, lng: 77.5946, busy: true, fresh: true },
        { lat: 12.9716, lng: 77.5946, busy: false, fresh: false },
      ]
    );
    expect(m.get(cellFor(12.9716, 77.5946))).toEqual({ openOrders: 2, idleRiders: 1, busyRiders: 1 });
    expect(m.get(NO_FIX_CELL)).toEqual({ openOrders: 1, idleRiders: 1, busyRiders: 0 });
  });
});

describe('insights helpers', () => {
  it('uses IST day boundaries', () => {
    const r = istRange('2026-10-20', '2026-10-21');
    expect(r.start.toISOString()).toBe('2026-10-19T18:30:00.000Z');
    expect(r.end.toISOString()).toBe('2026-10-21T18:30:00.000Z');
    expect(r.days).toBe(2);
    expect(istToday(new Date('2026-10-20T19:00:00Z'))).toBe('2026-10-21');
    expect(defaultRange(new Date('2026-10-20T19:00:00Z'))).toEqual({ from: '2026-10-15', to: '2026-10-21' });
  });
  it('rejects bad / inverted / oversized ranges with 400', () => {
    const status = (f: () => unknown) => { try { f(); return 0; } catch (e) { return (e as Response).status; } };
    expect(status(() => istRange('20-10-2026', '2026-10-21'))).toBe(400);
    expect(status(() => istRange('2026-10-22', '2026-10-21'))).toBe(400);
    expect(status(() => istRange('2026-01-01', '2026-10-21'))).toBe(400);
  });
  it('shapes KPI rows and CSV', () => {
    const k = toKpiBlock({
      orders: 10, delivered: 8, assign_p50: 2.04, assign_p90: 6, wait_p50: 3, wait_p90: 9, wait_from_arrival: 4,
      food_wait_p50: 1, food_wait_p90: 4, prep_mae: 2.55, prep_bias: -1, prep_samples: 6,
      on_time: 6, ready_total: 9, ready_tapped: 9, with_rider: 8, batched: 2,
    });
    expect(k).toMatchObject({ onTimePct: 75, readyTapRatePct: 100, batchRatePct: 25, assignmentLatencyMin: { p50: 2, p90: 6 } });
    expect(k.riderWaitAtRestaurantMin.fromArrivalShare).toBe(50);
    expect(k.prepError.maeMin).toBe(2.6);
    const empty = toKpiBlock({} as never);
    expect(empty).toMatchObject({ orders: 0, onTimePct: null, readyTapRatePct: null, assignmentLatencyMin: { p50: null } });
    const rows = csvRows([{ day: '2026-10-20', ...k }]);
    expect(rows[0]).toHaveLength(CSV_HEADERS.length);
    expect(rows[0][0]).toBe('2026-10-20');
  });
});
