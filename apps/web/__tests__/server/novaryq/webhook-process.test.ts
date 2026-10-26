/**
 * Async processing of stored Novaryq webhook events (worker + inline path):
 * routing by payload, availability (86/un-86) with stale guard and location check,
 * order status hand-off to the §3 table, retry/backoff and dead-lettering.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  links: [] as any[],
  locs: [] as any[],
  linkGuard: 1,
  itemUpdates: [] as any[],
  eventUpdates: [] as any[],
  statusCalls: [] as any[],
  statusResult: 'applied' as any,
  statusThrows: null as Error | null,
  syncByNq: null as any,
  alerts: [] as any[],
}));

vi.mock('@/server/db', () => {
  const prisma: any = {
    novaryqItemLink: {
      findMany: vi.fn(async () => h.links),
      updateMany: vi.fn(async () => ({ count: h.linkGuard })),
    },
    novaryqLocationLink: { findMany: vi.fn(async ({ where }: any) => h.locs.filter((l) => l.novaryqLocationId === where.novaryqLocationId)) },
    menuItem: { update: vi.fn(async (a: any) => { h.itemUpdates.push(a); return {}; }) },
    novaryqWebhookEvent: {
      updateMany: vi.fn(async (a: any) => { h.eventUpdates.push(a); return { count: 1 }; }),
      deleteMany: vi.fn(async (a: any) => { h.eventUpdates.push(a); return { count: 4 }; }),
    },
    novaryqOrderSync: { findFirst: vi.fn(async () => h.syncByNq) },
  };
  return { prisma, db: prisma };
});
vi.mock('@/server/novaryq/status', () => ({
  applyOrderStatusEvent: vi.fn(async (e: any) => {
    h.statusCalls.push(e);
    if (h.statusThrows) throw h.statusThrows;
    return h.statusResult;
  }),
}));
// Processing applies only while the integration is enabled (see independence.test.ts).
vi.mock('@/server/novaryq/config', async (orig) => ({ ...(await orig<any>()), loadNovaryqConfig: vi.fn(async () => ({ enabled: true })) }));
vi.mock('@/server/novaryq/alerts', () => ({ sendNovaryqAlert: vi.fn(async (a: any) => { h.alerts.push(a); }) }));

import { handleClaimedEvent, routeNovaryqEvent, pruneNovaryqWebhookEvents } from '@/server/novaryq/webhook';
import { applyAvailabilityEvent } from '@/server/novaryq/menu';

const ev = (event: string, payload: any, attempts = 1) => ({
  id: 'e1', restaurantId: 'r1', deliveryId: 'r1:d1', event, attempts, receivedAt: new Date('2026-10-25T10:00:05Z'),
  payload: { id: 'evt', eventType: event, occurredAt: '2026-10-25T10:00:00Z', payload },
});

beforeEach(() => {
  vi.stubEnv('NOVARYQ_INTEGRATION_ENABLED', 'true');
  h.links = [{ id: 'l1', menuItemId: 'm1', menuItem: { branchId: 'b1', isAvailable: true } }];
  h.locs = [{ branchId: 'b1', novaryqLocationId: 'loc_1' }, { branchId: 'b2', novaryqLocationId: 'loc_2' }];
  h.linkGuard = 1;
  h.itemUpdates = [];
  h.eventUpdates = [];
  h.statusCalls = [];
  h.statusResult = 'applied';
  h.statusThrows = null;
  h.syncByNq = null;
  h.alerts = [];
});

describe('applyAvailabilityEvent', () => {
  it('86 → MenuItem unavailable', async () => {
    expect(await applyAvailabilityEvent({ restaurantId: 'r1', itemCode: 'SKU-1', available: false, locationId: 'loc_1', occurredAt: new Date() })).toBe('applied');
    expect(h.itemUpdates[0]).toEqual({ where: { id: 'm1' }, data: { isAvailable: false } });
  });
  it('un-86 → available again; no write when already in that state', async () => {
    h.links[0].menuItem.isAvailable = false;
    expect(await applyAvailabilityEvent({ restaurantId: 'r1', itemCode: 'SKU-1', available: true, locationId: null, occurredAt: new Date() })).toBe('applied');
    h.links[0].menuItem.isAvailable = true;
    expect(await applyAvailabilityEvent({ restaurantId: 'r1', itemCode: 'SKU-1', available: true, locationId: null, occurredAt: new Date() })).toBe('noop');
    expect(h.itemUpdates).toHaveLength(1);
  });
  it('unlinked code, another location, or an out-of-order (older) event changes nothing', async () => {
    const linked = h.links;
    h.links = [];
    expect(await applyAvailabilityEvent({ restaurantId: 'r1', itemCode: 'X', available: false, locationId: null, occurredAt: new Date() })).toBe('ignored:unlinked');
    h.links = linked;
    expect(await applyAvailabilityEvent({ restaurantId: 'r1', itemCode: 'SKU-1', available: false, locationId: 'loc_2', occurredAt: new Date() })).toBe('ignored:other_location');
    h.linkGuard = 0;
    expect(await applyAvailabilityEvent({ restaurantId: 'r1', itemCode: 'SKU-1', available: false, locationId: 'loc_1', occurredAt: new Date() })).toBe('ignored:stale');
    expect(h.itemUpdates).toHaveLength(0);
  });
});

describe('applyAvailabilityEvent — one Novaryq code across branches (QA-C1)', () => {
  beforeEach(() => {
    h.links = [
      { id: 'l1', menuItemId: 'm1', menuItem: { branchId: 'b1', isAvailable: true } },
      { id: 'l2', menuItemId: 'm2', menuItem: { branchId: 'b2', isAvailable: true } },
    ];
  });
  it('a tenant-wide 86 (locationId null) flips every linked branch item', async () => {
    await applyAvailabilityEvent({ restaurantId: 'r1', itemCode: 'SKU-1', available: false, locationId: null, occurredAt: new Date() });
    expect(h.itemUpdates.map((u) => u.where.id)).toEqual(['m1', 'm2']);
  });
  it('a location-scoped 86 flips only the branch linked to that location', async () => {
    await applyAvailabilityEvent({ restaurantId: 'r1', itemCode: 'SKU-1', available: false, locationId: 'loc_2', occurredAt: new Date() });
    expect(h.itemUpdates.map((u) => u.where.id)).toEqual(['m2']);
  });
});

describe('routeNovaryqEvent', () => {
  it('menu.item.86ed (envelope payload) → availability', async () => {
    expect(await routeNovaryqEvent(ev('menu.item.86ed', { itemCode: 'SKU-1', menuItemId: 'mi', available: false, locationId: null }) as any)).toBe('applied');
    expect(h.itemUpdates[0].data).toEqual({ isAvailable: false });
  });

  it('order.status_changed → §3 with externalRef, status and the envelope occurredAt fallback', async () => {
    await routeNovaryqEvent(ev('order.status_changed', { orderId: 'nq_1', externalRef: 'o1', source: 'flavrly', status: 'READY' }) as any);
    expect(h.statusCalls[0]).toEqual({ restaurantId: 'r1', externalRef: 'o1', orderId: 'nq_1', status: 'READY', occurredAt: '2026-10-25T10:00:00Z' });
  });

  it('events from another source are ignored; missing externalRef resolves via the Novaryq order id', async () => {
    expect(await routeNovaryqEvent(ev('order.status_changed', { orderId: 'nq_1', externalRef: 'o1', source: 'kiosk', status: 'READY' }) as any)).toBe('ignored:other_source');
    h.syncByNq = { orderId: 'o9' };
    await routeNovaryqEvent(ev('order.status_changed', { orderId: 'nq_9', status: 'SENT', occurredAt: '2026-10-25T11:00:00Z' }) as any);
    expect(h.statusCalls[0]).toMatchObject({ externalRef: 'o9', status: 'SENT', occurredAt: '2026-10-25T11:00:00Z' });
  });

  it('reads the NQ-1.5 envelope `data` and handles menu.item.restored without `available`', async () => {
    const e = ev('menu.item.restored', {});
    (e.payload as any) = { eventId: 'x', id: 'x', eventType: 'menu.item.restored', occurredAt: '2026-10-25T10:00:00Z', data: { itemCode: 'SKU-1', locationId: null } };
    h.links[0].menuItem.isAvailable = false;
    expect(await routeNovaryqEvent(e as any)).toBe('applied');
    expect(h.itemUpdates[0].data).toEqual({ isAvailable: true });
  });

  it('legacy alias deliveries (order.sent / order.updated / order.closed) are stored and ignored (NQ-2)', async () => {
    for (const name of ['order.sent', 'order.updated', 'order.closed']) {
      expect(await routeNovaryqEvent(ev(name, { orderId: 'nq_1', externalRef: 'o1', status: 'SENT' }) as any)).toBe('ignored:unhandled');
    }
    expect(h.statusCalls).toEqual([]);
  });

  it('webhook.test is recorded as a test delivery', async () => {
    expect(await routeNovaryqEvent(ev('webhook.test', { message: 'hi', subscriptionId: 's' }) as any)).toBe('test_received');
  });

  it('unrelated events are acknowledged and ignored', async () => {
    expect(await routeNovaryqEvent(ev('payment.succeeded', { paymentId: 'p' }) as any)).toBe('ignored:unhandled');
  });
});

describe('pruneNovaryqWebhookEvents (QA-F5)', () => {
  it('deletes processed events older than 30 days only', async () => {
    expect(await pruneNovaryqWebhookEvents()).toEqual({ deleted: 4 });
    const where = h.eventUpdates[0].where;
    expect(where.processedAt.lt.getTime()).toBeLessThanOrEqual(Date.now() - 30 * 86_400_000 + 1000);
    expect(where.processedAt.not).toBeNull();
  });
});

describe('handleClaimedEvent', () => {
  it('success → processedAt set, fenced on the claimed attempt', async () => {
    await handleClaimedEvent(ev('order.status_changed', { orderId: 'nq_1', externalRef: 'o1', status: 'READY' }) as any);
    expect(h.eventUpdates[0].where).toEqual({ id: 'e1', attempts: 1, processedAt: null });
    expect(h.eventUpdates[0].data.processedAt).toBeInstanceOf(Date);
    expect(h.eventUpdates[0].data.error).toBeNull();
  });

  it('failure → retried with backoff', async () => {
    h.statusThrows = new Error('Order was changed concurrently; please retry.');
    const before = Date.now();
    await handleClaimedEvent(ev('order.status_changed', { orderId: 'nq_1', externalRef: 'o1', status: 'READY' }, 2) as any);
    const u = h.eventUpdates[0];
    expect(u.data.processedAt).toBeUndefined();
    expect(u.data.error).toContain('concurrently');
    expect(u.data.nextAttemptAt.getTime() - before).toBeGreaterThanOrEqual(119_000);
  });

  it('8th failure → dead-lettered (processed with error) + alert', async () => {
    h.statusThrows = new Error('boom');
    await handleClaimedEvent(ev('order.status_changed', { orderId: 'nq_1', externalRef: 'o1', status: 'READY' }, 8) as any);
    expect(h.eventUpdates[0].data.processedAt).toBeInstanceOf(Date);
    expect(h.eventUpdates[0].data.error).toMatch(/^dead: boom/);
    expect(h.alerts[0]).toMatchObject({ kind: 'webhook_dead' });
  });
});
