/**
 * Novaryq integration on real Postgres: outbox claim/lease SQL, exactly-once push
 * under concurrent workers, transactional enqueue on RECEIVED + cancel, webhook
 * dedupe under concurrent redelivery, and status application through the real
 * transitionOrder with the stale-event guard. Only the network (fetch to Novaryq)
 * and notification side effects are stubbed.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

vi.hoisted(() => {
  process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64'); // fake test key
  process.env.NOVARYQ_INTEGRATION_ENABLED = 'true';
  delete process.env.REDIS_URL;
});
// The base-URL guard resolves the host on every call; keep unit tests off the network.
vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }));
vi.mock('@/server/realtime', () => ({ publish: vi.fn() }));
vi.mock('@/server/notifications', () => ({ notify: { sms: vi.fn(async () => undefined), email: vi.fn(async () => undefined) } }));
vi.mock('@/server/push/milestones', () => ({ pushOrderMilestone: vi.fn(async () => undefined) }));
vi.mock('@/server/rider-push', () => ({ notifyRidersOfNewOrder: vi.fn(async () => undefined) }));
vi.mock('@/server/batch-dispatch', () => ({ maybeOfferAsBatch: vi.fn(async () => undefined) }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// The route's inline best-effort processing is switched off so the worker processes deterministically.
vi.mock('@/server/novaryq/webhook', async (orig) => ({ ...(await orig<any>()), processNovaryqDeliveryNow: vi.fn(async () => undefined) }));

import { OrderStatus, PaymentMethod } from '@prisma/client';
import { prisma } from '@/server/db';
import { saveConfig } from '@/server/integrations';
import { transitionOrder } from '@/server/orders';
import { enqueueNovaryqPush, runNovaryqPushWorker } from '@/server/novaryq/push';
import { runNovaryqWebhookWorker } from '@/server/novaryq/webhook';
import { importNovaryqMenu } from '@/server/novaryq/menu';
import { POST as webhookPOST } from '@/app/api/integrations/novaryq/webhook/[restaurantId]/route';
import { uid } from './fixtures';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const WHSEC = 'whsec_db_test';

let restaurantId = '';
let branchId = '';
let customerId = '';
let menuItemId = '';

/** Novaryq simulator: idempotent on externalRef, counts every POST /orders and cancel. */
const sim = { creates: new Map<string, number>(), cancels: [] as string[], ids: new Map<string, string>() };
function stubNovaryq() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    await sleep(3);
    const u = new URL(url);
    if (init.method === 'POST' && u.pathname === '/api/v1/orders') {
      const body = JSON.parse(String(init.body));
      sim.creates.set(body.externalRef, (sim.creates.get(body.externalRef) ?? 0) + 1);
      const replay = sim.ids.has(body.externalRef);
      if (!replay) sim.ids.set(body.externalRef, `nq_${sim.ids.size + 1}`);
      return new Response(JSON.stringify({ id: sim.ids.get(body.externalRef), orderNumber: sim.ids.size, idempotentReplay: replay }), { status: replay ? 200 : 201 });
    }
    const cancel = /^\/api\/v1\/orders\/([^/]+)\/cancel$/.exec(u.pathname);
    if (init.method === 'POST' && cancel) {
      sim.cancels.push(cancel[1]);
      return new Response(JSON.stringify({ id: cancel[1], status: 'VOIDED' }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }));
}

async function makeOrder(status: OrderStatus = OrderStatus.RECEIVED) {
  return prisma.order.create({
    data: {
      code: `ORD-${uid()}`, branchId, customerId, status, subtotal: '249.00', total: '249.00', paymentMethod: PaymentMethod.COD,
      items: { create: [{ name: 'Paneer Tikka', quantity: 1, unitPrice: '249.00', menuItemId }] },
    },
  });
}

async function enqueue(orderId: string) {
  return prisma.$transaction((tx) => enqueueNovaryqPush(tx, orderId, branchId));
}

