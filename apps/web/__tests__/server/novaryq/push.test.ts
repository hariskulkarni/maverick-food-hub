/**
 * CONTRACT §5 push + cancel: outbox enqueue hooks, §2.1 payload, idempotent create,
 * backoff 30s→2m→10m→30m→2h, 8 attempts then DEAD + alert, unmapped → FAILED + alert,
 * cancel sync, manual replay. The claim/lease SQL is proven on real Postgres in tests/db.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  cfg: null as any,
  order: null as any,
  links: [] as any[],
  updates: [] as Array<{ where: any; data: any }>,
  updateCount: 1,
  created: [] as any[],
  alerts: [] as any[],
  fetches: [] as Array<{ url: string; init: any }>,
  respond: (_url: string, _init: any): Response => new Response('{}', { status: 500 }),
  syncRow: null as any,
  audits: [] as any[],
}));

// The base-URL guard resolves the host on every call; keep unit tests off the network.
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) }));
vi.mock('@/server/db', () => {
  const prisma: any = {
    order: { findUnique: vi.fn(async () => h.order) },
    novaryqItemLink: { findMany: vi.fn(async () => h.links) },
    novaryqOrderSync: {
      updateMany: vi.fn(async (args: any) => { h.updates.push(args); return { count: h.updateCount }; }),
      findFirst: vi.fn(async () => h.syncRow),
    },
  };
  return { prisma, db: prisma };
});
vi.mock('@/server/novaryq/config', async (orig) => ({
  ...(await orig<any>()),
  loadNovaryqConfig: vi.fn(async () => h.cfg),
}));
vi.mock('@/server/novaryq/alerts', () => ({ sendNovaryqAlert: vi.fn(async (a: any) => { h.alerts.push(a); }) }));
vi.mock('@/server/audit', () => ({ audit: vi.fn(async (...a: any[]) => { h.audits.push(a); }) }));

import {
  buildOrderPayload,
  pushBackoffMs,
  processClaimed,
  enqueueNovaryqPush,
  enqueueNovaryqCancel,
  replaySync,
  PUSH_MAX_ATTEMPTS,
} from '@/server/novaryq/push';

const OWNER = 'owner-1';
const row = (over: any = {}) => ({ id: 's1', orderId: 'o1', restaurantId: 'r1', state: 'PENDING', attempts: 1, novaryqOrderId: null, ...over });

function baseOrder(over: any = {}) {
  return {
    id: 'o1', code: 'ORD-AB12CD', status: 'RECEIVED', fulfillmentType: 'DELIVERY', paymentMethod: 'COD',
    subtotal: 528, discountAmount: 50, deliveryFee: 30, packagingFee: 10, taxAmount: 26.4, total: 544.4,
    customerNotes: 'ring twice',
    customer: { name: 'Asha', phone: '+919800000000' },
    address: { line1: '12 MG Road', line2: null, landmark: 'Near park', city: 'Pune', postalCode: '411001' },
    branch: { restaurantId: 'r1', novaryqLink: { novaryqLocationId: 'loc_1', currency: 'INR' } },
    items: [
      { menuItemId: 'm1', comboId: null, name: 'Paneer Tikka', quantity: 2, unitPrice: 249, notes: 'less spicy', isFreebie: false, selectedVariantName: 'Full', modifiersSummary: 'Extra cheese, No onion' },
      { menuItemId: 'm2', comboId: null, name: 'Lassi', quantity: 1, unitPrice: 30, notes: null, isFreebie: false, selectedVariantName: null, modifiersSummary: null },
    ],
    ...over,
  };
}

beforeEach(() => {
  vi.stubEnv('NOVARYQ_INTEGRATION_ENABLED', 'true');
  h.cfg = { baseUrl: 'https://pos.example.com', clientId: 'nq_test', secret: 's', webhookSecret: 'w', enabled: true, pushOn: 'RECEIVED', webhookSubscriptionId: '' };
  h.order = baseOrder();
  h.links = [{ menuItemId: 'm1', novaryqItemCode: 'SKU-1' }, { menuItemId: 'm2', novaryqItemCode: 'SKU-2' }];
  h.updates = [];
  h.updateCount = 1;
  h.created = [];
  h.alerts = [];
  h.fetches = [];
  h.audits = [];
  h.syncRow = null;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => { h.fetches.push({ url, init }); return h.respond(url, init); }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('pushBackoffMs', () => {
  it('30s → 2m → 10m → 30m → 2h, then stays at 2h', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(pushBackoffMs)).toEqual([30_000, 120_000, 600_000, 1_800_000, 7_200_000, 7_200_000, 7_200_000]);
    expect(PUSH_MAX_ATTEMPTS).toBe(8);
  });
});

describe('buildOrderPayload (§2.1)', () => {
  it('maps the order at Flavrly prices with externalRef = Order.id', () => {
    const r = buildOrderPayload(baseOrder() as any, 'loc_1', new Map([['m1', 'SKU-1'], ['m2', 'SKU-2']]));
    expect('payload' in r).toBe(true);
    const p = (r as any).payload;
    expect(p).toMatchObject({
      locationId: 'loc_1', serviceMode: 'DELIVERY', source: 'flavrly', externalRef: 'o1', externalCode: 'ORD-AB12CD',
      customer: { name: 'Asha', phone: '+919800000000' }, currency: 'INR', notes: 'ring twice',
      totals: { subtotal: '528.00', discount: '50.00', deliveryFee: '30.00', packagingFee: '10.00', tax: '26.40', grandTotal: '544.40' },
      payment: { status: 'UNPAID', method: 'COD', amount: '544.40' },
    });
    expect(p.deliveryAddress).toBe('12 MG Road, Near park, Pune 411001');
    expect(p.lines[0]).toEqual({
      itemCode: 'SKU-1', quantity: 2, unitPrice: '249.00', notes: 'less spicy',
      modifiers: [
        { name: 'Full', unitPrice: '0.00', quantity: 1 },
        { name: 'Extra cheese', unitPrice: '0.00', quantity: 1 },
        { name: 'No onion', unitPrice: '0.00', quantity: 1 },
      ],
    });
    expect(p.lines[1]).toEqual({ itemCode: 'SKU-2', quantity: 1, unitPrice: '30.00' });
  });

  it('wallet / loyalty / signup-bonus credits fold into discount; amount due is Order.total (QA-C3)', () => {
    const o = baseOrder({ walletApplied: 100, loyaltyApplied: 20, signupBonusApplied: 0, total: 424.4 });
    const p = (buildOrderPayload(o as any, 'loc_1', new Map([['m1', 'A'], ['m2', 'B']])) as any).payload;
    expect(p.totals).toMatchObject({ discount: '170.00', grandTotal: '424.40' });
    expect(p.payment).toEqual({ status: 'UNPAID', method: 'COD', amount: '424.40' });
    const t = p.totals;
    expect((+t.subtotal - +t.discount + +t.deliveryFee + +t.packagingFee + +t.tax).toFixed(2)).toBe(t.grandTotal);
  });

  it('online-paid → PREPAID; pickup → TAKEOUT without a delivery address; dine-in → DINE_IN', () => {
    const pick = (buildOrderPayload(baseOrder({ paymentMethod: 'PHONEPE', fulfillmentType: 'PICKUP' }) as any, 'loc_1', new Map([['m1', 'A'], ['m2', 'B']])) as any).payload;
    expect(pick.serviceMode).toBe('TAKEOUT');
    expect(pick.payment).toEqual({ status: 'PREPAID', method: 'PHONEPE', amount: '544.40' });
    expect(pick.deliveryAddress).toBeUndefined();
    const dine = (buildOrderPayload(baseOrder({ fulfillmentType: 'DINE_IN' }) as any, 'loc_1', new Map([['m1', 'A'], ['m2', 'B']])) as any).payload;
    expect(dine.serviceMode).toBe('DINE_IN');
  });

  it('lists every unmapped line (unlinked items and combos)', () => {
    const o = baseOrder();
    o.items.push({ menuItemId: null, comboId: 'c1', name: 'Family Combo', quantity: 1, unitPrice: 499, notes: null, isFreebie: false, selectedVariantName: null, modifiersSummary: null } as any);
    expect(buildOrderPayload(o as any, 'loc_1', new Map([['m1', 'SKU-1']]))).toEqual({ unmapped: ['Lassi', 'Family Combo'] });
  });
});

describe('enqueue hooks (transactional outbox)', () => {
  const tx = () => ({
    novaryqLocationLink: { findUnique: vi.fn(async () => ({ restaurantId: 'r1' })) },
    novaryqOrderSync: { createMany: vi.fn(async () => ({ count: 1 })), updateMany: vi.fn(async () => ({ count: 1 })) },
  });

  it('flag off → touches nothing', async () => {
    vi.stubEnv('NOVARYQ_INTEGRATION_ENABLED', 'false');
    const t = tx();
    expect(await enqueueNovaryqPush(t as any, 'o1', 'b1')).toBe(false);
    await enqueueNovaryqCancel(t as any, 'o1');
    expect(t.novaryqLocationLink.findUnique).not.toHaveBeenCalled();
    expect(t.novaryqOrderSync.updateMany).not.toHaveBeenCalled();
  });

  it('unmapped branch or disabled restaurant → no row', async () => {
    const t = tx();
    t.novaryqLocationLink.findUnique.mockResolvedValueOnce(null as any);
    expect(await enqueueNovaryqPush(t as any, 'o1', 'b1')).toBe(false);
    h.cfg = { ...h.cfg, enabled: false };
    expect(await enqueueNovaryqPush(t as any, 'o1', 'b1')).toBe(false);
    expect(t.novaryqOrderSync.createMany).not.toHaveBeenCalled();
  });

  it('linked + enabled → one idempotent outbox row (skipDuplicates)', async () => {
    const t = tx();
    expect(await enqueueNovaryqPush(t as any, 'o1', 'b1')).toBe(true);
    expect(t.novaryqOrderSync.createMany).toHaveBeenCalledWith({ data: [{ orderId: 'o1', restaurantId: 'r1' }], skipDuplicates: true });
  });

  it('cancel: a POS-voided order closes locally; otherwise CANCEL_PENDING, due now, attempts reset', async () => {
    const t = tx();
    await enqueueNovaryqCancel(t as any, 'o1');
    const [voided, pending] = t.novaryqOrderSync.updateMany.mock.calls.map((c: any) => c[0]);
    expect(voided.where).toMatchObject({ orderId: 'o1', lastStatus: 'VOIDED' });
    expect(voided.data.state).toBe('CANCELLED');
    expect(pending.where).toMatchObject({ orderId: 'o1', state: { in: ['PENDING', 'SENT', 'FAILED', 'DEAD'] } });
    expect(pending.data).toMatchObject({ state: 'CANCEL_PENDING', attempts: 0, lastError: null });
  });
});

describe('processClaimed — push', () => {
  it('201 → SENT with the Novaryq id/number (fenced on the lease owner); request is §2.1', async () => {
    h.respond = () => new Response(JSON.stringify({ id: 'nq_1', orderNumber: 42, idempotentReplay: false }), { status: 201 });
    expect(await processClaimed(row(), OWNER)).toBe('sent');
    expect(h.fetches).toHaveLength(1);
    expect(h.fetches[0].url).toBe('https://pos.example.com/api/v1/orders');
    expect(JSON.parse(h.fetches[0].init.body)).toMatchObject({ externalRef: 'o1', source: 'flavrly', locationId: 'loc_1' });
    expect(h.updates[0]).toEqual({
      where: { id: 's1', leaseOwner: OWNER, state: 'PENDING' },
      data: { state: 'SENT', novaryqOrderId: 'nq_1', novaryqOrderNumber: '42', leaseOwner: null, leaseExpiresAt: null, lastError: null },
    });
  });

  it('idempotent replay (200) is also SENT — never a duplicate', async () => {
    h.respond = () => new Response(JSON.stringify({ id: 'nq_1', orderNumber: 42, idempotentReplay: true }), { status: 200 });
    expect(await processClaimed(row({ attempts: 3 }), OWNER)).toBe('sent');
    expect(h.updates[0].data.state).toBe('SENT');
  });

  it('unmapped items → FAILED with the list + restaurant alert, nothing sent', async () => {
    h.links = [{ menuItemId: 'm1', novaryqItemCode: 'SKU-1' }];
    expect(await processClaimed(row(), OWNER)).toBe('failed');
    expect(h.fetches).toHaveLength(0);
    expect(h.updates[0].data).toMatchObject({ state: 'FAILED', lastError: 'Unmapped items: Lassi' });
    expect(h.alerts[0]).toMatchObject({ restaurantId: 'r1', kind: 'push_failed' });
  });

  it('422 unknown item codes → FAILED (no retry) + alert', async () => {
    h.respond = () => new Response(JSON.stringify({ statusCode: 422, message: 'Unknown item codes', unknownItemCodes: ['SKU-2'] }), { status: 422 });
    expect(await processClaimed(row(), OWNER)).toBe('failed');
    expect(h.updates[0].data.state).toBe('FAILED');
    expect(h.updates[0].data.lastError).toContain('SKU-2');
    expect(h.alerts).toHaveLength(1);
  });

  it('5xx on attempt 1 → retry in 30s, lease released', async () => {
    h.respond = () => new Response('down', { status: 503 });
    const before = Date.now();
    expect(await processClaimed(row({ attempts: 1 }), OWNER)).toBe('retried');
    const u = h.updates[0];
    expect(u.where).toEqual({ id: 's1', leaseOwner: OWNER, state: 'PENDING' });
    expect(u.data.leaseOwner).toBeNull();
    const delay = u.data.nextAttemptAt.getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(29_000);
    expect(delay).toBeLessThan(40_000);
  });

  it('429 honours a Retry-After longer than the backoff', async () => {
    h.respond = () => new Response('{}', { status: 429, headers: { 'Retry-After': '900' } });
    const before = Date.now();
    expect(await processClaimed(row({ attempts: 1 }), OWNER)).toBe('retried');
    expect(h.updates[0].data.nextAttemptAt.getTime() - before).toBeGreaterThanOrEqual(899_000);
  });

  it('a retryable failure on attempt 8 → DEAD + owner alert', async () => {
    h.respond = () => new Response('down', { status: 502 });
    expect(await processClaimed(row({ attempts: 8 }), OWNER)).toBe('dead');
    expect(h.updates[0].data.state).toBe('DEAD');
    expect(h.alerts[0]).toMatchObject({ kind: 'push_dead' });
  });

  it('DEAD alerts are throttled per restaurant (one per outage window), not per order (QA-F9)', async () => {
    h.respond = () => new Response('down', { status: 502 });
    await processClaimed(row({ attempts: 8 }), OWNER);
    await processClaimed(row({ id: 's2', orderId: 'o2', attempts: 8 }), OWNER);
    expect(h.alerts.map((a) => [a.entityId, a.windowMin])).toEqual([['r1', 60], ['r1', 60]]);
  });

  it('a transient DNS failure retries with backoff — no FAILED, no alert (QA-F9)', async () => {
    const dns = await import('node:dns/promises');
    (dns.lookup as any).mockRejectedValueOnce(Object.assign(new Error('getaddrinfo EAI_AGAIN pos.example.com'), { code: 'EAI_AGAIN' }));
    expect(await processClaimed(row({ attempts: 1 }), OWNER)).toBe('retried');
    expect(h.updates[0].data.state).toBeUndefined();
    expect(h.alerts).toEqual([]);
    expect(h.fetches).toHaveLength(0);
  });

  it('a crashed worker that burnt the budget is dead-lettered without another call', async () => {
    expect(await processClaimed(row({ attempts: 9 }), OWNER)).toBe('dead');
    expect(h.fetches).toHaveLength(0);
  });

  it('Novaryq down never touches the Flavrly order', async () => {
    h.respond = () => { throw new TypeError('fetch failed'); };
    await processClaimed(row(), OWNER);
    const { prisma } = await import('@/server/db');
    expect((prisma as any).order.update).toBeUndefined();
  });
});

describe('processClaimed — cancel', () => {
  it('known Novaryq id → POST /orders/:id/cancel with the mapped reason → CANCELLED', async () => {
    h.order = baseOrder({ status: 'CANCELLED_BY_CUSTOMER' });
    h.respond = () => new Response(JSON.stringify({ id: 'nq_1', status: 'VOIDED' }), { status: 200 });
    expect(await processClaimed(row({ state: 'CANCEL_PENDING', novaryqOrderId: 'nq_1' }), OWNER)).toBe('cancelled');
    expect(h.fetches[0].url).toBe('https://pos.example.com/api/v1/orders/nq_1/cancel');
    expect(JSON.parse(h.fetches[0].init.body)).toMatchObject({ reason: 'customer_cancelled' });
    expect(h.updates[0]).toMatchObject({ where: { id: 's1', leaseOwner: OWNER, state: 'CANCEL_PENDING' }, data: { state: 'CANCELLED' } });
  });

  it('unknown id → looks up by externalRef; not in Novaryq → CANCELLED without a cancel call', async () => {
    h.order = baseOrder({ status: 'CANCELLED_BY_ADMIN' });
    h.respond = (url) => {
      expect(url).toBe('https://pos.example.com/api/v1/orders?externalRef=o1&source=flavrly');
      return new Response(JSON.stringify({ data: [], page: 1, pageSize: 20, total: 0 }), { status: 200 });
    };
    expect(await processClaimed(row({ state: 'CANCEL_PENDING' }), OWNER)).toBe('cancelled');
    expect(h.fetches).toHaveLength(1);
  });

  it('POS refuses (e.g. already COMPLETED) → FAILED + alert', async () => {
    h.order = baseOrder({ status: 'CANCELLED_BY_RESTAURANT' });
    h.respond = () => new Response(JSON.stringify({ message: 'Order is COMPLETED' }), { status: 409 });
    expect(await processClaimed(row({ state: 'CANCEL_PENDING', novaryqOrderId: 'nq_1' }), OWNER)).toBe('failed');
    expect(h.alerts[0]).toMatchObject({ kind: 'cancel_failed' });
  });
});

describe('processClaimed — cancel refused by key ownership', () => {
  it('403 (order created by another API key) → FAILED at once, not retried', async () => {
    h.order = baseOrder({ status: 'CANCELLED_BY_CUSTOMER' });
    h.respond = () => new Response(JSON.stringify({ message: 'not created by this API key' }), { status: 403 });
    expect(await processClaimed(row({ state: 'CANCEL_PENDING', novaryqOrderId: 'nq_1' }), OWNER)).toBe('failed');
  });
});

describe('replaySync', () => {
  it('requeues a FAILED/DEAD row of the caller restaurant; a cancelled order replays as a cancel', async () => {
    h.syncRow = { id: 's1', restaurantId: 'r1', state: 'DEAD', order: { status: 'CANCELLED_BY_CUSTOMER' } };
    expect(await replaySync('r1', 's1', 'u1')).toEqual({ ok: true, state: 'CANCEL_PENDING' });
    expect(h.updates[0]).toMatchObject({ where: { id: 's1', restaurantId: 'r1', state: { in: ['FAILED', 'DEAD'] } }, data: { state: 'CANCEL_PENDING', attempts: 0, lastError: null } });
    expect(h.audits[0][0]).toBe('integration.novaryq.replay');
  });

  it('refuses a row that is not FAILED/DEAD or belongs to another restaurant', async () => {
    h.syncRow = null;
    expect(await replaySync('r1', 's1', 'u1')).toEqual({ ok: false, error: 'Not found' });
    h.syncRow = { id: 's1', restaurantId: 'r1', state: 'SENT', order: { status: 'RECEIVED' } };
    expect((await replaySync('r1', 's1', 'u1')).ok).toBe(false);
  });
});
