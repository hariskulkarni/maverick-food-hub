/**
 * Agent H — session creation (pg/attempts.ts, D8/D9) and manual refunds (pg/refunds.ts, D13)
 * against real Postgres. Gateway HTTP is the recording fetch stub from h-support.
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

import { prisma } from '@/server/db';
import { createPgAttempt, expireStaleAttempts, resolveUnknownAttempt } from '@/server/pg/attempts';
import { recordObservation, recordReversal, tryAllocateBankTxn } from '@/server/pg/reconcile-engine';
import { approvePgRefund, completePgRefund, requestPgRefund } from '@/server/pg/refunds';
import { runOutbox } from '@/server/pg/outbox';
import { transitionOrder } from '@/server/orders';
import {
  gatewayFetch,
  gatewayFlags,
  makePendingOrder,
  makeSession,
  makeTenant,
  uid,
  type GatewayStatus,
  type Tenant,
} from './h-support';

const gw = new Map<string, GatewayStatus>();
const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
  gatewayFlags.createDown = false;
  vi.stubGlobal('fetch', vi.fn(gatewayFetch(gw, calls)));
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma.$disconnect();
});

const start = (t: Tenant, orderId: string, amountPaise: number, customerId = t.customerId) =>
  createPgAttempt({ id: orderId, restaurantId: t.restaurantId, customerId }, { amountPaise, method: 'RAZORPAY' });

const posts = () => calls.filter((c) => c.startsWith('POST ')).length;

describe('H attempts: one payable session per order, CREATE_UNKNOWN blocks', () => {
  let T: Tenant;
  beforeAll(async () => {
    T = await makeTenant();
  });

  it('10 parallel starts for one order -> exactly one gateway session; the rest reuse it or are refused', async () => {
    const order = await makePendingOrder(T, 15000);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => start(T, order.id, 15000)));
    const ok = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof start>>> => r.status === 'fulfilled').map((r) => r.value);
    const refused = results.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason?.status);
    expect(ok.filter((s) => !s.reused)).toHaveLength(1);
    expect(new Set(ok.map((s) => s.attemptId)).size).toBe(1);
    for (const st of refused) expect(st).toBe(409);
    expect(posts()).toBe(1);
    expect(await prisma.pgPaymentAttempt.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('gateway create times out -> CREATE_UNKNOWN (Payment stays PENDING, limit kept); a second session is refused until resolved', async () => {
    const order = await makePendingOrder(T, 16000);
    gatewayFlags.createDown = true;
    await expect(start(T, order.id, 16000)).rejects.toMatchObject({ status: 503, code: 'CREATE_UNKNOWN' });
    const a = await prisma.pgPaymentAttempt.findFirstOrThrow({ where: { orderId: order.id } });
    expect(a.state).toBe('CREATE_UNKNOWN');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: a.paymentId } })).status).toBe('PENDING');
    expect((await prisma.pgLimitReservation.findUniqueOrThrow({ where: { attemptId: a.id } })).state).toBe('RESERVED');
    expect(await prisma.pgReconException.count({ where: { dedupeKey: `CREATE_UNKNOWN:${a.id}` } })).toBe(1);

    gatewayFlags.createDown = false;
    const before = posts();
    await expect(start(T, order.id, 16000)).rejects.toMatchObject({ status: 409, code: 'ATTEMPT_UNRESOLVED' });
    expect(posts()).toBe(before); // no second gateway session minted

    // Inside the grace window nothing is concluded; after it, the gateway lookup by attemptKey (404) proves absence.
    expect(await resolveUnknownAttempt(a.id, new Date())).toBe('CREATE_UNKNOWN');
    expect(await resolveUnknownAttempt(a.id, new Date(Date.now() + 3 * 60_000))).toBe('FAILED');
    expect((await prisma.pgLimitReservation.findUniqueOrThrow({ where: { attemptId: a.id } })).state).toBe('RELEASED');
    const retry = await start(T, order.id, 16000);
    expect(retry.reused).toBe(false);
  });

  it('a gateway that created the session but whose response was lost resolves to AWAITING_PAYMENT, not FAILED', async () => {
    const order = await makePendingOrder(T, 16500);
    // Let the create succeed on the gateway, then make the response unreadable: simulate by
    // creating normally and forcing the attempt back to CREATE_UNKNOWN without gatewayPaymentId.
    const s = await start(T, order.id, 16500);
    await prisma.pgPaymentAttempt.update({ where: { id: s.attemptId }, data: { state: 'CREATE_UNKNOWN', gatewayPaymentId: null, createdAt: new Date(Date.now() - 10 * 60_000) } });
    expect(await resolveUnknownAttempt(s.attemptId)).toBe('AWAITING_PAYMENT');
    const a = await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: s.attemptId } });
    expect(a.gatewayPaymentId).toBe(s.gatewayPaymentId);
  });

  it('pending-session cap per receiving account holds under 30 parallel starts from different customers', async () => {
    const U = await makeTenant();
    const orders = [];
    for (let i = 0; i < 30; i++) {
      const c = await prisma.user.create({ data: { email: `c${i}-${uid()}@example.test`, role: 'CUSTOMER' } });
      const o = await prisma.order.create({
        data: { code: `HC-${uid()}`, branchId: U.branchId, customerId: c.id, status: 'PAYMENT_PENDING', subtotal: '100.00', total: '100.00', paymentMethod: 'RAZORPAY' },
      });
      orders.push({ o, c });
    }
    const results = await Promise.allSettled(orders.map(({ o, c }) => start(U, o.id, 10000, c.id)));
    const created = results.filter((r) => r.status === 'fulfilled').length;
    expect(created).toBe(15); // DEFAULT_MAX_PENDING_PER_ACCOUNT (raised from 5; stays below the 20/day cap so it binds)
    for (const r of results) if (r.status === 'rejected') expect((r.reason as { code?: string }).code).toBe('PENDING_CAP');
  });
});

describe('H refunds on chain-captured money', () => {
  let R: Tenant;
  beforeAll(async () => {
    R = await makeTenant();
  });

  /** createPgAttempt -> signed-equivalent observation -> bank credit -> capture -> release -> cancel. */
  async function capturedAndCancelled(amount: number) {
    const order = await makePendingOrder(R, amount);
    const s = await start(R, order.id, amount);
    const utr = `U${uid().toUpperCase()}`;
    await recordObservation({ attemptId: s.attemptId, source: 'GATEWAY_WEBHOOK', utr, amountPaise: amount, authenticated: true, dedupeKey: `h:${uid()}` });
    const t = await prisma.pgBankTransaction.create({
      data: { receivingAccountId: R.account.id, direction: 'CREDIT', amountPaise: amount, bankReference: utr, valueAt: new Date(), source: 'STATEMENT_IMPORT', sourceRowHash: uid() },
    });
    expect((await tryAllocateBankTxn(t.id)).outcome).toBe('CAPTURED');
    await runOutbox();
    await transitionOrder(order.id, 'CANCELLED_BY_ADMIN' as any, { note: 'kitchen closed' });
    return { orderId: order.id, attemptId: s.attemptId, paymentId: s.paymentId, utr, txnId: t.id, amount };
  }

  it('5 parallel full refunds of one captured payment -> exactly one is recorded', async () => {
    const c = await capturedAndCancelled(30000);
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => requestPgRefund({ attemptId: c.attemptId, amountPaise: c.amount, kind: 'ORDER', reason: `dup ${i}`, actor: { id: `req-${i}` } })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.pgRefundRecord.count({ where: { attemptId: c.attemptId } })).toBe(1);
  });

  // DEFECT H-08: completePgRefund (pg/refunds.ts:403) never re-checks the refundable pot. A refund
  // requested before the bank reversed the credit can still be approved and COMPLETED afterwards,
  // so the restaurant refunds money it no longer holds and the books show a refund of a reversed credit.
  it('a refund cannot be completed after the underlying bank credit was reversed', async () => {
    const c = await capturedAndCancelled(31000);
    const r = await requestPgRefund({ attemptId: c.attemptId, amountPaise: c.amount, kind: 'ORDER', reason: 'customer complaint', actor: { id: 'maker' } });
    await recordReversal({ bankTransactionId: c.txnId, reason: 'bank chargeback', actorId: 'ops' });
    // A fresh request is correctly refused (pot excludes reversed allocations) ...
    await expect(requestPgRefund({ attemptId: c.attemptId, amountPaise: 100, kind: 'ORDER', reason: 'x', actor: { id: 'maker' } })).rejects.toMatchObject({ status: 409 });
    // ... but the one already pending must not complete either.
    let completed = false;
    try {
      await approvePgRefund({ refundId: r.refundId, actor: { id: 'checker' } });
      await completePgRefund({ refundId: r.refundId, bankReference: `RF${uid().toUpperCase()}`, evidence: { note: 'bank portal' }, actor: { id: 'checker' } });
      completed = true;
    } catch {
      completed = false;
    }
    expect(completed).toBe(false);
  });

  // DEFECT H-09: the refund "bank reference" is only checked against other refunds. The customer's
  // ORIGINAL payment UTR (a credit, not a refund) is accepted as proof that a refund was sent.
  it("the original payment's UTR is not accepted as the refund bank reference", async () => {
    const c = await capturedAndCancelled(32000);
    const r = await requestPgRefund({ attemptId: c.attemptId, amountPaise: c.amount, kind: 'ORDER', reason: 'complaint', actor: { id: 'maker' } });
    await approvePgRefund({ refundId: r.refundId, actor: { id: 'checker' } });
    await expect(
      completePgRefund({ refundId: r.refundId, bankReference: c.utr, evidence: { note: 'see bank' }, actor: { id: 'checker' } }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('H attempts: worker stage liveness', () => {
  // DEFECT H-10: expireStaleAttempts() step 1 selects the `limit` (50) oldest-by-updatedAt attempts in
  // CREATED/CREATE_UNKNOWN/OBSERVED/REVIEW_REQUIRED (attempts.ts:493-497). Flagging an OBSERVED one only
  // opens a STALE_PENDING exception and does not touch updatedAt, so the same oldest rows are picked
  // every tick. OBSERVED attempts waiting for the next statement import are normal; once there are
  // >= limit of them, CREATE_UNKNOWN attempts are never resolved and their orders stay blocked
  // (createPgAttempt -> 409 ATTEMPT_UNRESOLVED).
  it('CREATE_UNKNOWN attempts still get resolved when many OBSERVED attempts await the bank statement', async () => {
    const W = await makeTenant();
    const unknownAttempt = async (amount: number) => {
      const o = await makePendingOrder(W, amount);
      const u = await makeSession(W, o.id, amount, { state: 'CREATE_UNKNOWN', createdAt: new Date(Date.now() - 2 * 3_600_000) });
      await prisma.pgPaymentAttempt.update({ where: { id: u.attempt.id }, data: { gatewayPaymentId: null } });
      await prisma.$executeRaw`UPDATE "PgPaymentAttempt" SET "updatedAt" = timezone('utc', now()) - interval '2 hours' WHERE "id" = ${u.attempt.id}`;
      return u.attempt.id;
    };
    // Control: with no backlog, one tick resolves it (gateway lookup by attemptKey -> 404 -> FAILED).
    const control = await unknownAttempt(9900);
    await expireStaleAttempts({ limit: 5 });
    expect((await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: control } })).state).toBe('FAILED');

    for (let i = 0; i < 5; i++) {
      const o = await makePendingOrder(W, 11000 + i);
      await makeSession(W, o.id, 11000 + i, { state: 'OBSERVED' });
    }
    await prisma.$executeRaw`UPDATE "PgPaymentAttempt" SET "updatedAt" = timezone('utc', now()) - interval '30 days'
      WHERE "restaurantId" = ${W.restaurantId} AND "state" = 'OBSERVED'`;
    const stuck = await unknownAttempt(12000);
    for (let tick = 0; tick < 3; tick++) await expireStaleAttempts({ limit: 5 });
    expect((await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: stuck } })).state).toBe('FAILED');
  });
});
