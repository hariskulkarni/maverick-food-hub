/**
 * Real-Postgres proof (Agent E): Flavrly PG manual refund lifecycle.
 * Row lock + pot checks, two-person rule, human bank reference, idempotency,
 * and the legacy super-admin entry point (refundOrder) routing youpi payments.
 * Only notification/realtime side effects of transitionOrder are mocked.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

vi.mock('@/server/realtime', () => ({ publish: vi.fn() }));
vi.mock('@/server/notifications', () => ({ notify: { sms: vi.fn(async () => undefined) } }));
vi.mock('@/server/push/milestones', () => ({ pushOrderMilestone: vi.fn(async () => undefined) }));
vi.mock('@/server/rider-push', () => ({ notifyRidersOfNewOrder: vi.fn(async () => undefined) }));
vi.mock('@/server/batch-dispatch', () => ({ maybeOfferAsBatch: vi.fn(async () => undefined) }));

import { prisma } from '@/server/db';
import {
  requestPgRefund,
  approvePgRefund,
  completePgRefund,
  failPgRefund,
  PgRefundError,
  type PgRefundKind,
} from '@/server/pg/refunds';
import { refundOrder, RefundError } from '@/server/refunds';

let restaurantId = '';
let branchId = '';
let customerId = '';
let accountId = '';
let requester = '';
let approver = '';
let seq = 0;

const ref = () => `E${Date.now().toString(36).toUpperCase()}${(seq++).toString().padStart(4, '0')}`;

/** What allocateBankCredit() leaves behind: Payment + attempt CAPTURED + bank credit allocations. */
async function paidAttempt(opts: { orderStatus?: string; allocations?: [string, number][] } = {}) {
  const n = seq++;
  const order = await prisma.order.create({
    data: {
      code: `E-${Date.now().toString(36)}-${n}`, branchId, customerId, subtotal: 300 as any, total: 300 as any,
      paymentMethod: 'PHONEPE', status: (opts.orderStatus ?? 'DELIVERED') as any,
    },
  });
  const payment = await prisma.payment.create({
    data: { orderId: order.id, method: 'PHONEPE', status: 'CAPTURED', amount: 300 as any, providerName: 'youpi', providerRef: `${order.id}-k` },
  });
  const attempt = await prisma.pgPaymentAttempt.create({
    data: {
      paymentId: payment.id, orderId: order.id, restaurantId, receivingAccountId: accountId,
      attemptKey: `${order.id}-k`, idempotencyKey: `${order.id}-k`, gatewayMerchantId: 'm-e',
      expectedAmountPaise: 30000, state: 'CAPTURED',
    },
  });
  for (const [kind, amountPaise] of opts.allocations ?? [['ORDER_PAYMENT', 30000]]) {
    const txn = await prisma.pgBankTransaction.create({
      data: {
        receivingAccountId: accountId, direction: 'CREDIT', amountPaise, bankReference: ref(), valueAt: new Date(),
        source: 'STATEMENT_IMPORT', sourceRowHash: ref(), status: 'ALLOCATED',
      },
    });
    await prisma.pgAllocation.create({
      data: { bankTransactionId: txn.id, attemptId: attempt.id, orderId: order.id, kind: kind as any, amountPaise },
    });
  }
  return { orderId: order.id, attemptId: attempt.id, paymentId: payment.id };
}

const req = (attemptId: string, amountPaise: number, kind: PgRefundKind = 'ORDER', extra: object = {}) =>
  requestPgRefund({ attemptId, amountPaise, kind, reason: 'customer complaint', actor: { id: requester }, ...extra });

