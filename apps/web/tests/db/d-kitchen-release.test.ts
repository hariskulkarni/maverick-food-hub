/**
 * Real-Postgres proof (Agent D): order placement status per rail, the kitchen
 * queue query excluding PAYMENT_PENDING, and the ORDER_RELEASE handler.
 * Only network/notification side effects are mocked; prisma, placeOrder,
 * transitionOrder, maybeAutoAccept and the kitchen route query are real.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  youpiEnabled: vi.fn(),
  sms: vi.fn(async (_a: { template: string; body: string }) => undefined),
  publish: vi.fn(),
  scope: { branchIds: [] as string[], primaryBranchId: '' },
}));

vi.mock('@/server/realtime', () => ({ publish: h.publish }));
vi.mock('@/server/notifications', () => ({ notify: { sms: h.sms } }));
vi.mock('@/server/push/milestones', () => ({ pushOrderMilestone: vi.fn(async () => undefined) }));
vi.mock('@/server/rider-push', () => ({ notifyRidersOfNewOrder: vi.fn(async () => undefined) }));
vi.mock('@/server/batch-dispatch', () => ({ maybeOfferAsBatch: vi.fn(async () => undefined) }));
vi.mock('@/server/operating-hours', () => ({
  isBranchOpenAt: () => ({ isOpen: true, label: 'Open' }),
  isScheduledTimeInsideOpenWindow: () => true,
}));
vi.mock('@/server/payments', () => ({ youpiEnabledForRestaurant: h.youpiEnabled }));
vi.mock('@/server/payments/online', () => ({
  isOnlineMethod: (m: string) => m === 'RAZORPAY' || m === 'PHONEPE',
  startOnlinePayment: vi.fn(async () => ({ providerName: 'mock', redirectUrl: null })),
  precheckYoupiPayment: vi.fn(async () => null),
}));
vi.mock('@/server/tenancy', () => ({
  requireRestaurant: vi.fn(async () => ({ id: 'r' })),
  accessibleOrderScope: vi.fn(async () => ({ ...h.scope, labelByBranchId: {} })),
}));

import { prisma } from '@/server/db';
import { placeOrder } from '@/server/orders';
import { handleOrderRelease } from '@/server/pg/fulfillment';
import { GET as kitchenOrders } from '@/app/api/kitchen/orders/route';

let restaurantId = '';
let branchId = '';
let comboId = '';
let customerId = '';
let receivingAccountId = '';

async function kitchenIds(): Promise<string[]> {
  const res = await kitchenOrders();
  const body = (await res.json()) as { orders: { id: string }[] };
  return body.orders.map((o) => o.id);
}

const place = (paymentMethod: any, paymentRail?: 'youpi') =>
  placeOrder({ branchId, customerId, items: [{ comboId, quantity: 1 }], paymentMethod, paymentRail, fulfillmentType: 'PICKUP' as any });

/** Simulates what allocateBankCredit() leaves behind: Payment + attempt CAPTURED. */
async function capturedAttempt(orderId: string, n: number) {
  const payment = await prisma.payment.create({
    data: { orderId, method: 'PHONEPE', status: 'CAPTURED', amount: 300 as any, currency: 'INR', providerName: 'youpi', providerRef: `${orderId}-k${n}` },
  });
  const attempt = await prisma.pgPaymentAttempt.create({
    data: {
      paymentId: payment.id, orderId, restaurantId, receivingAccountId,
      attemptKey: `${orderId}-k${n}`, idempotencyKey: `${orderId}-k${n}`, gatewayMerchantId: 'm-test',
      expectedAmountPaise: 30000, state: 'CAPTURED',
    },
  });
  return { orderId, attemptId: attempt.id, paymentId: payment.id };
}

beforeAll(async () => {
  const owner = await prisma.user.create({ data: { role: 'ADMIN', email: 'owner-d@test.invalid' } });
  const customer = await prisma.user.create({ data: { role: 'CUSTOMER', phone: '+910000000001' } });
  customerId = customer.id;
  const r = await prisma.restaurant.create({ data: { slug: 'd-rest', name: 'D Rest', ownerUserId: owner.id } });
  restaurantId = r.id;
  const b = await prisma.branch.create({ data: { restaurantId, name: 'Main', slug: 'd-main', line1: 'x', city: 'y', postalCode: '560001' } });
  branchId = b.id;
  h.scope.branchIds = [branchId];
  h.scope.primaryBranchId = branchId;
  const c = await prisma.combo.create({ data: { branchId, name: 'Thali', slug: 'thali', price: 300 as any } });
  comboId = c.id;
  const acct = await prisma.pgReceivingAccount.create({
    data: {
      restaurantId, gatewayMerchantId: 'm-test', vpa: 'test@upi', vpaNormalized: 'test@upi',
      accountFingerprint: 'fp-test', legalEntityName: 'D Rest Pvt', status: 'VERIFIED',
    },
  });
  receivingAccountId = acct.id;
});

