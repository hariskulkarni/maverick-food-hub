/**
 * Owner requirement: the integration (orders, status and availability) works ONLY when enabled.
 * When NOVARYQ_INTEGRATION_ENABLED is off, or the restaurant's integration is disabled / not
 * configured, Flavrly and Novaryq run fully independently: no outbox rows, no call to Novaryq,
 * no Flavrly order or menu change caused by Novaryq.
 *
 * The db stub throws on ANY access unless a test opts a model in, proving "touches nothing".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  cfg: null as any,
  allowed: {} as Record<string, any>,
  accessed: [] as string[],
  statusCalls: [] as any[],
  availabilityCalls: [] as any[],
}));

vi.mock('@/server/db', () => {
  const prisma = new Proxy({}, {
    get(_t, model: string) {
      if (h.allowed[model]) return h.allowed[model];
      return new Proxy({}, { get(_x, op: string) { return () => { h.accessed.push(`${model}.${op}`); throw new Error(`unexpected db access ${model}.${op}`); }; } });
    },
  });
  return { prisma, db: prisma };
});
vi.mock('@/server/novaryq/config', async (orig) => ({ ...(await orig<any>()), loadNovaryqConfig: vi.fn(async () => h.cfg) }));
vi.mock('@/server/novaryq/status', async (orig) => ({
  ...(await orig<any>()),
  applyOrderStatusEvent: vi.fn(async (e: any) => { h.statusCalls.push(e); return 'applied'; }),
}));
vi.mock('@/server/novaryq/menu', async (orig) => ({
  ...(await orig<any>()),
  applyAvailabilityEvent: vi.fn(async (e: any) => { h.availabilityCalls.push(e); return 'applied'; }),
}));
vi.mock('@/server/novaryq/alerts', () => ({ sendNovaryqAlert: vi.fn(async () => {}) }));
vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }));

import { enqueueNovaryqCancel, enqueueNovaryqPush, processClaimed } from '@/server/novaryq/push';
import { handleClaimedEvent } from '@/server/novaryq/webhook';
import { runNovaryqStatusPoll, pollStaleOrderStatuses } from '@/server/novaryq/status';
import { runNovaryqReconcile, reconcileRestaurant } from '@/server/novaryq/menu';

const ENABLED = { baseUrl: 'https://pos.example.com', clientId: 'c', secret: 's', webhookSecret: 'w', enabled: true, pushOn: 'RECEIVED' };
const strictTx = () =>
  new Proxy({}, { get(_t, model: string) { return new Proxy({}, { get(_x, op: string) { return () => { h.accessed.push(`tx.${model}.${op}`); throw new Error('tx touched'); }; } }); } }) as any;
const statusEvent = { id: 'e1', restaurantId: 'r1', deliveryId: 'r1:d1', event: 'order.status_changed', attempts: 1, receivedAt: new Date(),
  payload: { data: { orderId: 'nq1', externalRef: 'o1', source: 'flavrly', status: 'READY', occurredAt: '2026-10-26T10:00:00Z' } } };
const availabilityEvent = { ...statusEvent, id: 'e2', event: 'menu.item.86ed', payload: { data: { itemCode: 'SKU-1', available: false, locationId: null } } };

beforeEach(() => {
  h.cfg = { ...ENABLED };
  h.allowed = {};
  h.accessed = [];
  h.statusCalls = [];
  h.availabilityCalls = [];
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Novaryq must not be called'); }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('platform flag OFF → Flavrly and Novaryq are independent', () => {
  beforeEach(() => vi.stubEnv('NOVARYQ_INTEGRATION_ENABLED', 'false'));

  it('placing / receiving / cancelling a Flavrly order queues nothing (the order transaction is not touched)', async () => {
    expect(await enqueueNovaryqPush(strictTx(), 'o1', 'b1')).toBe(false);
    await enqueueNovaryqCancel(strictTx(), 'o1');
    expect(h.accessed).toEqual([]);
  });

  it('status poll and menu/availability reconcile do nothing and call nothing', async () => {
    expect(await runNovaryqStatusPoll()).toEqual({ restaurants: 0, polled: 0, applied: 0, errors: 0 });
    expect(await runNovaryqReconcile()).toEqual({ restaurants: 0, changed: 0, errors: 0 });
    // (unrelated modules loaded by the import graph may run their own timers; only our models matter)
    expect(h.accessed.filter((a) => /^(novaryq|order|menuItem|tx\.)/i.test(a))).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a webhook event stored earlier is NOT applied to Flavrly orders or menu', async () => {
    const updates: any[] = [];
    h.allowed.novaryqWebhookEvent = { updateMany: vi.fn(async (a: any) => { updates.push(a); return { count: 1 }; }) };
    await handleClaimedEvent(statusEvent as any);
    await handleClaimedEvent(availabilityEvent as any);
    expect(h.statusCalls).toEqual([]);
    expect(h.availabilityCalls).toEqual([]);
    expect(updates.map((u) => u.data.error)).toEqual(['ignored:disabled', 'ignored:disabled']);
  });
});

describe('restaurant integration disabled / not configured (flag ON) → independent for that restaurant', () => {
  beforeEach(() => vi.stubEnv('NOVARYQ_INTEGRATION_ENABLED', 'true'));

  for (const [name, cfg] of [['disabled', { ...ENABLED, enabled: false }], ['not configured', null]] as const) {
    describe(name, () => {
      beforeEach(() => { h.cfg = cfg; });

      it('a received order of a linked branch queues no push', async () => {
        const createMany = vi.fn();
        const tx = { novaryqLocationLink: { findUnique: vi.fn(async () => ({ restaurantId: 'r1' })) }, novaryqOrderSync: { createMany } };
        expect(await enqueueNovaryqPush(tx as any, 'o1', 'b1')).toBe(false);
        expect(createMany).not.toHaveBeenCalled();
      });

      it('an already-queued push/cancel never calls Novaryq', async () => {
        h.allowed.novaryqOrderSync = { updateMany: vi.fn(async () => ({ count: 1 })) };
        await processClaimed({ id: 's1', orderId: 'o1', restaurantId: 'r1', state: 'PENDING', attempts: 1, novaryqOrderId: null }, 'owner');
        await processClaimed({ id: 's2', orderId: 'o2', restaurantId: 'r1', state: 'CANCEL_PENDING', attempts: 1, novaryqOrderId: 'nq2' }, 'owner');
        expect(fetch).not.toHaveBeenCalled();
      });

      it('stored status / 86 events are not applied to Flavrly', async () => {
        h.allowed.novaryqWebhookEvent = { updateMany: vi.fn(async () => ({ count: 1 })) };
        await handleClaimedEvent(statusEvent as any);
        await handleClaimedEvent(availabilityEvent as any);
        expect(h.statusCalls).toEqual([]);
        expect(h.availabilityCalls).toEqual([]);
      });

      it('no status poll and no availability reconcile for it', async () => {
        expect(await pollStaleOrderStatuses('r1')).toEqual({ polled: 0, applied: 0, errors: 0 });
        expect(await reconcileRestaurant('r1')).toEqual({ checked: 0, changed: 0, missing: 0 });
        expect(fetch).not.toHaveBeenCalled();
      });
    });
  }
});

describe('enabled → the integration does act (control)', () => {
  it('a stored status event is applied', async () => {
    vi.stubEnv('NOVARYQ_INTEGRATION_ENABLED', 'true');
    h.allowed.novaryqWebhookEvent = { updateMany: vi.fn(async () => ({ count: 1 })) };
    await handleClaimedEvent(statusEvent as any);
    expect(h.statusCalls).toHaveLength(1);
  });
});