beforeAll(async () => {
  const owner = await prisma.user.create({ data: { role: 'ADMIN', email: 'owner-e@test.invalid' } });
  requester = (await prisma.user.create({ data: { role: 'SUPER_ADMIN', email: 'req-e@test.invalid' } })).id;
  approver = (await prisma.user.create({ data: { role: 'SUPER_ADMIN', email: 'appr-e@test.invalid' } })).id;
  customerId = (await prisma.user.create({ data: { role: 'CUSTOMER', phone: '+910000000099' } })).id;
  restaurantId = (await prisma.restaurant.create({ data: { slug: 'e-rest', name: 'E Rest', ownerUserId: owner.id } })).id;
  branchId = (await prisma.branch.create({ data: { restaurantId, name: 'Main', slug: 'e-main', line1: 'x', city: 'y', postalCode: '560001' } })).id;
  accountId = (
    await prisma.pgReceivingAccount.create({
      data: {
        restaurantId, gatewayMerchantId: 'm-e', vpa: 'erest@upi', vpaNormalized: 'erest@upi',
        accountFingerprint: 'fp-e', legalEntityName: 'E Rest Pvt', status: 'VERIFIED',
      },
    })
  ).id;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('duplicate refund protection (row lock on the attempt)', () => {
  it('10 parallel full-amount requests -> exactly one succeeds', async () => {
    const { attemptId } = await paidAttempt();
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => req(attemptId, 30000)));
    const ok = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(9);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(PgRefundError);
      expect(r.reason.status).toBe(409);
    }
    expect(await prisma.pgRefundRecord.count({ where: { attemptId } })).toBe(1);
  });

  it('same idempotency key re-submitted (also concurrently) -> one refund, replays return it', async () => {
    const { attemptId } = await paidAttempt();
    const all = await Promise.all(Array.from({ length: 5 }, () => req(attemptId, 10000, 'ORDER', { idempotencyKey: 'k-1' })));
    expect(new Set(all.map((v) => v.refundId)).size).toBe(1);
    expect(all.filter((v) => !v.replay)).toHaveLength(1);
    expect(await prisma.pgRefundRecord.count({ where: { attemptId } })).toBe(1);
    await expect(req(attemptId, 20000, 'ORDER', { idempotencyKey: 'k-1' })).rejects.toMatchObject({ status: 409 });
  });

  it('ORDER_PAYMENT and OVERCOLLECTION are separate pots; no money -> nothing to refund', async () => {
    const { attemptId, orderId } = await paidAttempt({ allocations: [['ORDER_PAYMENT', 30000], ['OVERCOLLECTION', 30000]] });
    await req(attemptId, 30000, 'ORDER');
    await req(attemptId, 30000, 'OVERCOLLECTION');
    await expect(req(attemptId, 1, 'OVERCOLLECTION')).rejects.toMatchObject({ status: 409 });
    await expect(req(attemptId, 1, 'ORDER')).rejects.toMatchObject({ status: 409 });
    await expect(req(attemptId, 100, 'LATE_PAYMENT')).rejects.toMatchObject({ status: 409 });
    // by orderId: resolves the attempt holding the pot
    await expect(requestPgRefund({ orderId, amountPaise: 1, kind: 'LATE_PAYMENT', reason: 'x', actor: { id: requester } })).rejects.toThrow(
      /nothing to refund/,
    );
  });

  it('a gateway-observed but not bank-allocated attempt cannot be refunded', async () => {
    const { attemptId } = await paidAttempt({ allocations: [] });
    await expect(req(attemptId, 100)).rejects.toThrow(/nothing to refund/);
  });

  it('a FAILED refund frees its amount again', async () => {
    const { attemptId } = await paidAttempt();
    const a = await req(attemptId, 30000);
    await failPgRefund({ refundId: a.refundId, reason: 'customer VPA closed', actor: { id: approver } });
    const ex = await prisma.pgReconException.findUniqueOrThrow({ where: { dedupeKey: `REFUND_FAILED:${a.refundId}` } });
    expect(ex).toMatchObject({ kind: 'REFUND_FAILED', status: 'OPEN', amountPaise: 30000, attemptId });
    // fail is idempotent
    expect((await failPgRefund({ refundId: a.refundId, reason: 'again', actor: { id: approver } })).replay).toBe(true);
    const b = await req(attemptId, 30000);
    expect(b.status).toBe('PENDING');
  });
});