beforeEach(() => {
  h.youpiEnabled.mockReset();
  h.youpiEnabled.mockResolvedValue(true);
});

describe('order placement status per rail (regression)', () => {
  it.each(['COD', 'PHONEPE', 'RAZORPAY'])('%s orders still start RECEIVED and reach the kitchen queue', async (m) => {
    const { order } = await place(m);
    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe('RECEIVED');
    expect(await kitchenIds()).toContain(order.id);
  });

  it('Flavrly PG order starts PAYMENT_PENDING and is NOT in the kitchen queue', async () => {
    const { order } = await place('PHONEPE', 'youpi');
    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { statusEvents: true } });
    expect(row.status).toBe('PAYMENT_PENDING');
    expect(row.statusEvents.map((e) => e.status)).toEqual(['PAYMENT_PENDING']);
    expect(await kitchenIds()).not.toContain(order.id);
  });

  it('Flavrly PG not enabled for the restaurant -> refused before any order row is written', async () => {
    h.youpiEnabled.mockResolvedValue(false);
    const before = await prisma.order.count();
    await expect(place('PHONEPE', 'youpi')).rejects.toThrow(/not available/);
    expect(await prisma.order.count()).toBe(before);
  });
});

describe('ORDER_RELEASE handler against the real kitchen query', () => {
  it('releases a captured PAYMENT_PENDING order into the kitchen exactly once', async () => {
    const { order } = await place('PHONEPE', 'youpi');
    const p = await capturedAttempt(order.id, 1);
    expect(await kitchenIds()).not.toContain(order.id);

    expect((await handleOrderRelease(p)).outcome).toBe('RELEASED');
    expect(await kitchenIds()).toContain(order.id);
    // Redelivery is a no-op: still one RECEIVED event.
    expect((await handleOrderRelease(p)).outcome).toBe('ALREADY_RELEASED');
    const received = await prisma.orderStatusEvent.count({ where: { orderId: order.id, status: 'RECEIVED' } });
    expect(received).toBe(1);
  });

  it('concurrent deliveries transition once and fire customer/kitchen side effects once', async () => {
    const { order } = await place('PHONEPE', 'youpi');
    const p = await capturedAttempt(order.id, 2);
    h.sms.mockClear();
    h.publish.mockClear();
    const outcomes = (await Promise.all([handleOrderRelease(p), handleOrderRelease(p), handleOrderRelease(p)])).map((r) => r.outcome);
    // Losers either see RECEIVED up front or hit transitionOrder's same-state no-op.
    for (const o of outcomes) expect(['RELEASED', 'ALREADY_RELEASED']).toContain(o);
    expect(await prisma.orderStatusEvent.count({ where: { orderId: order.id, status: 'RECEIVED' } })).toBe(1);
    expect(h.sms.mock.calls.filter(([a]) => a.template === 'order.received')).toHaveLength(1);
    const kitchenStatus = h.publish.mock.calls.filter(([ch, ev]) => ch === `branch:${branchId}:orders` && ev.status === 'RECEIVED');
    expect(kitchenStatus).toHaveLength(1);
  });

  it('existing auto-accept policy fires on release', async () => {
    await prisma.restaurant.update({ where: { id: restaurantId }, data: { autoAcceptOrders: true } });
    try {
      const { order } = await place('PHONEPE', 'youpi');
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAYMENT_PENDING');
      await handleOrderRelease(await capturedAttempt(order.id, 3));
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('ACCEPTED');
    } finally {
      await prisma.restaurant.update({ where: { id: restaurantId }, data: { autoAcceptOrders: false } });
    }
  });

  it('cancelled before payment -> not released, one LATE_PAYMENT exception even on redelivery', async () => {
    const { order } = await place('PHONEPE', 'youpi');
    await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED_BY_CUSTOMER' } });
    const p = await capturedAttempt(order.id, 4);
    expect((await handleOrderRelease(p)).outcome).toBe('LATE_PAYMENT');
    expect((await handleOrderRelease(p)).outcome).toBe('LATE_PAYMENT');
    const ex = await prisma.pgReconException.findMany({ where: { orderId: order.id } });
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ kind: 'LATE_PAYMENT', dedupeKey: `LATE_PAYMENT:${p.attemptId}`, status: 'OPEN', amountPaise: 30000 });
    expect(await kitchenIds()).not.toContain(order.id);
  });
});
