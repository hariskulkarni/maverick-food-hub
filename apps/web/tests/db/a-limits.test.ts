/**
 * Agent A real-Postgres proofs: limit reservation atomicity and one-session-per-order under
 * concurrency (receiving-account row lock + conditional daily increment).
 * Gateway HTTP and the merchant binding are stubbed; every DB write is real.
 */
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ resolveBinding: vi.fn() }));
vi.mock('@/server/pg/merchant-binding', () => ({ resolveBinding: h.resolveBinding }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { prisma } from '@/server/db';
import { createPgAttempt } from '@/server/pg/attempts';
import { reserveLimit, releaseLimit, istDay } from '@/server/pg/limits';

const uid = () => randomUUID().replace(/-/g, '').slice(0, 16);

async function makeAccount() {
  const id = uid();
  const owner = await prisma.user.create({ data: { email: `owner-${id}@example.test`, role: 'ADMIN' } });
  const restaurant = await prisma.restaurant.create({ data: { slug: `r-${id}`, name: `R ${id}`, ownerUserId: owner.id } });
  const branch = await prisma.branch.create({
    data: { restaurantId: restaurant.id, name: 'Main', slug: `b-${id}`, line1: 'x', city: 'Pune', postalCode: '411001' },
  });
  const account = await prisma.pgReceivingAccount.create({
    data: {
      restaurantId: restaurant.id, gatewayMerchantId: `m-${id}`, vpa: `shop${id}@bank`, vpaNormalized: `shop${id}@bank`,
      accountFingerprint: `fp-${id}`, legalEntityName: 'Test Foods Pvt Ltd', status: 'VERIFIED',
    },
  });
  return { restaurant, branch, account };
}
type Acc = Awaited<ReturnType<typeof makeAccount>>;

async function makeOrder(acc: Acc) {
  const customer = await prisma.user.create({ data: { email: `c-${uid()}@example.test` } });
  return prisma.order.create({
    data: {
      code: `ORD-${uid()}`, branchId: acc.branch.id, customerId: customer.id, status: 'PAYMENT_PENDING',
      subtotal: '250.50', total: '250.50', paymentMethod: 'RAZORPAY',
    },
  });
}

function bindingFor(acc: Acc, limits: Partial<Record<string, number>> = {}) {
  return {
    restaurantId: acc.restaurant.id, receivingAccountId: acc.account.id, gatewayMerchantId: acc.account.gatewayMerchantId,
    vpa: acc.account.vpaNormalized, baseUrl: 'https://pg.test', merchantId: acc.account.gatewayMerchantId,
    webhookSecret: 'whs-fake', credentialSource: 'RESTAURANT', disabledForNew: false,
    limits: { dailyLimit: 100, maxAmountPaise: 500000, maxPendingPerAccount: 100, customerMaxPending: 100, customerWindowMinutes: 15, sessionTtlMinutes: 15, ...limits },
  };
}

/** Gateway stub: unique paymentId per attemptKey, private readback echoes the bound VPA. */
function stubGateway(vpa: string) {
  const byId = new Map<string, string>();
  let creates = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init: any = {}) => {
    if (init.method === 'POST') {
      creates++;
      const key = JSON.parse(init.body).orderId as string;
      const pid = `gp-${key}`;
      byId.set(pid, key);
      // Widen the race window between the local commit and the next starter.
      await new Promise((r) => setTimeout(r, 20));
      return new Response(JSON.stringify({ paymentId: pid, checkoutUrl: `https://pay.test/checkout/${pid}` }), { status: 201 });
    }
    const pid = decodeURIComponent(String(input).split('/').pop()!);
    return new Response(
      JSON.stringify({ paymentId: pid, orderId: byId.get(pid), amountPaise: '25050', currency: 'INR', status: 'INITIATED', metadata: { receivingAccountSnapshot: { upiId: vpa } } }),
      { status: 200 },
    );
  });
  return { creates: () => creates };
}