beforeAll(async () => {
  const id = uid();
  const owner = await prisma.user.create({ data: { email: `nq-owner-${id}@example.test`, role: 'ADMIN' } });
  customerId = (await prisma.user.create({ data: { email: `nq-cust-${id}@example.test` } })).id;
  restaurantId = (await prisma.restaurant.create({ data: { slug: `nq-${id}`, name: `NQ ${id}`, ownerUserId: owner.id } })).id;
  branchId = (await prisma.branch.create({ data: { restaurantId, name: 'Main', slug: `nq-b-${id}`, line1: 'x', city: 'Pune', postalCode: '411001' } })).id;
  const cat = await prisma.category.create({ data: { branchId, name: 'Starters', slug: `s-${id}` } });
  menuItemId = (await prisma.menuItem.create({ data: { branchId, categoryId: cat.id, name: 'Paneer Tikka', slug: `pt-${id}`, price: '249.00' } })).id;
  await prisma.novaryqItemLink.create({ data: { restaurantId, menuItemId, novaryqItemCode: 'SKU-1' } });
  await prisma.novaryqLocationLink.create({ data: { restaurantId, branchId, novaryqLocationId: 'loc_1', currency: 'INR' } });
  await saveConfig(restaurantId, 'NOVARYQ', {
    baseUrl: 'https://pos.example.com', clientId: 'nq_test', secret: 'nqsec', webhookSecret: WHSEC, enabled: 'true', pushOn: 'RECEIVED',
  });
});

beforeEach(async () => {
  sim.creates.clear();
  sim.cancels = [];
  sim.ids.clear();
  stubNovaryq();
  await prisma.novaryqOrderSync.deleteMany({ where: { restaurantId } });
  await prisma.novaryqWebhookEvent.deleteMany({ where: { restaurantId } });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma.$disconnect();
});

