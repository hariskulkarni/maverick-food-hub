/**
 * Customer-flow audit (round 3) against real Postgres: wallet/loyalty/bonus/offer concurrency,
 * benefit restore on cancel, refund cap, and the PAYMENT_PENDING lifecycle for PhonePe/Razorpay.
 * Mocked: notifications/realtime, operating hours, gateway session creation.
 */
import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  open: true,
  publish: vi.fn(),
  startOnlinePayment: vi.fn(async (..._a: unknown[]) => ({ providerName: 'phonepe', redirectUrl: 'https://pay.example.test/x' }) as unknown),
}));

vi.mock('@/server/realtime', () => ({ publish: h.publish }));
vi.mock('@/server/notifications', () => ({ notify: { sms: vi.fn(async () => undefined) } }));
vi.mock('@/server/push/milestones', () => ({ pushOrderMilestone: vi.fn(async () => undefined) }));
vi.mock('@/server/rider-push', () => ({ notifyRidersOfNewOrder: vi.fn(async () => undefined) }));
vi.mock('@/server/batch-dispatch', () => ({ maybeOfferAsBatch: vi.fn(async () => undefined) }));
vi.mock('@/server/operating-hours', () => ({
  isBranchOpenAt: () => ({ isOpen: h.open, label: h.open ? 'Open' : 'Closed — opens tomorrow at 11:00 AM' }),
  isScheduledTimeInsideOpenWindow: () => true,
}));
vi.mock('@/server/payments/online', () => ({
  isOnlineMethod: (m: string) => m === 'RAZORPAY' || m === 'PHONEPE',
  startOnlinePayment: h.startOnlinePayment,
  precheckYoupiPayment: vi.fn(async () => null),
}));
vi.mock('@/server/tenancy', () => ({
  requireRestaurant: vi.fn(async () => ({ id: 'r' })),
  accessibleOrderScope: vi.fn(async () => ({ branchIds: [], primaryBranchId: '', labelByBranchId: {} })),
}));

import { prisma } from '@/server/db';
import { placeOrder, transitionOrder } from '@/server/orders';
import { refundOrder } from '@/server/refunds';
import { markOrderPaymentFailed } from '@/server/payments/reconcile';
import { sweepUnpaidOnlineOrders } from '@/server/jobs/unpaid-online-orders-sweep';
import { POST as razorpayWebhook } from '@/app/api/payments/razorpay/webhook/route';

const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);

interface T { branchId: string; restaurantId: string; comboId: string; customerId: string }

async function tenant(): Promise<T> {
  const id = uid();
  const owner = await prisma.user.create({ data: { role: 'ADMIN', email: `o-${id}@test.invalid` } });
  const customer = await prisma.user.create({ data: { role: 'CUSTOMER', email: `c-${id}@test.invalid` } });
  const r = await prisma.restaurant.create({ data: { slug: `r3-${id}`, name: `R3 ${id}`, ownerUserId: owner.id } });
  const b = await prisma.branch.create({
    data: { restaurantId: r.id, name: 'Main', slug: `r3b-${id}`, line1: 'x', city: 'y', postalCode: '560001', taxRatePct: 0, packagingFee: 0 as any },
  });
  const c = await prisma.combo.create({ data: { branchId: b.id, name: 'Thali', slug: `thali-${id}`, price: 300 as any } });
  return { branchId: b.id, restaurantId: r.id, comboId: c.id, customerId: customer.id };
}

const place = (t: T, extra: Record<string, unknown> = {}) =>
  placeOrder({
    branchId: t.branchId,
    customerId: t.customerId,
    items: [{ comboId: t.comboId, quantity: 1 }],
    paymentMethod: 'COD' as any,
    fulfillmentType: 'PICKUP' as any,
    ...extra,
  } as any);

const status = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
const balance = async (userId: string) => Number((await prisma.wallet.findUniqueOrThrow({ where: { userId } })).balance);
const points = async (userId: string) => (await prisma.loyaltyAccount.findUniqueOrThrow({ where: { userId } })).pointsBalance;

beforeEach(() => {
  h.open = true;
  h.startOnlinePayment.mockClear();
});