describe('manual bank refund lifecycle', () => {
  it('full ORDER refund: two people, human bank reference, Payment/attempt/order REFUNDED', async () => {
    const { attemptId, orderId, paymentId } = await paidAttempt();
    const r = await req(attemptId, 30000);
    expect(r).toMatchObject({ status: 'PENDING', approved: false, method: 'MANUAL_BANK', bankReference: null });
    const row = await prisma.refund.findUniqueOrThrow({ where: { id: r.refundId } });
    expect(row).toMatchObject({ status: 'PENDING', destination: 'ORIGINAL_PAYMENT', providerRef: null, createdById: requester });
    expect(String(row.amount)).toBe('300');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('REFUND_PENDING');

    const evidence = { note: 'Bank portal screenshot filed in ticket T-1' };
    await expect(completePgRefund({ refundId: r.refundId, bankReference: 'UTR1234567', evidence, actor: { id: approver } })).rejects.toThrow(
      /approval/,
    );
    await expect(approvePgRefund({ refundId: r.refundId, actor: { id: requester } })).rejects.toMatchObject({ status: 403 });
    expect((await approvePgRefund({ refundId: r.refundId, actor: { id: approver } })).approved).toBe(true);
    expect((await approvePgRefund({ refundId: r.refundId, actor: { id: approver } })).replay).toBe(true);

    for (const bad of [undefined, '', '   ', '12345', 'UTR-123456', 'A'.repeat(36)]) {
      await expect(completePgRefund({ refundId: r.refundId, bankReference: bad, evidence, actor: { id: approver } })).rejects.toThrow(
        /bank refund reference/,
      );
    }
    await expect(completePgRefund({ refundId: r.refundId, bankReference: 'UTR1234567', evidence: { note: ' ' }, actor: { id: approver } })).rejects.toThrow(
      /evidence/,
    );
    // nothing was completed by the failed attempts
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: r.refundId } })).status).toBe('PENDING');

    const done = await completePgRefund({ refundId: r.refundId, bankReference: ' utr1234567 ', evidence, actor: { id: approver } });
    expect(done).toMatchObject({ status: 'COMPLETED', bankReference: 'UTR1234567', replay: false });
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: r.refundId } })).providerRef).toBe('UTR1234567');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('REFUNDED');
    expect((await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: attemptId } })).state).toBe('REFUNDED');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('REFUNDED');
    const rec = await prisma.pgRefundRecord.findUniqueOrThrow({ where: { refundId: r.refundId } });
    expect(rec).toMatchObject({ requestedById: requester, approvedById: approver, completedById: approver });
    const events = await prisma.pgFinancialEvent.findMany({ where: { refundId: r.refundId }, orderBy: { createdAt: 'asc' } });
    expect(events.map((e) => e.kind)).toEqual(['REFUND_REQUESTED', 'REFUND_APPROVED', 'REFUND_COMPLETED']);

    // idempotent replay with the same reference, refusal with another
    expect((await completePgRefund({ refundId: r.refundId, bankReference: 'UTR1234567', evidence, actor: { id: approver } })).replay).toBe(true);
    await expect(completePgRefund({ refundId: r.refundId, bankReference: 'OTHER12345', evidence, actor: { id: approver } })).rejects.toMatchObject({
      status: 409,
    });
    await expect(failPgRefund({ refundId: r.refundId, reason: 'x', actor: { id: approver } })).rejects.toMatchObject({ status: 409 });
  });

  it('partial ORDER refund keeps Payment CAPTURED; attempt REFUND_PENDING; order REFUND_INITIATED', async () => {
    const { attemptId, orderId, paymentId } = await paidAttempt();
    const r = await req(attemptId, 10000);
    await approvePgRefund({ refundId: r.refundId, actor: { id: approver } });
    await completePgRefund({ refundId: r.refundId, bankReference: ref(), evidence: { note: 'stmt' }, actor: { id: approver } });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('CAPTURED');
    expect((await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: attemptId } })).state).toBe('REFUND_PENDING');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('REFUND_INITIATED');
  });

  it('a bank reference cannot be reused on a second refund', async () => {
    const { attemptId } = await paidAttempt();
    const a = await req(attemptId, 10000);
    const b = await req(attemptId, 10000);
    await approvePgRefund({ refundId: a.refundId, actor: { id: approver } });
    await approvePgRefund({ refundId: b.refundId, actor: { id: approver } });
    const shared = ref();
    await completePgRefund({ refundId: a.refundId, bankReference: shared, evidence: { note: 'n' }, actor: { id: approver } });
    await expect(completePgRefund({ refundId: b.refundId, bankReference: shared, evidence: { note: 'n' }, actor: { id: approver } })).rejects.toThrow(
      /already recorded/,
    );
  });

  it('OVERCOLLECTION refund leaves the order and its Payment untouched', async () => {
    const { attemptId, orderId, paymentId } = await paidAttempt({ allocations: [['ORDER_PAYMENT', 30000], ['OVERCOLLECTION', 30000]] });
    const r = await req(attemptId, 30000, 'OVERCOLLECTION');
    await approvePgRefund({ refundId: r.refundId, actor: { id: approver } });
    await completePgRefund({ refundId: r.refundId, bankReference: ref(), evidence: { note: 'n' }, actor: { id: approver } });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('DELIVERED');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('CAPTURED');
    expect((await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: attemptId } })).state).toBe('CAPTURED');
  });

  it('LATE_PAYMENT refund works on a cancelled order', async () => {
    const { attemptId } = await paidAttempt({ orderStatus: 'CANCELLED_BY_CUSTOMER', allocations: [['LATE_PAYMENT', 30000]] });
    const r = await req(attemptId, 30000, 'LATE_PAYMENT');
    expect(r.status).toBe('PENDING');
    await expect(req(attemptId, 100, 'ORDER')).rejects.toMatchObject({ status: 409 });
  });

  it('tenant scope: another restaurant cannot see or act on the refund', async () => {
    const { attemptId } = await paidAttempt();
    await expect(req(attemptId, 100, 'ORDER', { scopeRestaurantId: 'other-restaurant' })).rejects.toMatchObject({ status: 404 });
    const r = await req(attemptId, 100, 'ORDER', { scopeRestaurantId: restaurantId });
    await expect(approvePgRefund({ refundId: r.refundId, actor: { id: approver }, scopeRestaurantId: 'other-restaurant' })).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('wallet credit (policy flag, default off)', () => {
  it('refused by default', async () => {
    const { attemptId } = await paidAttempt();
    await expect(req(attemptId, 30000, 'ORDER', { method: 'WALLET' })).rejects.toMatchObject({ status: 403 });
    expect(await prisma.pgRefundRecord.count({ where: { attemptId } })).toBe(0);
  });

  it('with FLAVRLY_PG_ALLOW_WALLET_REFUND=true: still approved by a second person, then credits the wallet', async () => {
    vi.stubEnv('FLAVRLY_PG_ALLOW_WALLET_REFUND', 'true');
    const { attemptId } = await paidAttempt();
    const before = await prisma.wallet.findUnique({ where: { userId: customerId } });
    const r = await req(attemptId, 30000, 'ORDER', { method: 'WALLET' });
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: r.refundId } })).destination).toBe('WALLET');
    expect(await prisma.wallet.findUnique({ where: { userId: customerId } })).toEqual(before);
    await approvePgRefund({ refundId: r.refundId, actor: { id: approver } });
    const done = await completePgRefund({ refundId: r.refundId, evidence: { note: 'customer consented in ticket T-9' }, actor: { id: approver } });
    expect(done).toMatchObject({ status: 'COMPLETED', bankReference: null, method: 'WALLET' });
    const w = await prisma.wallet.findUniqueOrThrow({ where: { userId: customerId } });
    expect(Number(w.balance) - Number(before?.balance ?? 0)).toBe(300);
  });
});

