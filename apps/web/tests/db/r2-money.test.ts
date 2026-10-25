/**
 * Round-2 money audit fixes (PG_AUDIT_FINDINGS.md P0/P1/P2) against real Postgres.
 * Only gateway HTTP (fetch stub from h-support) and notification side effects are mocked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64'); // fake test key
  delete process.env.REDIS_URL;
});
vi.mock('@/server/realtime', () => ({ publish: vi.fn() }));
vi.mock('@/server/notifications', () => ({ notify: { sms: vi.fn(async () => undefined) } }));
vi.mock('@/server/push/milestones', () => ({ pushOrderMilestone: vi.fn(async () => undefined) }));
vi.mock('@/server/rider-push', () => ({ notifyRidersOfNewOrder: vi.fn(async () => undefined) }));
vi.mock('@/server/batch-dispatch', () => ({ maybeOfferAsBatch: vi.fn(async () => undefined) }));
vi.mock('@/server/operating-hours', () => ({
  isBranchOpenAt: () => ({ isOpen: true, label: 'Open' }),
  isScheduledTimeInsideOpenWindow: () => true,
}));

import { prisma } from '@/server/db';
import { createPgAttempt, expireStaleAttempts, precheckPgAttempt, sweepUnpaidPgOrders } from '@/server/pg/attempts';
import { approveManualAllocation, proposeManualAllocation, recordObservation, tryAllocateBankTxn } from '@/server/pg/reconcile-engine';
import { reconcileYoupiPayment } from '@/server/payments/youpi-reconcile';
import { runOutbox } from '@/server/pg/outbox';
import { PgUnavailableError, placeOrder, transitionOrder } from '@/server/orders';
import { gatewayFetch, makePendingOrder, makeSession, makeTenant, uid, type GatewayStatus, type Tenant } from './h-support';

const gw = new Map<string, GatewayStatus>();
const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(gatewayFetch(gw, calls)));
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma.$disconnect();
});

const start = (t: Tenant, orderId: string, amountPaise: number) =>
  createPgAttempt({ id: orderId, restaurantId: t.restaurantId, customerId: t.customerId }, { amountPaise, method: 'RAZORPAY' });

const utr = () => `U${uid().toUpperCase()}`;

async function credit(t: Tenant, amountPaise: number, reference: string, opts: { source?: 'STATEMENT_IMPORT' | 'MANUAL'; direction?: 'CREDIT' | 'DEBIT' } = {}) {
  return prisma.pgBankTransaction.create({
    data: {
      receivingAccountId: t.account.id,
      direction: opts.direction ?? 'CREDIT',
      amountPaise,
      bankReference: reference,
      valueAt: new Date(),
      source: opts.source ?? 'STATEMENT_IMPORT',
      sourceRowHash: uid(),
      status: 'UNMATCHED',
    },
  });
}

const orderStatus = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

async function observe(attemptId: string, reference: string, amountPaise: number, payableAmountPaise?: number) {
  return recordObservation({
    attemptId,
    source: 'GATEWAY_WEBHOOK',
    utr: reference,
    amountPaise,
    payableAmountPaise,
    authenticated: true,
    dedupeKey: `webhook:${uid()}`,
  });
}

/** Expire an AWAITING_PAYMENT attempt through the real worker stage (gateway confirms EXPIRED). */
async function expire(attemptId: string, gatewayPaymentId: string) {
  await prisma.pgPaymentAttempt.update({ where: { id: attemptId }, data: { expiresAt: new Date(Date.now() - 2 * 3_600_000) } });
  gw.set(gatewayPaymentId, { status: 'EXPIRED' });
  await expireStaleAttempts({ limit: 500 });
  expect((await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: attemptId } })).state).toBe('EXPIRED');
}