describe('P0-1 WALLET payment method', () => {
  let t: T;
  beforeAll(async () => { t = await tenant(); });

  it('rejects WALLET when something is still owed — no order, no CAPTURED payment', async () => {
    await prisma.wallet.create({ data: { userId: t.customerId, balance: 100 as any } });
    const before = await prisma.order.count({ where: { customerId: t.customerId } });
    await expect(place(t, { paymentMethod: 'WALLET', walletApply: 100 })).rejects.toThrow(/wallet/i);
    expect(await prisma.order.count({ where: { customerId: t.customerId } })).toBe(before);
    expect(await balance(t.customerId)).toBe(100);
  });

  it('accepts WALLET only for a fully covered order and records CAPTURED for exactly the debited amount', async () => {
    await prisma.wallet.update({ where: { userId: t.customerId }, data: { balance: 500 as any } });
    const { order } = await place(t, { paymentMethod: 'WALLET', walletApply: 500 });
    expect(Number(order.total)).toBe(0);
    expect(await balance(t.customerId)).toBe(200);
    const pays = await prisma.payment.findMany({ where: { orderId: order.id } });
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ method: 'WALLET', status: 'CAPTURED' });
    expect(Number(pays[0]!.amount)).toBe(300);
  });

  it('refuses an online method for a ₹0 order (nothing to pay at the gateway)', async () => {
    await prisma.wallet.update({ where: { userId: t.customerId }, data: { balance: 500 as any } });
    await expect(place(t, { paymentMethod: 'PHONEPE', walletApply: 500 })).rejects.toThrow(/nothing (is )?left to pay/i);
    expect(await balance(t.customerId)).toBe(500);
  });
});

describe('P0-2 concurrent checkouts cannot overspend', () => {
  it('wallet: 6 concurrent orders against a balance for one -> exactly one debit, balance never negative', async () => {
    const t = await tenant();
    await prisma.wallet.create({ data: { userId: t.customerId, balance: 300 as any } });
    const res = await Promise.allSettled(Array.from({ length: 6 }, () => place(t, { walletApply: 300 })));
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await balance(t.customerId)).toBe(0);
    expect(await prisma.walletTransaction.count({ where: { wallet: { userId: t.customerId }, type: 'ORDER_DEBIT' } })).toBe(1);
  });

  it('loyalty: 6 concurrent orders against points for one -> exactly one redeem', async () => {
    const t = await tenant();
    await prisma.loyaltyAccount.create({ data: { userId: t.customerId, pointsBalance: 200 } });
    const res = await Promise.allSettled(Array.from({ length: 6 }, () => place(t, { loyaltyApply: 200 })));
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await points(t.customerId)).toBe(0);
  });

  it('signup bonus: concurrent orders cannot hold more than the grant balance', async () => {
    const t = await tenant();
    await prisma.signupBonusGrant.create({
      data: { userId: t.customerId, totalAmount: 50 as any, perOrderCap: 50 as any, remainingOrders: 5 },
    });
    const res = await Promise.allSettled(Array.from({ length: 6 }, () => place(t)));
    const ok = res.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof placeOrder>>>[];
    const held = ok.reduce((s, r) => s + Number(r.value.order.signupBonusApplied), 0);
    const grant = await prisma.signupBonusGrant.findUniqueOrThrow({ where: { userId: t.customerId } });
    expect(Number(grant.pendingAmount)).toBe(held);
    expect(Number(grant.pendingAmount)).toBeLessThanOrEqual(50);
  });
});

describe('P1-9 per-customer offer limit under concurrency', () => {
  it('perUserLimit=1 offer redeemed at most once by one customer racing 5 checkouts', async () => {
    const t = await tenant();
    const item = await prisma.category.create({ data: { branchId: t.branchId, name: 'Mains', slug: `m-${uid()}` } as any });
    const mi = await prisma.menuItem.create({ data: { branchId: t.branchId, categoryId: item.id, name: 'Dal', slug: `dal-${uid()}`, price: 300 as any } as any });
    const offer = await prisma.offer.create({
      data: { name: 'Flat 50', type: 'FIXED', flatOff: 50 as any, restaurantId: t.restaurantId, autoApply: true, perUserLimit: 1, isActive: true } as any,
    });
    const res = await Promise.allSettled(
      Array.from({ length: 5 }, () => place(t, { items: [{ menuItemId: mi.id, quantity: 1 }] })),
    );
    expect(res.some((r) => r.status === 'fulfilled')).toBe(true);
    expect(await prisma.offerRedemption.count({ where: { offerId: offer.id, userId: t.customerId } })).toBe(1);
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).usedCount).toBe(1);
  });
});