const start = (acc: Acc, order: { id: string; customerId: string }) =>
  createPgAttempt({ id: order.id, restaurantId: acc.restaurant.id, customerId: order.customerId }, { amountPaise: 25050, method: 'RAZORPAY' });

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('limits and attempts on real Postgres', () => {
  it('daily cap holds under 10 concurrent starts on one account (exactly 3 sessions)', async () => {
    const acc = await makeAccount();
    h.resolveBinding.mockResolvedValue(bindingFor(acc, { dailyLimit: 3 }));
    const gw = stubGateway(acc.account.vpaNormalized);
    const orders = await Promise.all(Array.from({ length: 10 }, () => makeOrder(acc)));

    const results = await Promise.allSettled(orders.map((o) => start(acc, o)));
    const ok = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(3);
    expect(rejected.every((r) => r.reason.code === 'DAILY_CAP')).toBe(true);
    expect(gw.creates()).toBe(3);

    const usage = await prisma.pgAccountDailyUsage.findUnique({
      where: { receivingAccountId_day: { receivingAccountId: acc.account.id, day: istDay() } },
    });
    expect(usage?.reserved).toBe(3);
    expect(await prisma.pgLimitReservation.count({ where: { receivingAccountId: acc.account.id, state: 'RESERVED' } })).toBe(3);
    // Rejected starts rolled back completely: no orphan Payment/attempt rows.
    expect(await prisma.pgPaymentAttempt.count({ where: { receivingAccountId: acc.account.id } })).toBe(3);
    expect(await prisma.payment.count({ where: { orderId: { in: orders.map((o) => o.id) } } })).toBe(3);
  });

  it('duplicate clicks: 5 concurrent starts for ONE order -> one gateway session', async () => {
    const acc = await makeAccount();
    h.resolveBinding.mockResolvedValue(bindingFor(acc));
    const gw = stubGateway(acc.account.vpaNormalized);
    const order = await makeOrder(acc);

    const results = await Promise.allSettled(Array.from({ length: 5 }, () => start(acc, order)));
    const ok = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    expect(gw.creates()).toBe(1);
    expect(await prisma.pgPaymentAttempt.count({ where: { orderId: order.id } })).toBe(1);
    // Starters that lost the race either got the same session back or a 409; never a second session.
    expect(new Set(ok.map((r) => r.value.gatewayPaymentId)).size).toBe(1);
    for (const r of results) if (r.status === 'rejected') expect(r.reason.status).toBe(409);
  });

  it('pending-session cap per account holds under concurrency', async () => {
    const acc = await makeAccount();
    h.resolveBinding.mockResolvedValue(bindingFor(acc, { maxPendingPerAccount: 2 }));
    stubGateway(acc.account.vpaNormalized);
    const orders = await Promise.all(Array.from({ length: 6 }, () => makeOrder(acc)));
    const results = await Promise.allSettled(orders.map((o) => start(acc, o)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(await prisma.pgPaymentAttempt.count({ where: { receivingAccountId: acc.account.id, state: 'AWAITING_PAYMENT' } })).toBe(2);
  });

  it('conditional daily increment alone is atomic (no account lock), and release is idempotent', async () => {
    const acc = await makeAccount();
    // Pre-create 8 terminal attempts so reservations have their FK target.
    const attempts = [];
    for (let i = 0; i < 8; i++) {
      const o = await makeOrder(acc);
      const p = await prisma.payment.create({ data: { orderId: o.id, method: 'RAZORPAY', amount: '250.50', providerName: 'youpi' } });
      const key = `${o.id}-${uid()}`;
      attempts.push(
        await prisma.pgPaymentAttempt.create({
          data: {
            paymentId: p.id, orderId: o.id, restaurantId: acc.restaurant.id, receivingAccountId: acc.account.id, attemptKey: key,
            idempotencyKey: key, gatewayMerchantId: acc.account.gatewayMerchantId, expectedAmountPaise: 25050, state: 'FAILED',
          },
        }),
      );
    }
    const limits = { dailyLimit: 5, maxAmountPaise: 500000, maxPendingPerAccount: 100, customerMaxPending: 100, customerWindowMinutes: 15 };
    const results = await Promise.allSettled(
      attempts.map((a) =>
        prisma.$transaction((tx) =>
          reserveLimit(tx, { attemptId: a.id, receivingAccountId: acc.account.id, amountPaise: 25050, limits, customerId: 'nobody' }),
        ),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    const where = { receivingAccountId_day: { receivingAccountId: acc.account.id, day: istDay() } };
    expect((await prisma.pgAccountDailyUsage.findUnique({ where }))?.reserved).toBe(5);

    const held = await prisma.pgLimitReservation.findFirstOrThrow({ where: { receivingAccountId: acc.account.id } });
    const rel = await Promise.all([1, 2, 3].map(() => prisma.$transaction((tx) => releaseLimit(tx, held.attemptId))));
    expect(rel.filter(Boolean)).toHaveLength(1);
    expect((await prisma.pgAccountDailyUsage.findUnique({ where }))?.reserved).toBe(4);
  });
});