describe('order push outbox', () => {
  it('enqueue is idempotent: one row per order', async () => {
    const o = await makeOrder();
    expect(await enqueue(o.id)).toBe(true);
    expect(await enqueue(o.id)).toBe(false);
    expect(await prisma.novaryqOrderSync.count({ where: { orderId: o.id } })).toBe(1);
  });

  it('three concurrent workers push every order exactly once', async () => {
    const orders = await Promise.all(Array.from({ length: 24 }, () => makeOrder()));
    for (const o of orders) await enqueue(o.id);
    const runs = await Promise.all([runNovaryqPushWorker({ batch: 4 }), runNovaryqPushWorker({ batch: 4 }), runNovaryqPushWorker({ batch: 4 })]);
    expect(runs.reduce((s, r) => s + r.claimed, 0)).toBe(24);
    expect(runs.reduce((s, r) => s + r.sent, 0)).toBe(24);
    for (const o of orders) expect(sim.creates.get(o.id)).toBe(1);
    const rows = await prisma.novaryqOrderSync.findMany({ where: { restaurantId } });
    expect(rows.every((r) => r.state === 'SENT' && r.novaryqOrderId && r.leaseOwner === null && r.attempts === 1)).toBe(true);
  });

  it('a leased row is not claimed until its lease expires; then it is re-pushed idempotently (no duplicate in POS)', async () => {
    const o = await makeOrder();
    await enqueue(o.id);
    sim.ids.set(o.id, 'nq_pre'); // the crashed worker's create had reached Novaryq
    await prisma.novaryqOrderSync.updateMany({
      where: { orderId: o.id },
      data: { leaseOwner: 'crashed', leaseExpiresAt: new Date(Date.now() + 60_000), attempts: 1 },
    });
    expect((await runNovaryqPushWorker()).claimed).toBe(0);
    await prisma.novaryqOrderSync.updateMany({ where: { orderId: o.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
    expect((await runNovaryqPushWorker()).sent).toBe(1);
    const row = await prisma.novaryqOrderSync.findUniqueOrThrow({ where: { orderId: o.id } });
    expect(row).toMatchObject({ state: 'SENT', novaryqOrderId: 'nq_pre', attempts: 2 });
  });

  it('Novaryq down: the Flavrly order is untouched and the row backs off 30 s', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const o = await makeOrder();
    await enqueue(o.id);
    const before = Date.now();
    expect((await runNovaryqPushWorker()).retried).toBe(1);
    const row = await prisma.novaryqOrderSync.findUniqueOrThrow({ where: { orderId: o.id } });
    expect(row.state).toBe('PENDING');
    expect(row.nextAttemptAt.getTime() - before).toBeGreaterThanOrEqual(29_000);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe(OrderStatus.RECEIVED);
  });

  it('transitionOrder: RECEIVED enqueues in the same transaction; cancelling a pushed order cancels it in Novaryq', async () => {
    const o = await makeOrder(OrderStatus.PAYMENT_PENDING);
    await transitionOrder(o.id, OrderStatus.RECEIVED);
    expect(await prisma.novaryqOrderSync.count({ where: { orderId: o.id } })).toBe(1);
    await runNovaryqPushWorker();
    await transitionOrder(o.id, OrderStatus.CANCELLED_BY_CUSTOMER);
    expect((await prisma.novaryqOrderSync.findUniqueOrThrow({ where: { orderId: o.id } })).state).toBe('CANCEL_PENDING');
    expect((await runNovaryqPushWorker()).cancelled).toBe(1);
    expect(sim.cancels).toEqual([sim.ids.get(o.id)]);
    expect((await prisma.novaryqOrderSync.findUniqueOrThrow({ where: { orderId: o.id } })).state).toBe('CANCELLED');
  });
});

describe('independence when not enabled (real order flow)', () => {
  afterEach(() => { process.env.NOVARYQ_INTEGRATION_ENABLED = 'true'; });

  it('flag off: a Flavrly order is received, accepted and cancelled normally with no Novaryq row and no call', async () => {
    process.env.NOVARYQ_INTEGRATION_ENABLED = 'false';
    const o = await makeOrder(OrderStatus.PAYMENT_PENDING);
    await transitionOrder(o.id, OrderStatus.RECEIVED);
    await transitionOrder(o.id, OrderStatus.ACCEPTED);
    await transitionOrder(o.id, OrderStatus.CANCELLED_BY_RESTAURANT);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe(OrderStatus.CANCELLED_BY_RESTAURANT);
    expect(await prisma.novaryqOrderSync.count({ where: { orderId: o.id } })).toBe(0);
    expect(await runNovaryqPushWorker()).toMatchObject({ claimed: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('flag off: cancelling an order pushed earlier leaves the Novaryq side untouched', async () => {
    const o = await makeOrder();
    await enqueue(o.id);
    await runNovaryqPushWorker();
    const calls = (fetch as any).mock.calls.length;
    process.env.NOVARYQ_INTEGRATION_ENABLED = 'false';
    await transitionOrder(o.id, OrderStatus.CANCELLED_BY_CUSTOMER);
    expect((await prisma.novaryqOrderSync.findUniqueOrThrow({ where: { orderId: o.id } })).state).toBe('SENT');
    expect((fetch as any).mock.calls.length).toBe(calls);
  });

  it('restaurant disabled (flag on): no push is queued for its received orders', async () => {
    await saveConfig(restaurantId, 'NOVARYQ', {
      baseUrl: 'https://pos.example.com', clientId: 'nq_test', secret: 'nqsec', webhookSecret: WHSEC, enabled: 'false', pushOn: 'RECEIVED',
    });
    try {
      const o = await makeOrder(OrderStatus.PAYMENT_PENDING);
      await transitionOrder(o.id, OrderStatus.RECEIVED);
      expect(await prisma.novaryqOrderSync.count({ where: { orderId: o.id } })).toBe(0);
    } finally {
      await saveConfig(restaurantId, 'NOVARYQ', {
        baseUrl: 'https://pos.example.com', clientId: 'nq_test', secret: 'nqsec', webhookSecret: WHSEC, enabled: 'true', pushOn: 'RECEIVED',
      });
    }
  });
});

describe('webhook inbox', () => {
  const sign = (body: string) => {
    const t = Math.floor(Date.now() / 1000);
    return `t=${t},v1=${createHmac('sha256', WHSEC).update(`${t}.${body}`).digest('hex')}`;
  };
  const deliver = (body: string, delivery: string) =>
    webhookPOST(
      new Request(`http://x/api/integrations/novaryq/webhook/${restaurantId}`, {
        method: 'POST',
        body,
        headers: { 'x-novaryq-signature': sign(body), 'x-novaryq-event': 'order.status_changed', 'x-novaryq-delivery': delivery, 'x-novaryq-idempotency-key': delivery },
      }) as any,
      { params: Promise.resolve({ restaurantId }) },
    );
  const statusEvent = (id: string, orderId: string, status: string, occurredAt: string) =>
    JSON.stringify({ id, eventType: 'order.status_changed', occurredAt, payload: { orderId: 'nq_x', externalRef: orderId, source: 'flavrly', status, occurredAt } });

  it('five concurrent redeliveries of one event are stored once', async () => {
    const o = await makeOrder();
    await enqueue(o.id);
    const body = statusEvent(`evt_${uid()}`, o.id, 'OPEN', new Date().toISOString());
    const res = await Promise.all(Array.from({ length: 5 }, () => deliver(body, 'dlv_same')));
    expect(res.every((r) => r.status === 200)).toBe(true);
    expect(await prisma.novaryqWebhookEvent.count({ where: { restaurantId } })).toBe(1);
  });

  it('applies IN_PREP through transitionOrder; an older SENT arriving later is ignored as stale', async () => {
    const o = await makeOrder();
    await enqueue(o.id);
    await prisma.novaryqOrderSync.updateMany({ where: { orderId: o.id }, data: { state: 'SENT', novaryqOrderId: 'nq_x' } });
    await deliver(statusEvent(`evt_${uid()}`, o.id, 'IN_PREP', '2026-10-25T10:05:00Z'), `d_${uid()}`);
    expect((await runNovaryqWebhookWorker()).done).toBe(1);
    await deliver(statusEvent(`evt_${uid()}`, o.id, 'SENT', '2026-10-25T10:01:00Z'), `d_${uid()}`);
    expect((await runNovaryqWebhookWorker()).done).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe(OrderStatus.PREPARING);
    const events = await prisma.novaryqWebhookEvent.findMany({ where: { restaurantId }, orderBy: { receivedAt: 'asc' } });
    expect(events.every((e) => e.processedAt)).toBe(true);
    expect(events.map((e) => e.error)).toEqual([null, 'ignored:stale']);
    const sync = await prisma.novaryqOrderSync.findUniqueOrThrow({ where: { orderId: o.id } });
    expect(sync).toMatchObject({ lastStatus: 'IN_PREP' });
  });
});

describe('menu import with modifier groups + priced modifier snapshot (QA-D2)', () => {
  const nqMenu = (addOns: Array<{ id: string; name: string; price: string }>) => ({
    data: [{
      itemCode: 'SKU-BIRYANI', id: 'nq_item_b', name: 'Veg Biryani', category: 'Mains', categoryName: 'Mains', price: '249.00', currency: 'INR', available: true,
      modifierGroups: [
        { id: 'g_spice', name: 'Spice level', minSelect: 1, maxSelect: 1, required: true, options: [
          { id: 'o_mild', name: 'Mild', price: '0.00', available: true, isDefault: true, maxQuantity: 1 },
          { id: 'o_hot', name: 'Hot', price: '0.00', available: true, isDefault: false, maxQuantity: 1 },
        ] },
        { id: 'g_add', name: 'Add-ons', minSelect: 0, maxSelect: 2, required: false, options: addOns.map((a) => ({ ...a, available: true, isDefault: false, maxQuantity: 1 })) },
      ],
    }],
    page: 1, pageSize: 1, total: 1,
  });
  let menu: unknown = null;
  const posted: any[] = [];
  let b2 = '';

  beforeAll(async () => {
    b2 = (await prisma.branch.create({ data: { restaurantId, name: 'Second', slug: `nq-b2-${uid()}`, line1: 'x', city: 'Pune', postalCode: '411001' } })).id;
    await prisma.novaryqLocationLink.create({ data: { restaurantId, branchId: b2, novaryqLocationId: 'loc_2', currency: 'INR' } });
  });
  beforeEach(() => {
    posted.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const u = new URL(url);
      if ((init.method ?? 'GET') === 'GET' && u.pathname === '/api/v1/menu') return new Response(JSON.stringify(menu), { status: 200 });
      if (init.method === 'POST' && u.pathname === '/api/v1/orders') {
        posted.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ id: `nq_${uid()}`, orderNumber: 1, idempotentReplay: false }), { status: 201 });
      }
      return new Response('{}', { status: 404 });
    }));
  });

  const itemState = async () => {
    const item = await prisma.menuItem.findFirstOrThrow({
      where: { branchId: b2, name: 'Veg Biryani' },
      include: { novaryqLink: true, modifierGroups: { orderBy: { sortOrder: 'asc' }, include: { options: { orderBy: { sortOrder: 'asc' } } } } },
    });
    return {
      item,
      groups: item.modifierGroups.map((g) => ({ id: g.id, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, required: g.required,
        options: g.options.map((o) => ({ id: o.id, name: o.name, price: Number(o.priceDelta), isDefault: o.isDefault })) })),
    };
  };

  it('imports groups/options; a re-import updates in place (stable ids + link), drops removed options, keeps Flavrly-only groups; push prices the snapshot', async () => {
    menu = nqMenu([{ id: 'o_paneer', name: 'Extra paneer', price: '60.00' }, { id: 'o_cheese', name: 'Extra cheese', price: '30.00' }]);
    expect(await importNovaryqMenu(restaurantId, b2)).toMatchObject({ created: 1, linked: 1, modifierGroups: 2 });
    const first = await itemState();
    expect(first.item.novaryqLink?.novaryqItemCode).toBe('SKU-BIRYANI');
    expect(first.groups.map((g) => [g.name, g.minSelect, g.maxSelect, g.required, g.options.map((o) => [o.name, o.price, o.isDefault])])).toEqual([
      ['Spice level', 1, 1, true, [['Mild', 0, true], ['Hot', 0, false]]],
      ['Add-ons', 0, 2, false, [['Extra paneer', 60, false], ['Extra cheese', 30, false]]],
    ]);

    // A Flavrly-only add-on group, then Novaryq raises a price and drops an option.
    await prisma.modifierGroup.create({ data: { menuItemId: first.item.id, name: 'Gift wrap', sortOrder: 9, options: { create: [{ name: 'Ribbon', priceDelta: '10.00' }] } } });
    menu = nqMenu([{ id: 'o_paneer', name: 'Extra paneer', price: '70.00' }]);
    expect(await importNovaryqMenu(restaurantId, b2)).toMatchObject({ created: 0, linked: 1, modifierGroups: 2 });
    const again = await itemState();
    expect(again.item.id).toBe(first.item.id);
    expect(again.item.novaryqLink?.id).toBe(first.item.novaryqLink?.id);
    expect(again.groups.map((g) => g.id)).toEqual([first.groups[0].id, first.groups[1].id, expect.any(String)]);
    expect(again.groups[0].options.map((o) => o.id)).toEqual(first.groups[0].options.map((o) => o.id));
    expect(again.groups[1].options).toEqual([{ ...first.groups[1].options[0], price: 70 }]);
    expect(again.groups[2]).toMatchObject({ name: 'Gift wrap', options: [{ name: 'Ribbon', price: 10 }] });
    expect(await prisma.modifierGroup.count({ where: { menuItemId: first.item.id } })).toBe(3);

    // The order line keeps the chosen names; the push sends them with Flavrly's per-unit prices.
    const o = await prisma.order.create({
      data: {
        code: `ORD-${uid()}`, branchId: b2, customerId, status: OrderStatus.RECEIVED, subtotal: '638.00', total: '638.00', paymentMethod: PaymentMethod.COD,
        items: { create: [{ name: 'Veg Biryani', quantity: 2, unitPrice: '319.00', menuItemId: first.item.id, modifiersSummary: 'Mild, Extra paneer' }] },
      },
    });
    expect(await prisma.$transaction((tx) => enqueueNovaryqPush(tx, o.id, b2))).toBe(true);
    expect((await runNovaryqPushWorker()).sent).toBe(1);
    expect(posted).toHaveLength(1);
    expect(posted[0].lines).toEqual([{
      itemCode: 'SKU-BIRYANI', quantity: 2, unitPrice: '319.00',
      modifiers: [{ name: 'Mild', unitPrice: '0.00', quantity: 1 }, { name: 'Extra paneer', unitPrice: '70.00', quantity: 1 }],
    }]);
  });
});