describe('P0-3 / P1-10 benefits come back on cancel; refund cap includes wallet', () => {
  it('COD order cancelled: wallet, points, coupon and offer usage restored exactly once', async () => {
    const t = await tenant();
    await prisma.wallet.create({ data: { userId: t.customerId, balance: 100 as any } });
    await prisma.loyaltyAccount.create({ data: { userId: t.customerId, pointsBalance: 50 } });
    const offer = await prisma.offer.create({
      data: { name: 'Combo-less', type: 'FIXED', flatOff: 10 as any, code: `C${uid().toUpperCase()}`, restaurantId: t.restaurantId, isActive: true } as any,
    });
    const coupon = await prisma.coupon.create({ data: { code: `LG${uid().toUpperCase()}`, flatOff: 20 as any, perUserLimit: 1 } });
    const { order } = await place(t, { walletApply: 100, loyaltyApply: 50, couponCode: coupon.code });
    expect(await balance(t.customerId)).toBe(0);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(1);
    void offer;

    await transitionOrder(order.id, 'CANCELLED_BY_CUSTOMER');
    await transitionOrder(order.id, 'CANCELLED_BY_CUSTOMER'); // replay no-op
    await transitionOrder(order.id, 'REFUND_PENDING');
    expect(await balance(t.customerId)).toBe(100);
    expect(await points(t.customerId)).toBe(50);
    expect(await prisma.walletTransaction.count({ where: { orderId: order.id, type: 'REFUND' } })).toBe(1);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(0);
    expect(await prisma.couponRedemption.count({ where: { orderId: order.id } })).toBe(0);
    // The coupon is usable again.
    const again = await place(t, { couponCode: coupon.code });
    expect(await prisma.couponRedemption.count({ where: { orderId: again.order.id } })).toBe(1);
  });

  it('offer usage is released on cancel', async () => {
    const t = await tenant();
    const cat = await prisma.category.create({ data: { branchId: t.branchId, name: 'Mains', slug: `m-${uid()}` } as any });
    const mi = await prisma.menuItem.create({ data: { branchId: t.branchId, categoryId: cat.id, name: 'Dal', slug: `dal-${uid()}`, price: 300 as any } as any });
    const offer = await prisma.offer.create({
      data: { name: 'Once', type: 'FIXED', flatOff: 30 as any, restaurantId: t.restaurantId, autoApply: true, perUserLimit: 1, usageLimit: 1, isActive: true } as any,
    });
    const { order } = await place(t, { items: [{ menuItemId: mi.id, quantity: 1 }] });
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).usedCount).toBe(1);
    await transitionOrder(order.id, 'CANCELLED_BY_CUSTOMER');
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: offer.id } })).usedCount).toBe(0);
    expect(await prisma.offerRedemption.count({ where: { orderId: order.id } })).toBe(0);
  });

  it('a legacy coupon whose minimum is not met is not consumed', async () => {
    const t = await tenant();
    const coupon = await prisma.coupon.create({ data: { code: `MIN${uid().toUpperCase()}`, flatOff: 20 as any, minOrderAmount: 1000 as any, perUserLimit: 1 } });
    const { order } = await place(t, { couponCode: coupon.code });
    expect(Number(order.discountAmount)).toBe(0);
    expect(await prisma.couponRedemption.count({ where: { orderId: order.id } })).toBe(0);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usedCount).toBe(0);
  });

  it('delivered order paid partly by wallet: refund cap = total + walletApplied', async () => {
    const t = await tenant();
    await prisma.wallet.create({ data: { userId: t.customerId, balance: 100 as any } });
    const { order } = await place(t, { walletApply: 100 });
    expect(Number(order.total)).toBe(200);
    await prisma.order.update({ where: { id: order.id }, data: { status: 'DELIVERED' } });
    await expect(refundOrder({ orderId: order.id, amount: 300.01, destination: 'WALLET' })).rejects.toThrow(/refundable balance/);
    const r = await refundOrder({ orderId: order.id, amount: 300, destination: 'WALLET' });
    expect(r.walletCredited).toBe(300);
    expect(await balance(t.customerId)).toBe(300);
  });

  it('original-payment refund is capped at the captured amount even when wallet raised the cap', async () => {
    const t = await tenant();
    await prisma.wallet.create({ data: { userId: t.customerId, balance: 100 as any } });
    const { order } = await place(t, { walletApply: 100 });
    await prisma.order.update({ where: { id: order.id }, data: { status: 'DELIVERED', paymentMethod: 'RAZORPAY' } });
    await prisma.payment.deleteMany({ where: { orderId: order.id } });
    await prisma.payment.create({ data: { orderId: order.id, method: 'RAZORPAY', amount: 200 as any, status: 'CAPTURED', providerName: 'mock' } });
    await expect(refundOrder({ orderId: order.id, amount: 250, destination: 'ORIGINAL_PAYMENT' })).rejects.toThrow(/captured/i);
  });
});

