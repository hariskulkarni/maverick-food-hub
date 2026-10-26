/**
 * E2E §5 Push: RECEIVED -> NovaryqOrderSync outbox -> worker -> POST /api/v1/orders (simulator).
 * Exactly-once under replay/concurrency/crash, money fidelity, unmapped items, outage handling,
 * backoff -> DEAD -> manual replay, feature flags.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NovaryqSimulator, toPaise } from '../novaryq-sim/simulator';
import { sent } from './sent';
import { fl } from './fl';
import {
  capturePrepaid, db, fastForward, makeShop, placeCod, placePrepaid, prisma, routeTransport, saveCfg, statusOf, syncOf, transitionOrder, type Shop,
} from './harness';

let sim: NovaryqSimulator;
let shop: Shop;

const ordersPosts = () => sim.requestsTo('POST', '/api/v1/orders');
const simOrdersFor = (orderId: string) => [...sim.orders.values()].filter((o) => o.externalRef === orderId);
const money = (d: unknown) => Number(d).toFixed(2);
const BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000, 7_200_000];

beforeAll(async () => {
  sim = new NovaryqSimulator({ transport: routeTransport });
  await sim.start();
  shop = await makeShop(sim);
});
beforeEach(() => {
  sim.clearFaults();
  sent.alerts.length = 0;
  sent.notify.length = 0;
});
afterAll(async () => {
  await sim.stop();
  await prisma.$disconnect();
});

describe('push: COD and prepaid orders reach Novaryq once, at Flavrly prices', () => {
  it('COD order placed straight into RECEIVED is enqueued in the same transaction and pushed once', async () => {
    const order = await placeCod(shop);
    expect(order.status).toBe('RECEIVED');
    const queued = await syncOf(order.id);
    expect(queued).toMatchObject({ state: 'PENDING', restaurantId: shop.restaurantId });
    await fl.runWorker();
    const sync = await syncOf(order.id);
    const [nq] = simOrdersFor(order.id);
    expect(sync.state).toBe('SENT');
    expect(nq).toBeTruthy();
    expect(sync.novaryqOrderId).toBe(nq!.id);
    expect(String(sync.novaryqOrderNumber)).toBe(String(nq!.orderNumber));
    expect(ordersPosts().filter((r) => JSON.parse(r.rawBody).externalRef === order.id)).toHaveLength(1);
    // Never block the Flavrly order: still RECEIVED (SENT webhook not delivered yet).
    expect(await statusOf(order.id)).toBe('RECEIVED');
  });

  it('COD payload: §2.1 fields, UNPAID, money identical to the Flavrly order in paise', async () => {
    const order = await placeCod(shop);
    await fl.runWorker();
    const body = simOrdersFor(order.id)[0]!.request;
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    expect(body).toMatchObject({
      locationId: shop.location.id,
      serviceMode: 'DELIVERY',
      source: 'flavrly',
      externalRef: o.id,
      externalCode: o.code,
      currency: 'INR',
    });
    expect(body.externalCode.length).toBeLessThanOrEqual(32);
    expect(body.customer?.name).toBe('Asha');
    expect(body.deliveryAddress).toContain('12 MG Road');
    expect(body.payment.status).toBe('UNPAID');
    expect(body.totals.grandTotal).toBe(money(o.total));
    expect(body.totals.subtotal).toBe(money(o.subtotal));
    if (body.totals.tax !== undefined) expect(body.totals.tax).toBe(money(o.taxAmount));
    if (body.totals.packagingFee !== undefined) expect(body.totals.packagingFee).toBe(money(o.packagingFee));
    if (body.totals.deliveryFee !== undefined) expect(body.totals.deliveryFee).toBe(money(o.deliveryFee));
    if (body.totals.discount !== undefined) expect(body.totals.discount).toBe(money(o.discountAmount));
    {
      const t = body.totals;
      expect(toPaise(t.subtotal) - toPaise(t.discount ?? '0.00') + toPaise(t.deliveryFee ?? '0.00') + toPaise(t.packagingFee ?? '0.00') + toPaise(t.tax ?? '0.00')).toBe(toPaise(t.grandTotal));
    }
    // Every money field is a 2-dp decimal string (no floats, no paise integers).
    for (const v of Object.values(body.totals)) expect(v).toMatch(/^\d+\.\d{2}$/);
    for (const l of body.lines) {
      expect(l.unitPrice).toMatch(/^\d+\.\d{2}$/);
      for (const m of l.modifiers ?? []) expect(m.unitPrice).toMatch(/^\d+\.\d{2}$/);
    }
    // NQ records unitPrice as the per-unit price INCLUDING modifiers and never adds the modifier
    // snapshot again (apps/api/src/dev-platform/channel-order.ts), so Σ qty × unitPrice must equal
    // the Flavrly subtotal to the paisa.
    const linePaise = body.lines.reduce((s: number, l: any) => s + l.quantity * toPaise(l.unitPrice), 0);
    expect(linePaise).toBe(toPaise(money(o.subtotal)));
    // Item codes come from NovaryqItemLink; quantities from OrderItem.
    expect(body.lines.map((l: any) => [l.itemCode, l.quantity]).sort()).toEqual([[shop.dal.code, 1], [shop.paneer.code, 2]].sort());
  });

  it('a COD order with wallet applied: Novaryq grand total / amount due equals what the rider collects', async () => {
    await prisma.wallet.upsert({ where: { userId: shop.customerId }, update: { balance: 100 as any }, create: { userId: shop.customerId, balance: 100 as any } });
    const order = await placeCod(shop, undefined, { walletApply: 100 });
    await fl.runWorker();
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(Number(o.walletApplied)).toBe(100);
    const body = simOrdersFor(order.id)[0]!.request;
    expect(body.payment.status).toBe('UNPAID');
    expect(body.totals.grandTotal).toBe(money(o.total));
    if (body.payment.amount !== undefined) expect(body.payment.amount).toBe(money(o.total));
    // The POS check must add up (QA-C3 / FL-2): subtotal − discount + fees + tax = grandTotal, to the paisa.
    const t = body.totals;
    const sum = toPaise(t.subtotal) - toPaise(t.discount ?? '0.00') + toPaise(t.deliveryFee ?? '0.00') + toPaise(t.packagingFee ?? '0.00') + toPaise(t.tax ?? '0.00');
    expect(sum).toBe(toPaise(t.grandTotal));
  });

  it('prepaid order is NOT pushed while PAYMENT_PENDING, and is pushed PREPAID once captured', async () => {
    const order = await placePrepaid(shop);
    expect(order.status).toBe('PAYMENT_PENDING');
    await fl.runWorker();
    expect(simOrdersFor(order.id)).toHaveLength(0);
    await capturePrepaid(order.id);
    expect(await statusOf(order.id)).toBe('RECEIVED');
    await fl.runWorker();
    const [nq] = simOrdersFor(order.id);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(nq!.request.payment).toMatchObject({ status: 'PREPAID', amount: money(o.total) });
    expect(nq!.request.totals.grandTotal).toBe(money(o.total));
    expect((await syncOf(order.id)).state).toBe('SENT');
  });

  it('a capture replayed twice (RECEIVED re-entered) still yields one sync row and one Novaryq order', async () => {
    const order = await placePrepaid(shop);
    await capturePrepaid(order.id);
    const { releaseOrderAfterCapture } = await import('@/server/payments/reconcile');
    await releaseOrderAfterCapture(order.id, 'duplicate capture webhook');
    await transitionOrder(order.id, 'RECEIVED' as any).catch(() => undefined);
    expect(await db.novaryqOrderSync.count({ where: { orderId: order.id } })).toBe(1);
    await fl.runWorker();
    await fl.runWorker();
    expect(simOrdersFor(order.id)).toHaveLength(1);
  });
});

describe('push: exactly once under concurrency, crash and lost responses', () => {
  it('5 concurrent worker ticks push a due order with exactly one POST', async () => {
    const order = await placeCod(shop);
    const before = ordersPosts().length;
    await Promise.all(Array.from({ length: 5 }, () => fl.runWorker()));
    const posts = ordersPosts().slice(before).filter((r) => JSON.parse(r.rawBody).externalRef === order.id);
    expect(posts).toHaveLength(1);
    expect(simOrdersFor(order.id)).toHaveLength(1);
    expect((await syncOf(order.id)).state).toBe('SENT');
  });

  it('response lost after Novaryq committed (504 after write): the retry is an idempotent replay, same Novaryq id', async () => {
    const order = await placeCod(shop);
    sim.injectFault('POST /api/v1/orders', { kind: 'status', status: 504, phase: 'after' });
    await fl.runWorker();
    const mid = await syncOf(order.id);
    expect(mid.state).toBe('PENDING');
    expect(mid.attempts).toBe(1);
    expect(simOrdersFor(order.id)).toHaveLength(1);
    await fastForward();
    await fl.runWorker();
    const sync = await syncOf(order.id);
    expect(sync.state).toBe('SENT');
    expect(sync.novaryqOrderId).toBe(simOrdersFor(order.id)[0]!.id);
    expect(simOrdersFor(order.id)).toHaveLength(1);
  });

  it('connection reset after Novaryq committed (worker saw a network error) -> one Novaryq order', async () => {
    const order = await placeCod(shop);
    sim.injectFault('POST /api/v1/orders', { kind: 'reset', phase: 'after' });
    await fl.runWorker();
    await fastForward();
    await fl.runWorker();
    expect(simOrdersFor(order.id)).toHaveLength(1);
    expect((await syncOf(order.id)).state).toBe('SENT');
  });

  it('a row leased by a live worker is not pushed by another; an expired lease is reclaimed', async () => {
    const order = await placeCod(shop);
    await db.novaryqOrderSync.update({ where: { orderId: order.id }, data: { leaseOwner: 'other-worker', leaseExpiresAt: new Date(Date.now() + 60_000) } });
    await fl.runWorker();
    expect(simOrdersFor(order.id)).toHaveLength(0);
    await db.novaryqOrderSync.update({ where: { orderId: order.id }, data: { leaseExpiresAt: new Date(Date.now() - 1_000) } });
    await fl.runWorker();
    expect(simOrdersFor(order.id)).toHaveLength(1);
  });

  it('manual replay of an already SENT order does not create a second Novaryq order', async () => {
    const order = await placeCod(shop);
    await fl.runWorker();
    const sync = await syncOf(order.id);
    await fl.replay(shop.restaurantId, sync.id, shop.ownerId).catch(() => undefined); // refusing is also fine
    await fastForward();
    await fl.runWorker();
    expect(simOrdersFor(order.id)).toHaveLength(1);
    expect((await syncOf(order.id)).novaryqOrderId).toBe(sync.novaryqOrderId);
  });
});

describe('push: unmapped items and Novaryq rejections fail clearly without retry storms', () => {
  it('an order with an item that has no NovaryqItemLink is never pushed; FAILED lists the item; restaurant alerted', async () => {
    const order = await placeCod(shop, [{ menuItemId: shop.paneer.id, quantity: 1 }, { menuItemId: shop.unmapped.id, quantity: 1 }]);
    const before = ordersPosts().length;
    await fl.runWorker();
    await fastForward();
    await fl.runWorker();
    expect(ordersPosts().length).toBe(before);
    const sync = await syncOf(order.id);
    expect(sync.state).toBe('FAILED');
    expect(sync.lastError).toContain(shop.unmapped.name);
    expect(await statusOf(order.id)).toBe('RECEIVED');
    expect(sent.alerts.length + sent.notify.length).toBeGreaterThan(0);
  });

  it('after the item is linked, manual replay pushes it', async () => {
    const order = await placeCod(shop, [{ menuItemId: shop.unmapped.id, quantity: 1 }]);
    await fl.runWorker();
    expect((await syncOf(order.id)).state).toBe('FAILED');
    const code = NovaryqSimulator.itemCode(sim.addItem({ name: 'Mango Lassi', price: '99.00', sku: `SKU-L-${order.id.slice(-6)}` }));
    await db.novaryqItemLink.create({ data: { restaurantId: shop.restaurantId, menuItemId: shop.unmapped.id, novaryqItemCode: code } });
    await fl.replay(shop.restaurantId, (await syncOf(order.id)).id, shop.ownerId);
    await fastForward();
    await fl.runWorker();
    expect((await syncOf(order.id)).state).toBe('SENT');
    expect(simOrdersFor(order.id)[0]!.request.lines[0].itemCode).toBe(code);
    await db.novaryqItemLink.delete({ where: { menuItemId: shop.unmapped.id } });
  });

  it('Novaryq 422 unknownItemCodes (stale link) -> FAILED with the codes, not retried', async () => {
    const stale = await makeShop(sim);
    await db.novaryqItemLink.update({ where: { menuItemId: stale.dal.id }, data: { novaryqItemCode: 'GONE-1' } });
    const order = await placeCod(stale);
    await fl.runWorker();
    const sync = await syncOf(order.id);
    expect(sync.state).toBe('FAILED');
    expect(sync.lastError).toContain('GONE-1');
    const n = sim.requestsTo('POST', '/api/v1/orders').length;
    await fastForward();
    await fl.runWorker();
    expect(sim.requestsTo('POST', '/api/v1/orders').length).toBe(n);
  });
});

describe('push: Novaryq down / 429 / timeouts -> backoff -> DEAD -> manual replay', () => {
  it('follows 30 s -> 2 m -> 10 m -> 30 m -> 2 h, goes DEAD after 8 attempts, alerts the owner, order untouched', async () => {
    const order = await placeCod(shop);
    sim.injectFault('POST /api/v1/orders', { kind: 'status', status: 503 }, 8);
    const delays: number[] = [];
    for (let i = 1; i <= 8; i++) {
      const t0 = Date.now();
      await fl.runWorker();
      const s = await syncOf(order.id);
      expect(s.attempts).toBe(i);
      if (i < 8) {
        expect(s.state).toBe('PENDING');
        delays.push(new Date(s.nextAttemptAt).getTime() - t0);
        await fastForward();
      }
    }
    BACKOFF_MS.forEach((ms, i) => {
      expect(delays[i]!).toBeGreaterThanOrEqual(ms * 0.9);
      expect(delays[i]!).toBeLessThanOrEqual(ms * 1.25 + 5_000);
    });
    const dead = await syncOf(order.id);
    expect(dead.state).toBe('DEAD');
    expect(dead.lastError).toMatch(/503/);
    expect(await statusOf(order.id)).toBe('RECEIVED');
    expect(simOrdersFor(order.id)).toHaveLength(0);
    expect(sent.alerts.length + sent.notify.length).toBeGreaterThan(0);
    // A DEAD row is not retried by the worker on its own...
    await fastForward();
    await fl.runWorker();
    expect(simOrdersFor(order.id)).toHaveLength(0);
    // ...but a manual replay pushes it exactly once.
    await fl.replay(shop.restaurantId, dead.id, shop.ownerId);
    await fastForward();
    await fl.runWorker();
    expect((await syncOf(order.id)).state).toBe('SENT');
    expect(simOrdersFor(order.id)).toHaveLength(1);
  });

  it('replay is tenant-scoped: another restaurant cannot requeue this sync', async () => {
    const order = await placeCod(shop, [{ menuItemId: shop.unmapped.id, quantity: 1 }]);
    await fl.runWorker();
    const s = await syncOf(order.id);
    expect(s.state).toBe('FAILED');
    const other = await makeShop(sim);
    await expect(fl.replay(other.restaurantId, s.id, other.ownerId)).rejects.toThrow();
    expect((await syncOf(order.id)).state).toBe('FAILED');
  });

  it('429 honours Retry-After when it is longer than the backoff step', async () => {
    const order = await placeCod(shop);
    sim.injectFault('POST /api/v1/orders', { kind: 'status', status: 429, retryAfterSec: 900 });
    const t0 = Date.now();
    await fl.runWorker();
    const s = await syncOf(order.id);
    expect(s.state).toBe('PENDING');
    expect(new Date(s.nextAttemptAt).getTime() - t0).toBeGreaterThanOrEqual(900_000 - 2_000);
  });

  it('Novaryq completely unreachable: checkout still succeeds and the push waits', async () => {
    await sim.stop();
    try {
      const order = await placeCod(shop);
      expect(order.status).toBe('RECEIVED');
      await fl.runWorker();
      const s = await syncOf(order.id);
      expect(s.state).toBe('PENDING');
      expect(s.lastError).toBeTruthy();
    } finally {
      await sim.start(Number(new URL(sim.baseUrl).port));
    }
  });
});

describe('feature flags: off means no Novaryq traffic', () => {
  it('NOVARYQ_INTEGRATION_ENABLED=false: no push, even for rows already queued', async () => {
    const queued = await placeCod(shop);
    process.env.NOVARYQ_INTEGRATION_ENABLED = 'false';
    try {
      const before = sim.requests.length;
      const order = await placeCod(shop);
      await fl.workerRoute();
      await fastForward();
      await fl.workerRoute();
      expect(sim.requests.length).toBe(before);
      expect(simOrdersFor(order.id)).toHaveLength(0);
      expect(simOrdersFor(queued.id)).toHaveLength(0);
    } finally {
      process.env.NOVARYQ_INTEGRATION_ENABLED = 'true';
    }
  });

  it('per-restaurant enabled=false: no sync row, no traffic', async () => {
    const off = await makeShop(sim, { enabled: false });
    const before = sim.requests.length;
    const order = await placeCod(off);
    await fl.runWorker();
    expect(await syncOf(order.id)).toBeNull();
    expect(sim.requests.filter((r) => r.clientId === off.key.clientId)).toHaveLength(0);
    expect(sim.requests.length).toBeGreaterThanOrEqual(before);
  });

  it('a branch with no NovaryqLocationLink is not pushed', async () => {
    const s = await makeShop(sim);
    await db.novaryqLocationLink.delete({ where: { branchId: s.branchId } });
    const order = await placeCod(s);
    await fl.runWorker();
    expect(simOrdersFor(order.id)).toHaveLength(0);
  });

  it('a branch whose Novaryq location currency is not INR cannot be enabled / is never pushed', async () => {
    const usd = await makeShop(sim, { currency: 'USD' });
    const order = await placeCod(usd);
    await fl.runWorker();
    expect(simOrdersFor(order.id)).toHaveLength(0);
  });

  it('disabling via saveConfig takes effect immediately (no stale 5-minute credential cache)', async () => {
    const s = await makeShop(sim);
    await saveCfg(s, { enabled: 'false' });
    const order = await placeCod(s);
    await fl.runWorker();
    expect(simOrdersFor(order.id)).toHaveLength(0);
  });
});