describe('legacy super-admin entry point refundOrder() with a youpi payment', () => {
  it('WALLET (the route default) is refused with a clear message and writes nothing', async () => {
    const { orderId } = await paidAttempt();
    const err = await refundOrder({ orderId, amount: 300, destination: 'WALLET', actorId: requester }).catch((e) => e);
    expect(err).toBeInstanceOf(RefundError);
    expect(err.message).toMatch(/direct UPI/);
    expect(await prisma.refund.count({ where: { orderId } })).toBe(0);
  });

  it('ORIGINAL_PAYMENT becomes a PENDING manual bank refund, never COMPLETED', async () => {
    vi.stubEnv('NODE_ENV', 'development'); // legacy path would "settle immediately" for unknown providers in dev
    const { orderId, paymentId } = await paidAttempt();
    const res = await refundOrder({ orderId, amount: 300, destination: 'ORIGINAL_PAYMENT', actorId: requester, reason: 'cold food' });
    expect(res).toMatchObject({ status: 'PENDING', walletCredited: 0, destination: 'ORIGINAL_PAYMENT' });
    expect(res.note).toMatch(/Nothing has been sent/);
    const rows = await prisma.refund.findMany({ where: { orderId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'PENDING', providerRef: null });
    expect(await prisma.pgRefundRecord.count({ where: { refundId: rows[0].id, method: 'MANUAL_BANK' } })).toBe(1);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('CAPTURED');
    // over-refund through the legacy entry point is refused by the pot check
    await expect(refundOrder({ orderId, amount: 0.01, destination: 'ORIGINAL_PAYMENT', actorId: requester })).rejects.toBeInstanceOf(RefundError);
  });
});