describe('P0-1 retry after expiry', () => {
  let T: Tenant;
  beforeAll(async () => {
    T = await makeTenant();
  });

  it('a retry moves PAYMENT_FAILED back to PAYMENT_PENDING; the new credit captures and releases (not LATE_PAYMENT)', async () => {
    const order = await makePendingOrder(T, 23000);
    const first = await start(T, order.id, 23000);
    await expire(first.attemptId, first.gatewayPaymentId);
    expect(await orderStatus(order.id)).toBe('PAYMENT_FAILED');

    const second = await start(T, order.id, 23000);
    expect(second.reused).toBe(false);
    expect(await orderStatus(order.id)).toBe('PAYMENT_PENDING');

    const ref = utr();
    await observe(second.attemptId, ref, 23000);
    const c = await credit(T, 23000, ref);
    const r = await tryAllocateBankTxn(c.id);
    expect(r.outcome).toBe('CAPTURED');
    await runOutbox();
    expect(await orderStatus(order.id)).toBe('RECEIVED');
    const events = await prisma.orderStatusEvent.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' }, select: { status: true } });
    expect(events.map((e) => e.status)).toEqual(['PAYMENT_PENDING', 'PAYMENT_FAILED', 'PAYMENT_PENDING', 'RECEIVED']);
  });

  it('refuses to revive an order whose free gift was already given back, and leaves it untouched', async () => {
    const order = await makePendingOrder(T, 21000);
    await prisma.orderItem.create({ data: { orderId: order.id, name: 'Gift', unitPrice: '0', quantity: 1, isFreebie: true } });
    await prisma.order.update({ where: { id: order.id }, data: { status: 'PAYMENT_FAILED', freebieRuleId: null } });
    await expect(start(T, order.id, 21000)).rejects.toMatchObject({ status: 409, code: 'BENEFITS_RELEASED' });
    expect(await orderStatus(order.id)).toBe('PAYMENT_FAILED');
    expect(await prisma.pgPaymentAttempt.count({ where: { orderId: order.id } })).toBe(0);
  });

  it('refuses a session for a cancelled order', async () => {
    const order = await makePendingOrder(T, 20500);
    await transitionOrder(order.id, 'CANCELLED_BY_CUSTOMER');
    await expect(start(T, order.id, 20500)).rejects.toMatchObject({ status: 409, code: 'NOT_PAYABLE' });
  });
});

