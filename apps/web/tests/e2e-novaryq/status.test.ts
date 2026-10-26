/**
 * E2E §3 status sync (Novaryq webhooks -> Flavrly transitionOrder) and §5 cancel (Flavrly -> Novaryq).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NovaryqSimulator, type NqOrderStatus } from '../novaryq-sim/simulator';
import { sent } from './sent';
import { fl } from './fl';
import { capturePrepaid, db, fastForward, makeShop, placeCod, placePrepaid, prisma, routeTransport, settle, statusOf, statusTrail, syncOf, transitionOrder, type Shop, eventByDelivery, eventCount } from './harness';

let sim: NovaryqSimulator;
let shop: Shop;

async function pushed(s: Shop = shop, extra: Record<string, unknown> = {}) {
  const order = await placeCod(s, undefined, extra);
  await fl.runWorker();
  const nq = sim.orderByExternalRef(order.id)!;
  expect(nq).toBeTruthy();
  return { order, nq };
}

async function placePrepaidReceived(s: Shop = shop) {
  const order = await placePrepaid(s);
  await capturePrepaid(order.id);
  return order;
}

/** POS kitchen action -> signed webhook into the route -> worker applies it. */
async function kitchen(nqOrderId: string, status: NqOrderStatus, occurredAt?: string) {
  sim.advance(nqOrderId, status, occurredAt);
  await sim.flush();
  await fl.runWorker();
}

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

describe('status: Novaryq kitchen progress moves the Flavrly order via transitionOrder', () => {
  it('SENT -> ACCEPTED, IN_PREP -> PREPARING, READY -> READY (each one OrderStatusEvent)', async () => {
    const { order, nq } = await pushed();
    await sim.flush(); // the OPEN -> SENT event fired on create
    await fl.runWorker();
    expect(await statusOf(order.id)).toBe('ACCEPTED');
    await kitchen(nq.id, 'IN_PREP');
    expect(await statusOf(order.id)).toBe('PREPARING');
    await kitchen(nq.id, 'READY');
    expect(await statusOf(order.id)).toBe('READY');
    expect(await statusTrail(order.id)).toEqual(['RECEIVED', 'ACCEPTED', 'PREPARING', 'READY']);
    const sync = await syncOf(order.id);
    expect(sync.lastStatus).toBe('READY');
  });

  it('READY straight from RECEIVED walks through ACCEPTED and PREPARING', async () => {
    const { order, nq } = await pushed();
    sim.deliveries.length = 0; // drop the queued SENT event: READY arrives first
    await kitchen(nq.id, 'READY');
    expect(await statusOf(order.id)).toBe('READY');
    expect(await statusTrail(order.id)).toEqual(['RECEIVED', 'ACCEPTED', 'PREPARING', 'READY']);
  });

  it('the webhook is stored durably by the time the route answers 200, and is applied by the worker', async () => {
    const { order, nq } = await pushed();
    await sim.flush();
    await fl.runWorker();
    const [d] = sim.advance(nq.id, 'IN_PREP');
    await sim.flush();
    expect(d!.attempts.at(-1)!.status).toBe(200);
    expect(await eventByDelivery(d!.id)).toMatchObject({ restaurantId: shop.restaurantId, event: 'order.status_changed' });
    await fl.runWorker();
    expect(await statusOf(order.id)).toBe('PREPARING');
    expect((await eventByDelivery(d!.id)).processedAt).not.toBeNull();
  });

  it('duplicate deliveries (same X-Novaryq-Delivery) are stored once and applied once', async () => {
    const { order, nq } = await pushed();
    await sim.flush();
    await fl.runWorker();
    const [d] = sim.advance(nq.id, 'IN_PREP');
    await sim.flush();
    await sim.redeliver(d!);
    await sim.redeliver(d!);
    expect(d!.attempts.map((a) => a.status)).toEqual([200, 200, 200]);
    expect(await eventCount(d!.id)).toBe(1);
    await fl.runWorker();
    expect((await statusTrail(order.id)).filter((s) => s === 'PREPARING')).toHaveLength(1);
  });

  it('out-of-order delivery (READY before IN_PREP) never moves the order backwards', async () => {
    const { order, nq } = await pushed();
    await sim.flush();
    await fl.runWorker();
    sim.hold = true;
    sim.advance(nq.id, 'IN_PREP', new Date(Date.now() - 5_000).toISOString());
    sim.advance(nq.id, 'READY', new Date().toISOString());
    await sim.releaseHeld('reverse');
    await fl.runWorker();
    await fl.runWorker();
    expect(await statusOf(order.id)).toBe('READY');
    expect(await statusTrail(order.id)).toEqual(['RECEIVED', 'ACCEPTED', 'PREPARING', 'READY']);
  });

  it('a stale event (older occurredAt than the last applied) is ignored even when it arrives alone', async () => {
    const { order, nq } = await pushed();
    await kitchen(nq.id, 'IN_PREP', new Date().toISOString());
    expect(await statusOf(order.id)).toBe('PREPARING');
    // Novaryq re-sends an old SENT event (e.g. a manual redeliver from the console).
    await kitchen(nq.id, 'SENT', new Date(Date.now() - 60_000).toISOString());
    expect(await statusOf(order.id)).toBe('PREPARING');
  });

  it('COMPLETED: DELIVERY orders are left for the rider; TAKEOUT orders become DELIVERED from READY', async () => {
    const { order, nq } = await pushed();
    await kitchen(nq.id, 'READY');
    await kitchen(nq.id, 'COMPLETED');
    expect(await statusOf(order.id)).toBe('READY');

    const pick = await placeCod(shop, undefined, { fulfillmentType: 'PICKUP', addressId: null });
    await fl.runWorker();
    const nqPick = sim.orderByExternalRef(pick.id)!;
    expect(nqPick.request.serviceMode).toBe('TAKEOUT');
    expect(nqPick.request.deliveryAddress).toBeUndefined();
    await kitchen(nqPick.id, 'READY');
    await kitchen(nqPick.id, 'COMPLETED');
    expect(await statusOf(pick.id)).toBe('DELIVERED');
  });

  it('REFUNDED does not change the Flavrly order', async () => {
    const { order, nq } = await pushed();
    await kitchen(nq.id, 'READY');
    await kitchen(nq.id, 'REFUNDED');
    expect(await statusOf(order.id)).toBe('READY');
  });

  it('webhooks for non-Flavrly POS orders (source ≠ flavrly) are accepted and ignored', async () => {
    const before = await prisma.order.count();
    const d = sim.emit('order.status_changed', { orderId: 'ord_pos_dinein', orderNumber: 7, locationId: shop.location.id, source: 'pos', externalRef: null, externalCode: null, status: 'READY', previousStatus: 'IN_PREP', occurredAt: new Date().toISOString() });
    await sim.flush();
    expect(d[0]!.attempts[0]!.status).toBe(200);
    await fl.runWorker();
    expect(await prisma.order.count()).toBe(before);
    const row = await eventByDelivery(d[0]!.id);
    expect(row?.processedAt ?? null).not.toBeNull();
  });

  it("console 'Send test' (webhook.test, envelope without data) is accepted and stored", async () => {
    const d = sim.sendTest(shop.sub.id);
    await sim.flush();
    expect(d.attempts[0]!.status).toBe(200);
    expect(await eventByDelivery(d.id)).toMatchObject({ event: 'webhook.test' });
    await fl.runWorker();
  });
});

