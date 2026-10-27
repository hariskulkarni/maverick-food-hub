/**
 * Rider safety & anomaly alerts. Pure verdicts (trigger + no-trigger for every
 * detector), corridor geometry, and the DB sweep (mocked prisma) covering
 * trigger → create, back-on-track → auto-resolve, debounce → skip, and the
 * per-type enable toggle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    riderAssignment: { findMany: vi.fn() },
    orderEscalation: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    alertDebounce: { findUnique: vi.fn(), upsert: vi.fn() },
    $queryRaw: vi.fn(),
  } as any,
}));

vi.mock('@/server/db', () => ({ prisma: prismaMock }));

import {
  corridorDistanceM,
  routeDeviationVerdict,
  etaBreachVerdict,
  longWaitVerdict,
  signalLossVerdict,
  runSafetyAlertsSweep,
} from '@/server/safety/alerts';
import { SAFETY_ALERT_DEFAULTS, type SafetyAlertSettings } from '@/server/safety/settings';

const NOW = new Date('2026-10-27T12:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

// Corridor: restaurant (0,0) → customer (0, 0.01) — an east–west line at lat 0.
// ON sits on that line; OFF is ~1.1 km due north of it.
const BRANCH = { lat: 0, lng: 0 };
const DROP = { lat: 0, lng: 0.01 };
const ON = { lat: 0, lng: 0.005 };
const OFF = { lat: 0.01, lng: 0.005 };

describe('corridor geometry', () => {
  it('is ~0 on the line and ~1.1km off it', () => {
    expect(corridorDistanceM(ON, [BRANCH, DROP])).toBeLessThan(5);
    expect(corridorDistanceM(OFF, [BRANCH, DROP])).toBeGreaterThan(1000);
  });
  it('returns Infinity with no corridor', () => {
    expect(corridorDistanceM(OFF, [])).toBe(Infinity);
  });
});

describe('routeDeviationVerdict', () => {
  const base = { now: NOW, corridor: [BRANCH, DROP], windowMin: 3, metres: 300 };
  it('triggers when off-route at both anchor and latest for the whole window', () => {
    const v = routeDeviationVerdict({ ...base, anchor: { ...OFF, at: ago(5) }, latest: { ...OFF, at: ago(1) } });
    expect(v.deviated).toBe(true);
    expect(v.metres).toBeGreaterThan(1000);
  });
  it('does not trigger when the latest fix is back on the corridor', () => {
    const v = routeDeviationVerdict({ ...base, anchor: { ...OFF, at: ago(5) }, latest: { ...ON, at: ago(1) } });
    expect(v.deviated).toBe(false);
    expect(v.reason).toBe('on_track');
  });
  it('does not trigger on a stale latest fix (GPS gap, not off-route)', () => {
    const v = routeDeviationVerdict({ ...base, anchor: { ...OFF, at: ago(5) }, latest: { ...OFF, at: ago(10) } });
    expect(v.deviated).toBe(false);
    expect(v.reason).toBe('stale_fix');
  });
  it('does not trigger before the window has elapsed', () => {
    const v = routeDeviationVerdict({ ...base, anchor: { ...OFF, at: ago(1) }, latest: { ...OFF, at: ago(0.5) } });
    expect(v.deviated).toBe(false);
    expect(v.reason).toBe('no_window');
  });
});

describe('etaBreachVerdict', () => {
  it('triggers past the promise + threshold', () => {
    expect(etaBreachVerdict({ now: NOW, promisedAt: ago(20), deliveredAt: null, thresholdMin: 15 }).breached).toBe(true);
  });
  it('does not trigger within the threshold or once delivered', () => {
    expect(etaBreachVerdict({ now: NOW, promisedAt: ago(5), deliveredAt: null, thresholdMin: 15 }).breached).toBe(false);
    expect(etaBreachVerdict({ now: NOW, promisedAt: ago(90), deliveredAt: ago(1), thresholdMin: 15 }).breached).toBe(false);
    expect(etaBreachVerdict({ now: NOW, promisedAt: null, deliveredAt: null, thresholdMin: 15 }).reason).toBe('no_promise');
  });
});

describe('longWaitVerdict', () => {
  it('triggers at the restaurant with food ready beyond the threshold', () => {
    expect(longWaitVerdict({ now: NOW, atRestaurant: true, foodReadyAt: ago(15), pickedUp: false, thresholdMin: 12 }).waiting).toBe(true);
  });
  it('does not trigger if picked up, away from the restaurant, or food not ready', () => {
    expect(longWaitVerdict({ now: NOW, atRestaurant: true, foodReadyAt: ago(15), pickedUp: true, thresholdMin: 12 }).reason).toBe('picked_up');
    expect(longWaitVerdict({ now: NOW, atRestaurant: false, foodReadyAt: ago(15), pickedUp: false, thresholdMin: 12 }).reason).toBe('not_at_restaurant');
    expect(longWaitVerdict({ now: NOW, atRestaurant: true, foodReadyAt: null, pickedUp: false, thresholdMin: 12 }).reason).toBe('not_ready');
  });
});

describe('signalLossVerdict', () => {
  it('triggers on a prolonged gap (from last fix or active-since)', () => {
    expect(signalLossVerdict({ now: NOW, lastFixAt: ago(12), activeSince: ago(40), thresholdMin: 10 }).lost).toBe(true);
    expect(signalLossVerdict({ now: NOW, lastFixAt: null, activeSince: ago(40), thresholdMin: 10 }).lost).toBe(true);
  });
  it('does not trigger with a live fix or no reference time', () => {
    expect(signalLossVerdict({ now: NOW, lastFixAt: ago(2), activeSince: ago(40), thresholdMin: 10 }).lost).toBe(false);
    expect(signalLossVerdict({ now: NOW, lastFixAt: null, activeSince: null, thresholdMin: 10 }).reason).toBe('unknown');
  });
});

// ── Sweep (mocked prisma) ────────────────────────────────────────────────────

const ONLY_ROUTE: SafetyAlertSettings = {
  ...SAFETY_ALERT_DEFAULTS,
  routeDeviation: { enabled: true, minutes: 3, metres: 300 },
  etaBreach: { enabled: false, minutes: 15 },
  longWaitAtRestaurant: { enabled: false, minutes: 12 },
  signalLoss: { enabled: false, minutes: 10 },
};

function assignmentRow() {
  return {
    id: 'asg-1',
    riderId: 'rider-1',
    status: 'PICKED_UP',
    order: {
      id: 'order-1',
      code: 'ORD-1',
      readyAt: ago(30),
      outForDeliveryAt: ago(20),
      deliveredAt: null,
      estimatedDeliveryAt: ago(5),
      branch: { latitude: BRANCH.lat, longitude: BRANCH.lng },
      address: { latitude: DROP.lat, longitude: DROP.lng },
    },
  };
}

function fixRow(point: { lat: number; lng: number } | null, latestMin = 1, anchorMin = 5) {
  return {
    riderId: 'rider-1',
    l_lat: point?.lat ?? null,
    l_lng: point?.lng ?? null,
    l_at: point ? ago(latestMin) : null,
    a_lat: point?.lat ?? null,
    a_lng: point?.lng ?? null,
    a_at: point ? ago(anchorMin) : null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.riderAssignment.findMany.mockResolvedValue([assignmentRow()]);
  prismaMock.$queryRaw.mockResolvedValue([fixRow(OFF)]);
  prismaMock.orderEscalation.findFirst.mockResolvedValue(null);
  prismaMock.orderEscalation.create.mockImplementation(async ({ data }: any) => ({ id: 'e1', ...data }));
  prismaMock.orderEscalation.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.alertDebounce.findUnique.mockResolvedValue(null);
  prismaMock.alertDebounce.upsert.mockResolvedValue({});
});

describe('runSafetyAlertsSweep', () => {
  it('opens a ROUTE_DEVIATION escalation and debounces it when the rider is persistently off-route', async () => {
    const r = await runSafetyAlertsSweep(NOW, ONLY_ROUTE);
    expect(prismaMock.orderEscalation.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.orderEscalation.create.mock.calls[0][0].data).toMatchObject({ orderId: 'order-1', type: 'ROUTE_DEVIATION', severity: 'MEDIUM' });
    expect(prismaMock.alertDebounce.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { entityType_entityId_kind: { entityType: 'RiderAssignment', entityId: 'asg-1', kind: 'safety:ROUTE_DEVIATION' } },
    }));
    expect(r.alerted).toBe(1);
    expect(r.byType.ROUTE_DEVIATION).toBe(1);
  });

  it('auto-resolves (does not create) when the rider is back on track', async () => {
    prismaMock.$queryRaw.mockResolvedValue([fixRow(ON)]);
    const r = await runSafetyAlertsSweep(NOW, ONLY_ROUTE);
    expect(prismaMock.orderEscalation.create).not.toHaveBeenCalled();
    // resolve() ran for ROUTE_DEVIATION (plus the terminal-order cleanup updateMany).
    expect(prismaMock.orderEscalation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ orderId: 'order-1', type: 'ROUTE_DEVIATION' }),
      data: expect.objectContaining({ status: 'RESOLVED', resolvedBy: 'auto' }),
    }));
    expect(r.alerted).toBe(0);
  });

  it('debounces: no new escalation within the cooldown window', async () => {
    prismaMock.alertDebounce.findUnique.mockResolvedValue({ lastSentAt: ago(5) });
    const r = await runSafetyAlertsSweep(NOW, ONLY_ROUTE);
    expect(prismaMock.orderEscalation.create).not.toHaveBeenCalled();
    expect(r.debounced).toBe(1);
  });

  it('does not open a second escalation when one is already OPEN', async () => {
    prismaMock.orderEscalation.findFirst.mockResolvedValue({ id: 'existing' });
    const r = await runSafetyAlertsSweep(NOW, ONLY_ROUTE);
    expect(prismaMock.orderEscalation.create).not.toHaveBeenCalled();
    expect(r.alerted).toBe(0);
  });

  it('when a type is toggled off it never creates and resolves any stragglers', async () => {
    const allOff: SafetyAlertSettings = {
      routeDeviation: { enabled: false, minutes: 3, metres: 300 },
      etaBreach: { enabled: false, minutes: 15 },
      longWaitAtRestaurant: { enabled: false, minutes: 12 },
      signalLoss: { enabled: false, minutes: 10 },
    };
    const r = await runSafetyAlertsSweep(NOW, allOff);
    expect(prismaMock.orderEscalation.create).not.toHaveBeenCalled();
    expect(r.alerted).toBe(0);
    // A resolve updateMany ran for each disabled type.
    expect(prismaMock.orderEscalation.updateMany).toHaveBeenCalled();
  });

  it('fires SIGNAL_LOST when there is no recent fix', async () => {
    prismaMock.$queryRaw.mockResolvedValue([fixRow(null)]);
    const cfg: SafetyAlertSettings = {
      routeDeviation: { enabled: false, minutes: 3, metres: 300 },
      etaBreach: { enabled: false, minutes: 15 },
      longWaitAtRestaurant: { enabled: false, minutes: 12 },
      signalLoss: { enabled: true, minutes: 10 },
    };
    await runSafetyAlertsSweep(NOW, cfg);
    expect(prismaMock.orderEscalation.create.mock.calls[0][0].data).toMatchObject({ type: 'SIGNAL_LOST' });
  });
});