describe('P0-4 online orders wait in PAYMENT_PENDING until capture', () => {
  it.each(['PHONEPE', 'RAZORPAY'])('%s order starts PAYMENT_PENDING and is not announced to the kitchen', async (m) => {
    const t = await tenant();
    h.publish.mockClear();
    const { order } = await place(t, { paymentMethod: m });
    expect(await status(order.id)).toBe('PAYMENT_PENDING');
    expect(h.publish.mock.calls.some(([ch, ev]) => ch === `branch:${t.branchId}:orders` && (ev as any).kind === 'order:new')).toBe(false);
  });

  it('auto-accept does not fire for an unpaid online order', async () => {
    const t = await tenant();
    await prisma.restaurant.update({ where: { id: t.restaurantId }, data: { autoAcceptOrders: true } });
    const { order } = await place(t, { paymentMethod: 'PHONEPE' });
    expect(await status(order.id)).toBe('PAYMENT_PENDING');
  });

  it('Razorpay webhook payment.captured (signed) moves the order to RECEIVED and announces it once', async () => {
    const t = await tenant();
    const { order } = await place(t, { paymentMethod: 'RAZORPAY' });
    const pay = await prisma.payment.create({
      data: { orderId: order.id, method: 'RAZORPAY', amount: order.total, providerName: 'razorpay', providerRef: `order_${uid()}` },
    });
    process.env.RAZORPAY_WEBHOOK_SECRET = 'fake-rzp-webhook-secret';
    const body = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: `pay_${uid()}`, order_id: pay.providerRef, status: 'captured', amount: Math.round(Number(order.total) * 100) } } },
    });
    const sig = crypto.createHmac('sha256', 'fake-rzp-webhook-secret').update(body).digest('hex');
    h.publish.mockClear();
    const res = await razorpayWebhook(new Request('http://x', { method: 'POST', body, headers: { 'x-razorpay-signature': sig, 'x-razorpay-event-id': `evt_${uid()}` } }) as any);
    expect(res.status).toBe(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } })).status).toBe('CAPTURED');
    expect(await status(order.id)).toBe('RECEIVED');
    expect(h.publish.mock.calls.filter(([ch, ev]) => ch === `branch:${t.branchId}:orders` && (ev as any).kind === 'order:new')).toHaveLength(1);
  });

  it('Razorpay webhook with a mismatched amount does not capture', async () => {
    const t = await tenant();
    const { order } = await place(t, { paymentMethod: 'RAZORPAY' });
    const pay = await prisma.payment.create({
      data: { orderId: order.id, method: 'RAZORPAY', amount: order.total, providerName: 'razorpay', providerRef: `order_${uid()}` },
    });
    process.env.RAZORPAY_WEBHOOK_SECRET = 'fake-rzp-webhook-secret';
    const body = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: `pay_${uid()}`, order_id: pay.providerRef, status: 'captured', amount: 100 } } },
    });
    const sig = crypto.createHmac('sha256', 'fake-rzp-webhook-secret').update(body).digest('hex');
    await razorpayWebhook(new Request('http://x', { method: 'POST', body, headers: { 'x-razorpay-signature': sig, 'x-razorpay-event-id': `evt_${uid()}` } }) as any);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } })).status).toBe('PENDING');
    expect(await status(order.id)).toBe('PAYMENT_PENDING');
  });

  it('payment failure: PAYMENT_FAILED keeps benefits held (retry possible); cancel releases them', async () => {
    const t = await tenant();
    await prisma.wallet.create({ data: { userId: t.customerId, balance: 50 as any } });
    const { order } = await place(t, { paymentMethod: 'PHONEPE', walletApply: 50 });
    expect(await markOrderPaymentFailed(order.id, 'expired')).toBe(true);
    expect(await status(order.id)).toBe('PAYMENT_FAILED');
    expect(await balance(t.customerId)).toBe(0);
    await transitionOrder(order.id, 'CANCELLED_BY_CUSTOMER');
    expect(await balance(t.customerId)).toBe(50);
  });

  it('markOrderPaymentFailed never touches an order the kitchen already accepted', async () => {
    const t = await tenant();
    const { order } = await place(t);
    await transitionOrder(order.id, 'ACCEPTED');
    expect(await markOrderPaymentFailed(order.id, 'x')).toBe(false);
    expect(await status(order.id)).toBe('ACCEPTED');
  });

  it('sweep: stale unpaid online order -> PAYMENT_FAILED; stale PAYMENT_FAILED -> cancelled with wallet back; fresh untouched', async () => {
    const t = await tenant();
    await prisma.wallet.create({ data: { userId: t.customerId, balance: 40 as any } });
    const old = (await place(t, { paymentMethod: 'RAZORPAY', walletApply: 40 })).order;
    const fresh = (await place(t, { paymentMethod: 'RAZORPAY' })).order;
    const past = new Date(Date.now() - 2 * 3_600_000);
    await prisma.order.update({ where: { id: old.id }, data: { createdAt: past } });
    await prisma.orderStatusEvent.updateMany({ where: { orderId: old.id }, data: { createdAt: past } });
    await prisma.payment.create({ data: { orderId: old.id, method: 'RAZORPAY', amount: old.total, providerName: 'razorpay', providerRef: `order_${uid()}`, createdAt: past } });

    await sweepUnpaidOnlineOrders({ limit: 500 });
    expect(await status(old.id)).toBe('PAYMENT_FAILED');
    expect(await status(fresh.id)).toBe('PAYMENT_PENDING');

    const later = new Date(Date.now() + 25 * 3_600_000);
    await sweepUnpaidOnlineOrders({ limit: 500, now: later });
    expect(await status(old.id)).toBe('CANCELLED_BY_ADMIN');
    expect(await balance(t.customerId)).toBe(40);
  });

  it('sweep never fails an order that has a captured payment', async () => {
    const t = await tenant();
    const o = (await place(t, { paymentMethod: 'RAZORPAY' })).order;
    const past = new Date(Date.now() - 2 * 3_600_000);
    await prisma.order.update({ where: { id: o.id }, data: { createdAt: past } });
    await prisma.orderStatusEvent.updateMany({ where: { orderId: o.id }, data: { createdAt: past } });
    await prisma.payment.create({ data: { orderId: o.id, method: 'RAZORPAY', amount: o.total, status: 'CAPTURED', providerName: 'razorpay', providerRef: `order_${uid()}`, createdAt: past } });
    await sweepUnpaidOnlineOrders({ limit: 500 });
    expect(await status(o.id)).toBe('PAYMENT_PENDING');
  });
});

describe('P1-8 closed-hours bypass', () => {
  it('scheduled order while closed is refused when the restaurant has scheduling disabled', async () => {
    const t = await tenant();
    await prisma.restaurant.update({ where: { id: t.restaurantId }, data: { scheduledOrdersEnabled: false } });
    h.open = false;
    const when = new Date(Date.now() + 3 * 3_600_000).toISOString();
    await expect(place(t, { scheduledFor: when })).rejects.toThrow(/schedul/i);
    expect(await prisma.order.count({ where: { customerId: t.customerId } })).toBe(0);
  });
});