describe('status: VOIDED in Novaryq', () => {
  it('before pickup -> CANCELLED_BY_RESTAURANT', async () => {
    const { order, nq } = await pushed();
    await kitchen(nq.id, 'IN_PREP');
    await kitchen(nq.id, 'VOIDED');
    expect(await statusOf(order.id)).toBe('CANCELLED_BY_RESTAURANT');
  });

  it('after pickup -> no auto-cancel; an ops exception is raised', async () => {
    const { order, nq } = await pushed();
    await kitchen(nq.id, 'READY');
    await transitionOrder(order.id, 'OUT_FOR_DELIVERY' as any);
    await kitchen(nq.id, 'VOIDED');
    expect(await statusOf(order.id)).toBe('OUT_FOR_DELIVERY');
    // Ops signal: an open order escalation and/or an alert to the restaurant/platform.
    const escalations = await prisma.orderEscalation.count({ where: { orderId: order.id } });
    const raised = escalations > 0 || sent.alerts.length > 0 || sent.notify.length > 0;
    expect(raised).toBe(true);
  });
});

describe('cancel: Flavrly cancellation cancels in Novaryq', () => {
  it.each([
    ['CANCELLED_BY_CUSTOMER', 'customer_cancelled'],
    ['CANCELLED_BY_RESTAURANT', 'restaurant_cancelled'],
    ['CANCELLED_BY_ADMIN', 'admin_cancelled'],
  ])('%s -> POST /orders/:id/cancel reason=%s -> sync CANCELLED; the VOIDED echo is harmless', async (flStatus, reason) => {
    const { order, nq } = await pushed();
    await transitionOrder(order.id, flStatus as any);
    expect((await syncOf(order.id)).state).toBe('CANCEL_PENDING');
    await fl.runWorker();
    const calls = sim.requestsTo('POST', `/api/v1/orders/${nq.id}/cancel`);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!.rawBody).reason).toBe(reason);
    expect(sim.orders.get(nq.id)!.status).toBe('VOIDED');
    expect((await syncOf(order.id)).state).toBe('CANCELLED');
    await sim.flush(); // VOIDED echo webhook
    await fl.runWorker();
    expect(await statusOf(order.id)).toBe(flStatus);
    const evt = await db.novaryqWebhookEvent.findFirst({ where: { restaurantId: shop.restaurantId }, orderBy: { receivedAt: 'desc' } });
    expect(evt.processedAt).not.toBeNull();
  });

  it('cancelled before it was pushed -> never pushed, no cancel call', async () => {
    const order = await placeCod(shop);
    await transitionOrder(order.id, 'CANCELLED_BY_CUSTOMER' as any);
    await fl.runWorker();
    await fastForward();
    await fl.runWorker();
    expect(sim.orderByExternalRef(order.id)).toBeUndefined();
    expect(['CANCELLED', 'FAILED']).toContain((await syncOf(order.id)).state);
  });

  it('cancel is retried while Novaryq returns 503', async () => {
    const { order, nq } = await pushed();
    sim.injectFault(`POST /api/v1/orders/${nq.id}/cancel`, { kind: 'status', status: 503 }, 2);
    await transitionOrder(order.id, 'CANCELLED_BY_CUSTOMER' as any);
    await fl.runWorker();
    expect((await syncOf(order.id)).state).toBe('CANCEL_PENDING');
    await fastForward();
    await fl.runWorker();
    await fastForward();
    await fl.runWorker();
    expect(sim.orders.get(nq.id)!.status).toBe('VOIDED');
    expect((await syncOf(order.id)).state).toBe('CANCELLED');
  });

  it('cancelled while the push response was lost (Novaryq has it, Flavrly does not know the id) -> Novaryq ends VOIDED', async () => {
    const order = await placeCod(shop);
    sim.injectFault('POST /api/v1/orders', { kind: 'status', status: 504, phase: 'after' });
    await fl.runWorker();
    const nq = sim.orderByExternalRef(order.id)!;
    expect(nq.status).not.toBe('VOIDED');
    await transitionOrder(order.id, 'CANCELLED_BY_CUSTOMER' as any);
    await settle(sim);
    await fastForward();
    await settle(sim);
    expect(sim.orders.get(nq.id)!.status).toBe('VOIDED');
  });

  it('RECEIVED -> PAYMENT_FAILED (payment reversed) voids the Novaryq ticket: the kitchen must not cook an unpaid order', async () => {
    const order = await placePrepaidReceived();
    await fl.runWorker();
    const nq = sim.orderByExternalRef(order.id)!;
    await transitionOrder(order.id, 'PAYMENT_FAILED' as any);
    await settle(sim);
    expect(sim.orders.get(nq.id)!.status).toBe('VOIDED');
  });

  it('PAYMENT_FAILED -> RECEIVED again: the kitchen ends up with a live (non-VOIDED) ticket', async () => {
    const order = await placePrepaidReceived();
    await fl.runWorker();
    await transitionOrder(order.id, 'PAYMENT_FAILED' as any);
    await settle(sim);
    await transitionOrder(order.id, 'RECEIVED' as any, { pgRelease: true });
    await settle(sim);
    await fastForward();
    await settle(sim);
    const live = [...sim.orders.values()].filter((o) => o.externalRef === order.id && o.status !== 'VOIDED');
    expect(await statusOf(order.id)).toBe('RECEIVED');
    expect(live).toHaveLength(1);
  });

  it('a Novaryq order already COMPLETED cannot be voided: surfaced, not retried forever', async () => {
    const pick = await placeCod(shop, undefined, { fulfillmentType: 'PICKUP', addressId: null });
    await fl.runWorker();
    const nq = sim.orderByExternalRef(pick.id)!;
    sim.advance(nq.id, 'COMPLETED'); // kitchen closed it; webhook not delivered yet
    await transitionOrder(pick.id, 'CANCELLED_BY_ADMIN' as any);
    for (let i = 0; i < 3; i++) {
      await fl.runWorker();
      await fastForward();
    }
    expect(sim.requestsTo('POST', `/api/v1/orders/${nq.id}/cancel`).length).toBeLessThanOrEqual(1);
    expect(['FAILED', 'DEAD']).toContain((await syncOf(pick.id)).state);
  });
});