describe('P0-2 refusals never strand a committed order', () => {
  let T: Tenant;
  beforeAll(async () => {
    T = await makeTenant();
  });

  it('precheck refuses zero total, amount over the cap and an exhausted daily cap, without writing anything', async () => {
    await expect(precheckPgAttempt({ restaurantId: T.restaurantId, customerId: T.customerId }, { amountPaise: 0 })).rejects.toMatchObject({ code: 'AMOUNT' });
    await expect(precheckPgAttempt({ restaurantId: T.restaurantId, customerId: T.customerId }, { amountPaise: 500_001 })).rejects.toMatchObject({ code: 'AMOUNT_CAP' });
    await expect(precheckPgAttempt({ restaurantId: T.restaurantId, customerId: T.customerId }, { amountPaise: 10000, currency: 'USD' })).rejects.toMatchObject({ code: 'CURRENCY' });
    await prisma.pgReceivingAccount.update({ where: { id: T.account.id }, data: { dailyCountLimit: 1 } });
    const { istDay } = await import('@/server/pg/limits');
    await prisma.pgAccountDailyUsage.create({ data: { receivingAccountId: T.account.id, day: istDay(), reserved: 1 } });
    await expect(precheckPgAttempt({ restaurantId: T.restaurantId, customerId: T.customerId }, { amountPaise: 10000 })).rejects.toMatchObject({ code: 'DAILY_CAP' });
    await prisma.pgAccountDailyUsage.updateMany({ where: { receivingAccountId: T.account.id }, data: { reserved: 0 } });
    await prisma.pgReceivingAccount.update({ where: { id: T.account.id }, data: { dailyCountLimit: null } });
    await expect(precheckPgAttempt({ restaurantId: T.restaurantId, customerId: T.customerId }, { amountPaise: 10000 })).resolves.toBeUndefined();
  });

  it('placeOrder refuses a ₹0 (wallet-covered) direct-UPI order BEFORE committing: no order, wallet untouched', async () => {
    const combo = await prisma.combo.create({ data: { branchId: T.branchId, name: 'Thali', slug: `thali-${uid()}`, price: '300' } });
    await prisma.wallet.upsert({ where: { userId: T.customerId }, update: { balance: '10000' }, create: { userId: T.customerId, balance: '10000' } });
    const before = await prisma.order.count({ where: { customerId: T.customerId } });
    const err = await placeOrder({
      branchId: T.branchId,
      customerId: T.customerId,
      items: [{ comboId: combo.id, quantity: 1 }],
      paymentMethod: 'PHONEPE',
      paymentRail: 'youpi',
      fulfillmentType: 'PICKUP',
      walletApply: 10000,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PgUnavailableError);
    expect(String(err.message)).toMatch(/Nothing is left to pay/);
    expect(await prisma.order.count({ where: { customerId: T.customerId } })).toBe(before);
    expect(Number((await prisma.wallet.findUniqueOrThrow({ where: { userId: T.customerId } })).balance)).toBe(10000);
  });

  it('a PAYMENT_PENDING PG order with no attempt is failed by the sweep; a fresh one and one with a live attempt are not', async () => {
    const old = await makePendingOrder(T, 12000, new Date(Date.now() - 2 * 3_600_000));
    await prisma.orderStatusEvent.updateMany({ where: { orderId: old.id }, data: { createdAt: new Date(Date.now() - 2 * 3_600_000) } });
    const fresh = await makePendingOrder(T, 12100);
    const busy = await makePendingOrder(T, 12200, new Date(Date.now() - 2 * 3_600_000));
    await prisma.orderStatusEvent.updateMany({ where: { orderId: busy.id }, data: { createdAt: new Date(Date.now() - 2 * 3_600_000) } });
    await makeSession(T, busy.id, 12200, { state: 'OBSERVED', createdAt: new Date(Date.now() - 2 * 3_600_000) });

    await sweepUnpaidPgOrders({ limit: 500 });
    expect(await orderStatus(old.id)).toBe('PAYMENT_FAILED');
    expect(await orderStatus(fresh.id)).toBe('PAYMENT_PENDING');
    expect(await orderStatus(busy.id)).toBe('PAYMENT_PENDING');
  });
});

describe('P0-3 lost webhook + paise offset', () => {
  let T: Tenant;
  beforeAll(async () => {
    T = await makeTenant();
  });

  it('dual-control manual allocation accepts expected < credit <= expected + 99 and records the payable', async () => {
    const order = await makePendingOrder(T, 30000);
    const s = await makeSession(T, order.id, 30000, { state: 'OBSERVED' });
    const c = await credit(T, 30037, utr());
    const auto = await tryAllocateBankTxn(c.id);
    expect(auto.outcome).not.toBe('CAPTURED');
    const p = await proposeManualAllocation({ attemptId: s.attempt.id, bankTransactionId: c.id, operatorId: 'ops-a', reason: 'statement row matches, webhook lost' });
    const r = await approveManualAllocation({ proposalId: p.proposalId, approverId: 'ops-b' });
    expect(r.outcome).toBe('CAPTURED');
    const a = await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: s.attempt.id } });
    expect(a.payableAmountPaise).toBe(30037);
    expect(a.state).toBe('CAPTURED');
  });

  it('still refuses a manual credit outside the offset band (and any amount once the payable is known)', async () => {
    const order = await makePendingOrder(T, 30000);
    const s = await makeSession(T, order.id, 30000, { state: 'OBSERVED' });
    const big = await credit(T, 30100, utr());
    const p = await proposeManualAllocation({ attemptId: s.attempt.id, bankTransactionId: big.id, operatorId: 'ops-a', reason: 'x' });
    expect((await approveManualAllocation({ proposalId: p.proposalId, approverId: 'ops-b' })).outcome).toBe('REJECTED');

    await prisma.pgPaymentAttempt.update({ where: { id: s.attempt.id }, data: { payableAmountPaise: 30010 } });
    const off = await credit(T, 30020, utr());
    const p2 = await proposeManualAllocation({ attemptId: s.attempt.id, bankTransactionId: off.id, operatorId: 'ops-a', reason: 'x' });
    expect((await approveManualAllocation({ proposalId: p2.proposalId, approverId: 'ops-b' })).outcome).toBe('REJECTED');
    expect((await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: s.attempt.id } })).state).toBe('OBSERVED');
  });
});

describe('P0-4 gateway FAILED/EXPIRED settles the order', () => {
  let T: Tenant;
  beforeAll(async () => {
    T = await makeTenant();
  });

  it('gateway FAILED with no other live attempt -> attempt FAILED, limit released, order PAYMENT_FAILED', async () => {
    const order = await makePendingOrder(T, 14000);
    const s = await start(T, order.id, 14000);
    gw.set(s.gatewayPaymentId, { status: 'FAILED' });
    const out = await reconcileYoupiPayment(s.paymentId);
    expect(out.status).toBe('FAILED');
    expect((await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: s.attemptId } })).state).toBe('FAILED');
    expect((await prisma.pgLimitReservation.findUniqueOrThrow({ where: { attemptId: s.attemptId } })).state).toBe('RELEASED');
    expect(await orderStatus(order.id)).toBe('PAYMENT_FAILED');
  });
});
