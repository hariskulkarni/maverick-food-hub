/**
 * Round-2 audit P1/P2 ops actions against real Postgres, through the real routes where ops act.
 * Mocked: auth session, cookies, gateway HTTP (h-support fetch stub), notifications.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64'); // fake test key
  delete process.env.REDIS_URL;
});
const h = vi.hoisted(() => ({ session: null as null | { user: { id: string; role: string } } }));
vi.mock('@/server/auth', () => ({ auth: vi.fn(async () => h.session), requireRole: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn(), sendOtp: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined }), headers: async () => new Headers() }));
vi.mock('@/server/realtime', () => ({ publish: vi.fn() }));
vi.mock('@/server/notifications', () => ({ notify: { sms: vi.fn(async () => undefined) } }));
vi.mock('@/server/push/milestones', () => ({ pushOrderMilestone: vi.fn(async () => undefined) }));
vi.mock('@/server/rider-push', () => ({ notifyRidersOfNewOrder: vi.fn(async () => undefined) }));
vi.mock('@/server/batch-dispatch', () => ({ maybeOfferAsBatch: vi.fn(async () => undefined) }));

import { prisma } from '@/server/db';
import { createPgAttempt } from '@/server/pg/attempts';
import { approveManualAllocation, proposeManualAllocation, recordObservation, rejectManualAllocation, tryAllocateBankTxn } from '@/server/pg/reconcile-engine';
import { runOutbox } from '@/server/pg/outbox';
import { approvePgRefund, completePgRefund, requestPgRefund } from '@/server/pg/refunds';
import { retryUnmatchedCredits } from '@/server/pg/reconcile-engine';
import { ingestBankTransactions } from '@/server/pg/bank-ingest';
import { ordersCsvStream } from '@/server/exports';
import { transitionOrder } from '@/server/orders';
import { runEscalationScan } from '@/server/escalations';
import { POST as refundsPOST } from '@/app/api/platform/youpi/refunds/route';
import { POST as proposePOST } from '@/app/api/platform/youpi/ops-actions/route';
import { POST as decidePOST } from '@/app/api/platform/youpi/ops-actions/[proposalId]/route';
import { POST as deadPOST } from '@/app/api/platform/youpi/dead-letters/route';
import { POST as heldPOST } from '@/app/api/admin/pg/held-orders/[exceptionId]/route';
import { gatewayFetch, makePendingOrder, makeSession, makeTenant, uid, type GatewayStatus, type Tenant } from './h-support';

const gw = new Map<string, GatewayStatus>();
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(gatewayFetch(gw, [])));
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma.$disconnect();
});

const req = (body: unknown) => new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) });
const ctx = <K extends string>(k: K, v: string) => ({ params: Promise.resolve({ [k]: v } as Record<K, string>) });
const as = (u: { id: string; role: string } | null) => {
  h.session = u ? { user: u } : null;
};
const utr = () => `U${uid().toUpperCase()}`;
const orderStatus = async (id: string) => (await prisma.order.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

async function credit(t: Tenant, amountPaise: number, reference: string) {
  return prisma.pgBankTransaction.create({
    data: { receivingAccountId: t.account.id, direction: 'CREDIT', amountPaise, bankReference: reference, valueAt: new Date(), source: 'STATEMENT_IMPORT', sourceRowHash: uid(), status: 'UNMATCHED' },
  });
}
async function observe(attemptId: string, reference: string, amountPaise: number) {
  return recordObservation({ attemptId, source: 'GATEWAY_WEBHOOK', utr: reference, amountPaise, authenticated: true, dedupeKey: `webhook:${uid()}` });
}

let sa1: { id: string; role: string };
let sa2: { id: string; role: string };
beforeAll(async () => {
  sa1 = { id: (await prisma.user.create({ data: { email: `sa1-${uid()}@example.test`, role: 'SUPER_ADMIN' } })).id, role: 'SUPER_ADMIN' };
  sa2 = { id: (await prisma.user.create({ data: { email: `sa2-${uid()}@example.test`, role: 'SUPER_ADMIN' } })).id, role: 'SUPER_ADMIN' };
});

/** Expired attempt whose credit arrives late -> LATE_PAYMENT allocation. */
async function latePayment(t: Tenant, amountPaise: number, orderStatusAfter: 'PAYMENT_FAILED' | 'PAYMENT_PENDING' = 'PAYMENT_FAILED') {
  const order = await makePendingOrder(t, amountPaise);
  const s = await makeSession(t, order.id, amountPaise, { state: 'EXPIRED' });
  await prisma.payment.update({ where: { id: s.payment.id }, data: { status: 'FAILED' } });
  if (orderStatusAfter === 'PAYMENT_FAILED') await transitionOrder(order.id, 'PAYMENT_FAILED', { note: 'expired' });
  const ref = utr();
  await observe(s.attempt.id, ref, amountPaise);
  const c = await credit(t, amountPaise, ref);
  const r = await tryAllocateBankTxn(c.id);
  expect(r.outcome).toBe('LATE_PAYMENT');
  return { order, attempt: s.attempt, payment: s.payment, credit: c };
}

describe('P1-1 refund of LATE_PAYMENT / OVERCOLLECTION from the platform ops route', () => {
  let T: Tenant;
  beforeAll(async () => {
    T = await makeTenant();
  });

  it('SUPER_ADMIN requests a LATE_PAYMENT refund (capped at the allocation); approval needs a different person', async () => {
    const lp = await latePayment(T, 18000);
    as({ id: T.ownerId, role: 'ADMIN' });
    expect((await refundsPOST(req({ attemptId: lp.attempt.id, kind: 'LATE_PAYMENT', amountPaise: 18000, reason: 'late' }))).status).toBe(403);
    as(sa1);
    const over = await refundsPOST(req({ attemptId: lp.attempt.id, kind: 'LATE_PAYMENT', amountPaise: 18001, reason: 'late' }));
    expect(over.status).toBe(409);
    const res = await refundsPOST(req({ attemptId: lp.attempt.id, kind: 'LATE_PAYMENT', amountPaise: 18000, reason: 'customer paid after expiry' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ kind: 'LATE_PAYMENT', status: 'PENDING', approved: false });
    await expect(approvePgRefund({ refundId: body.refundId, actor: { id: sa1.id } })).rejects.toMatchObject({ status: 403 });
    await expect(approvePgRefund({ refundId: body.refundId, actor: { id: T.ownerId } })).resolves.toMatchObject({ approved: true });
    expect(await prisma.auditLog.count({ where: { action: 'pg.refund.request', entityId: body.refundId } })).toBe(1);
  });
});

describe('P1-2 accept a late payment (dual control + restaurant confirmation)', () => {
  let T: Tenant;
  beforeAll(async () => {
    T = await makeTenant();
    await prisma.restaurant.update({ where: { id: T.restaurantId }, data: { autoAcceptOrders: true } });
  });

  it('propose (A) -> self-approve refused -> approve (B) -> restaurant confirms -> captured once, released, never auto-accepted', async () => {
    const lp = await latePayment(T, 26000);
    as(sa1);
    const p = await proposePOST(req({ action: 'LATE_ACCEPT', bankTransactionId: lp.credit.id, reason: 'customer still wants the food' }));
    expect(p.status).toBe(201);
    const { proposalId } = await p.json();
    expect((await decidePOST(req({ decision: 'APPROVE' }), ctx('proposalId', proposalId))).status).toBe(403);
    // Nothing captured yet.
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: lp.payment.id } })).status).toBe('FAILED');
    as(sa2);
    const d = await decidePOST(req({ decision: 'APPROVE' }), ctx('proposalId', proposalId));
    expect(d.status).toBe(200);
    const held = await prisma.pgReconException.findFirstOrThrow({ where: { orderId: lp.order.id, kind: 'RELEASE_HELD', status: 'OPEN' } });
    // Approval alone moves no money.
    expect((await prisma.pgAllocation.findUniqueOrThrow({ where: { bankTransactionId: lp.credit.id } })).kind).toBe('LATE_PAYMENT');
    expect((await decidePOST(req({ decision: 'REJECT' }), ctx('proposalId', proposalId))).status).toBe(409); // decided once

    as({ id: T.ownerId, role: 'ADMIN' });
    const c = await heldPOST(req({ decision: 'CONFIRM' }), ctx('exceptionId', held.id));
    expect(c.status).toBe(200);
    expect((await heldPOST(req({ decision: 'CONFIRM' }), ctx('exceptionId', held.id))).status).toBe(409);

    const alloc = await prisma.pgAllocation.findMany({ where: { bankTransactionId: lp.credit.id } });
    expect(alloc).toHaveLength(1);
    expect(alloc[0].kind).toBe('ORDER_PAYMENT');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: lp.payment.id } })).status).toBe('CAPTURED');
    expect((await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: lp.attempt.id } })).state).toBe('CAPTURED');
    await runOutbox();
    expect(await orderStatus(lp.order.id)).toBe('RECEIVED'); // autoAcceptOrders=true but NOT accepted
    const kinds = (await prisma.pgFinancialEvent.findMany({ where: { orderId: lp.order.id }, select: { kind: true } })).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['LATE_ACCEPT_PROPOSED', 'LATE_ACCEPT_APPROVED', 'ALLOCATION_RECLASSIFIED', 'PAYMENT_CAPTURED', 'RELEASE_HELD_CONFIRMED']));
    expect(kinds.filter((k) => k === 'PAYMENT_CAPTURED')).toHaveLength(1);
    expect(await prisma.pgReconException.count({ where: { orderId: lp.order.id, kind: 'LATE_PAYMENT', status: { not: 'RESOLVED' } } })).toBe(0);
  });

  it('a cancelled order cannot take a late payment (refund path); restaurant decline cancels and keeps the refund open', async () => {
    const cancelled = await latePayment(T, 26100, 'PAYMENT_PENDING');
    await transitionOrder(cancelled.order.id, 'CANCELLED_BY_CUSTOMER');
    as(sa1);
    const r = await proposePOST(req({ action: 'LATE_ACCEPT', bankTransactionId: cancelled.credit.id, reason: 'x' }));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/Refund/);

    const lp = await latePayment(T, 26200);
    const { proposalId } = await (await proposePOST(req({ action: 'LATE_ACCEPT', bankTransactionId: lp.credit.id, reason: 'x' }))).json();
    as(sa2);
    await decidePOST(req({ decision: 'APPROVE' }), ctx('proposalId', proposalId));
    const held = await prisma.pgReconException.findFirstOrThrow({ where: { orderId: lp.order.id, kind: 'RELEASE_HELD' } });
    as({ id: T.ownerId, role: 'ADMIN' });
    expect((await heldPOST(req({ decision: 'DECLINE', note: 'closed for the day' }), ctx('exceptionId', held.id))).status).toBe(200);
    expect(await orderStatus(lp.order.id)).toBe('CANCELLED_BY_ADMIN');
    expect((await prisma.pgReconException.findUniqueOrThrow({ where: { id: held.id } })).status).toBe('ACKNOWLEDGED');
    expect((await prisma.pgAllocation.findUniqueOrThrow({ where: { bankTransactionId: lp.credit.id } })).kind).toBe('LATE_PAYMENT');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: lp.payment.id } })).status).toBe('FAILED');
  });

  it('another restaurant cannot decide the held order (404)', async () => {
    const O = await makeTenant();
    const lp = await latePayment(T, 26300);
    as(sa1);
    const { proposalId } = await (await proposePOST(req({ action: 'LATE_ACCEPT', bankTransactionId: lp.credit.id, reason: 'x' }))).json();
    as(sa2);
    await decidePOST(req({ decision: 'APPROVE' }), ctx('proposalId', proposalId));
    const held = await prisma.pgReconException.findFirstOrThrow({ where: { orderId: lp.order.id, kind: 'RELEASE_HELD' } });
    as({ id: O.ownerId, role: 'ADMIN' });
    expect((await heldPOST(req({ decision: 'CONFIRM' }), ctx('exceptionId', held.id))).status).toBe(404);
  });
});

describe('P1-3 void a stuck attempt (dual control, refused with any payment evidence)', () => {
  let T: Tenant;
  beforeAll(async () => {
    T = await makeTenant();
  });

  it('REVIEW_REQUIRED without evidence: void -> attempt CANCELLED, exceptions closed, order PAYMENT_FAILED, retry possible', async () => {
    const order = await makePendingOrder(T, 15500);
    const s = await makeSession(T, order.id, 15500, { state: 'REVIEW_REQUIRED' });
    await prisma.pgReconException.create({ data: { kind: 'RECEIVER_MISMATCH', dedupeKey: `RECEIVER_MISMATCH:${s.attempt.id}`, attemptId: s.attempt.id, orderId: order.id, restaurantId: T.restaurantId } });
    await expect(createPgAttempt({ id: order.id, restaurantId: T.restaurantId, customerId: T.customerId }, { amountPaise: 15500, method: 'RAZORPAY' })).rejects.toMatchObject({ code: 'ATTEMPT_UNRESOLVED' });
    as(sa1);
    const { proposalId } = await (await proposePOST(req({ action: 'ATTEMPT_VOID', attemptId: s.attempt.id, reason: 'gateway session misconfigured' }))).json();
    as(sa2);
    expect((await decidePOST(req({ decision: 'APPROVE' }), ctx('proposalId', proposalId))).status).toBe(200);
    expect((await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: s.attempt.id } })).state).toBe('CANCELLED');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: s.payment.id } })).status).toBe('FAILED');
    expect(await prisma.pgReconException.count({ where: { attemptId: s.attempt.id, status: { not: 'RESOLVED' } } })).toBe(0);
    expect(await orderStatus(order.id)).toBe('PAYMENT_FAILED');
    const retry = await createPgAttempt({ id: order.id, restaurantId: T.restaurantId, customerId: T.customerId }, { amountPaise: 15500, method: 'RAZORPAY' });
    expect(retry.reused).toBe(false);
    expect(await orderStatus(order.id)).toBe('PAYMENT_PENDING');
  });

  it.each([
    ['an observation', async (id: string) => observe(id, utr(), 15600)],
    ['a gateway SUCCESS status', async (id: string) => prisma.pgPaymentAttempt.update({ where: { id }, data: { lastGatewayStatus: 'SUCCESS' } })],
  ])('refused when the attempt has %s', async (_n, add) => {
    const order = await makePendingOrder(T, 15600);
    const s = await makeSession(T, order.id, 15600, { state: 'CREATE_UNKNOWN' });
    await add(s.attempt.id);
    as(sa1);
    const r = await proposePOST(req({ action: 'ATTEMPT_VOID', attemptId: s.attempt.id, reason: 'x' }));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/payment evidence|Only CREATED/);
  });

  it('evidence that appears after the proposal makes the approval fail too', async () => {
    const order = await makePendingOrder(T, 15700);
    const s = await makeSession(T, order.id, 15700, { state: 'CREATE_UNKNOWN' });
    as(sa1);
    const { proposalId } = await (await proposePOST(req({ action: 'ATTEMPT_VOID', attemptId: s.attempt.id, reason: 'x' }))).json();
    await prisma.pgPaymentAttempt.update({ where: { id: s.attempt.id }, data: { observedUtr: utr() } });
    as(sa2);
    expect((await decidePOST(req({ decision: 'APPROVE' }), ctx('proposalId', proposalId))).status).toBe(409);
    expect((await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: s.attempt.id } })).state).toBe('CREATE_UNKNOWN');
  });
});

describe('P1-4 bank reversal (dual control)', () => {
  it('propose -> self-approve refused -> approve books REVERSED + exception; order untouched', async () => {
    const T = await makeTenant();
    const order = await makePendingOrder(T, 17000);
    const s = await makeSession(T, order.id, 17000, { state: 'OBSERVED' });
    const ref = utr();
    await prisma.pgPaymentAttempt.update({ where: { id: s.attempt.id }, data: { observedUtr: ref } });
    const c = await credit(T, 17000, ref);
    expect((await tryAllocateBankTxn(c.id)).outcome).toBe('CAPTURED');
    as(sa1);
    const { proposalId } = await (await proposePOST(req({ action: 'REVERSAL', bankTransactionId: c.id, reason: 'bank chargeback' }))).json();
    expect((await decidePOST(req({ decision: 'APPROVE' }), ctx('proposalId', proposalId))).status).toBe(403);
    as(sa2);
    expect((await decidePOST(req({ decision: 'APPROVE' }), ctx('proposalId', proposalId))).status).toBe(200);
    expect((await prisma.pgBankTransaction.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('REVERSED');
    expect((await prisma.pgAllocation.findUniqueOrThrow({ where: { bankTransactionId: c.id } })).reversedAt).not.toBeNull();
    expect(await prisma.pgReconException.count({ where: { dedupeKey: `REVERSAL:${c.id}` } })).toBe(1);
    const ev = await prisma.pgFinancialEvent.findUniqueOrThrow({ where: { dedupeKey: `BANK_TXN_REVERSED:${c.id}` } });
    expect(ev.actorId).toBe(sa2.id);
    expect((ev.data as { requestedById: string }).requestedById).toBe(sa1.id);
    as(sa1);
    expect((await proposePOST(req({ action: 'REVERSAL', bankTransactionId: c.id, reason: 'again' }))).status).toBe(409);
  });

  it('a rejected reversal proposal changes nothing', async () => {
    const T = await makeTenant();
    const c = await credit(T, 9900, utr());
    as(sa1);
    const { proposalId } = await (await proposePOST(req({ action: 'REVERSAL', bankTransactionId: c.id, reason: 'typo' }))).json();
    expect((await decidePOST(req({ decision: 'REJECT', note: 'wrong row' }), ctx('proposalId', proposalId))).status).toBe(200);
    expect((await prisma.pgBankTransaction.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('UNMATCHED');
  });
});

describe('P1-5 requeue dead letters', () => {
  it('a DEAD outbox row goes back to PENDING (attempts 0) and its exception is resolved; non-dead refused', async () => {
    const row = await prisma.pgOutbox.create({ data: { topic: 'NOOP_TEST', aggregateId: uid(), dedupeKey: `NOOP:${uid()}`, payload: {}, status: 'DEAD', attempts: 10, lastError: 'boom' } });
    await prisma.pgReconException.create({ data: { kind: 'OUTBOX_DEAD_LETTER', dedupeKey: `OUTBOX_DEAD_LETTER:${row.id}` } });
    as({ id: uid(), role: 'ADMIN' });
    expect((await deadPOST(req({ type: 'outbox', id: row.id }))).status).toBe(403);
    as(sa1);
    expect((await deadPOST(req({ type: 'outbox', id: row.id }))).status).toBe(200);
    expect(await prisma.pgOutbox.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'PENDING', attempts: 0 });
    expect((await prisma.pgReconException.findUniqueOrThrow({ where: { dedupeKey: `OUTBOX_DEAD_LETTER:${row.id}` } })).status).toBe('RESOLVED');
    expect((await deadPOST(req({ type: 'outbox', id: row.id }))).status).toBe(409);
    await prisma.pgOutbox.update({ where: { id: row.id }, data: { status: 'DONE' } }); // keep the shared worker queue clean
  });

  it('a dead-lettered webhook is requeued; a redacted one is refused', async () => {
    const mk = (rawPayload: object) =>
      prisma.paymentWebhookEvent.create({
        data: { provider: 'youpi', eventType: 'SUCCESS', providerEventId: `dlv_${uid()}`, rawPayload, processed: false, deadLetteredAt: new Date(), attempts: 8, error: 'x' },
      });
    const ev = await mk({ paymentId: 'gp_x' });
    const red = await mk({ redacted: true });
    as(sa1);
    expect((await deadPOST(req({ type: 'webhook', id: ev.id }))).status).toBe(200);
    expect(await prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { id: ev.id } })).toMatchObject({ deadLetteredAt: null, attempts: 0 });
    expect((await deadPOST(req({ type: 'webhook', id: red.id }))).status).toBe(409);
    await prisma.paymentWebhookEvent.update({ where: { id: ev.id }, data: { processed: true } });
  });
});

describe('P1-6 stale release needs restaurant confirmation; escalation uses the release time', () => {
  let T: Tenant;
  beforeAll(async () => {
    T = await makeTenant();
    await prisma.restaurant.update({ where: { id: T.restaurantId }, data: { autoAcceptOrders: true } });
  });

  async function capturedOld(amountPaise: number) {
    const order = await makePendingOrder(T, amountPaise, new Date(Date.now() - 2 * 3_600_000));
    const s = await makeSession(T, order.id, amountPaise, { state: 'OBSERVED' });
    const ref = utr();
    await prisma.pgPaymentAttempt.update({ where: { id: s.attempt.id }, data: { observedUtr: ref } });
    expect((await tryAllocateBankTxn((await credit(T, amountPaise, ref)).id)).outcome).toBe('CAPTURED');
    await runOutbox();
    return order;
  }

  it('captured 2 h after placement -> held (PAYMENT_PENDING + RELEASE_HELD); restaurant confirm releases without auto-accept', async () => {
    const order = await capturedOld(19000);
    expect(await orderStatus(order.id)).toBe('PAYMENT_PENDING');
    const held = await prisma.pgReconException.findFirstOrThrow({ where: { orderId: order.id, kind: 'RELEASE_HELD', status: 'OPEN' } });
    as({ id: T.ownerId, role: 'ADMIN' });
    expect((await heldPOST(req({ decision: 'CONFIRM' }), ctx('exceptionId', held.id))).status).toBe(200);
    expect(await orderStatus(order.id)).toBe('RECEIVED');
    await runOutbox(); // a redelivery must not auto-accept a held order
    expect(await orderStatus(order.id)).toBe('RECEIVED');
    expect((await prisma.pgReconException.findUniqueOrThrow({ where: { id: held.id } })).status).toBe('RESOLVED');

    // Released now: not escalated as "not accepted for 2 h".
    await runEscalationScan();
    expect(await prisma.orderEscalation.count({ where: { orderId: order.id, type: 'ORDER_NOT_ACCEPTED' } })).toBe(0);
  });

  it('restaurant decline -> cancelled; the captured ORDER money is refundable', async () => {
    const order = await capturedOld(19100);
    const held = await prisma.pgReconException.findFirstOrThrow({ where: { orderId: order.id, kind: 'RELEASE_HELD' } });
    as({ id: T.ownerId, role: 'ADMIN' });
    expect((await heldPOST(req({ decision: 'DECLINE' }), ctx('exceptionId', held.id))).status).toBe(200);
    expect(await orderStatus(order.id)).toBe('CANCELLED_BY_ADMIN');
    const attempt = await prisma.pgPaymentAttempt.findFirstOrThrow({ where: { orderId: order.id } });
    as(sa1);
    const r = await refundsPOST(req({ attemptId: attempt.id, kind: 'ORDER', amountPaise: 19100, reason: 'restaurant declined' }));
    expect(r.status).toBe(201);
  });
});

describe('P1-7 / P1-10 cancelling an unpaid PG order', () => {
  let T: Tenant;
  beforeAll(async () => {
    T = await makeTenant();
  });

  it('open attempts become CANCELLED; a later credit is LATE_PAYMENT (never a release)', async () => {
    const order = await makePendingOrder(T, 16000);
    const s = await makeSession(T, order.id, 16000);
    await transitionOrder(order.id, 'CANCELLED_BY_CUSTOMER');
    expect((await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: s.attempt.id } })).state).toBe('CANCELLED');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: s.payment.id } })).status).toBe('FAILED');
    const ref = utr();
    await observe(s.attempt.id, ref, 16000);
    expect((await tryAllocateBankTxn((await credit(T, 16000, ref)).id)).outcome).toBe('LATE_PAYMENT');
  });

  it('wallet and points come back exactly once on cancel; not on PAYMENT_FAILED; never when money was captured', async () => {
    const wallet = await prisma.wallet.upsert({ where: { userId: T.customerId }, update: { balance: '0' }, create: { userId: T.customerId, balance: '0' } });
    const acc = await prisma.loyaltyAccount.upsert({ where: { userId: T.customerId }, update: { pointsBalance: 0 }, create: { userId: T.customerId } });
    const order = await makePendingOrder(T, 10000);
    await prisma.order.update({ where: { id: order.id }, data: { walletApplied: '50', loyaltyApplied: '20' } });
    await prisma.walletTransaction.create({ data: { walletId: wallet.id, orderId: order.id, type: 'ORDER_DEBIT', amount: '50' } });
    await prisma.loyaltyTransaction.create({ data: { accountId: acc.id, orderId: order.id, type: 'REDEEM', points: -20 } });

    await transitionOrder(order.id, 'PAYMENT_FAILED', { note: 'expired' });
    expect(Number((await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } })).balance)).toBe(0);
    await transitionOrder(order.id, 'CANCELLED_BY_CUSTOMER');
    expect(Number((await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } })).balance)).toBe(50);
    expect((await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: acc.id } })).pointsBalance).toBe(20);

    // Captured money: refund flow owns it, no automatic restore.
    const paid = await makePendingOrder(T, 10100);
    await prisma.order.update({ where: { id: paid.id }, data: { walletApplied: '30' } });
    await prisma.payment.create({ data: { orderId: paid.id, method: 'RAZORPAY', amount: '101', providerName: 'youpi', status: 'CAPTURED' } });
    await transitionOrder(paid.id, 'CANCELLED_BY_ADMIN');
    expect(Number((await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } })).balance)).toBe(50);
    expect(await prisma.walletTransaction.count({ where: { orderId: order.id, type: 'REFUND' } })).toBe(1);
  });
});

describe('P2 manual allocation proposals can be rejected', () => {
  it('a rejected proposal cannot be approved afterwards', async () => {
    const T = await makeTenant();
    const order = await makePendingOrder(T, 13000);
    const s = await makeSession(T, order.id, 13000, { state: 'OBSERVED' });
    const c = await credit(T, 13000, utr());
    const { proposalId } = await proposeManualAllocation({ attemptId: s.attempt.id, bankTransactionId: c.id, operatorId: 'ops-a', reason: 'x' });
    await rejectManualAllocation({ proposalId, actorId: 'ops-c', reason: 'wrong credit' });
    await expect(approveManualAllocation({ proposalId, approverId: 'ops-b' })).rejects.toThrow(/rejected/);
    await expect(rejectManualAllocation({ proposalId, actorId: 'ops-c', reason: 'again' })).rejects.toThrow(/already decided/);
    expect((await prisma.pgBankTransaction.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('UNMATCHED');
  });
});

describe('P2 reconciliation hygiene', () => {
  it('a UTR printed with leading zeros on the statement still matches the observed UTR', async () => {
    const T = await makeTenant();
    const order = await makePendingOrder(T, 11000);
    const s = await makeSession(T, order.id, 11000);
    const digits = `${Date.now()}`.slice(-10);
    await observe(s.attempt.id, `00${digits}`, 11000); // gateway prints the UTR zero-padded
    const r = await ingestBankTransactions(T.account.id, 'STATEMENT_IMPORT', [
      { direction: 'CREDIT', amountPaise: 11000, currency: 'INR', bankReference: digits, valueAt: new Date(), narrationRedacted: null, counterpartyMasked: null, sourceRowHash: uid() },
    ], 'fin-1');
    expect(r.insertedIds).toHaveLength(1);
    expect((await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: s.attempt.id } })).state).toBe('CAPTURED');
    // The parser strips zeros, so "00" + digits normalizes to the same reference.
    const { normalizeBankReference } = await import('@/server/pg/bank-source');
    expect(normalizeBankReference(`00${digits}`)).toBe(digits);
  });

  it('retryUnmatchedCredits skips credits with an open invariant exception (no starvation) and rotates the rest', async () => {
    const T = await makeTenant();
    const order = await makePendingOrder(T, 12000);
    const s = await makeSession(T, order.id, 12000, { state: 'OBSERVED' });
    const ref = utr();
    await prisma.pgPaymentAttempt.update({ where: { id: s.attempt.id }, data: { observedUtr: ref } });
    const wrong = await credit(T, 12001, ref); // amount mismatch -> REJECTED + AMOUNT_MISMATCH exception
    expect((await tryAllocateBankTxn(wrong.id)).outcome).toBe('REJECTED');
    const before = (await prisma.pgBankTransaction.findUniqueOrThrow({ where: { id: wrong.id } })).updatedAt;
    await retryUnmatchedCredits(500);
    expect((await prisma.pgBankTransaction.findUniqueOrThrow({ where: { id: wrong.id } })).updatedAt).toEqual(before); // not retried
    await prisma.pgReconException.updateMany({ where: { bankTransactionId: wrong.id }, data: { status: 'RESOLVED' } });
    await retryUnmatchedCredits(500);
    expect((await prisma.pgBankTransaction.findUniqueOrThrow({ where: { id: wrong.id } })).updatedAt.getTime()).toBeGreaterThan(before.getTime());
  });

  it('a completed refund is linked to the statement DEBIT with the same reference and amount (either order)', async () => {
    const T = await makeTenant();
    const lp = await latePayment(T, 14500);
    const req1 = await requestPgRefund({ attemptId: lp.attempt.id, kind: 'LATE_PAYMENT', amountPaise: 14500, reason: 'late', actor: { id: sa1.id } });
    await approvePgRefund({ refundId: req1.refundId, actor: { id: T.ownerId } });
    const refundRef = `RF${uid().toUpperCase()}`;
    // DEBIT imported first, refund completed second.
    await ingestBankTransactions(T.account.id, 'STATEMENT_IMPORT', [
      { direction: 'DEBIT', amountPaise: 14500, currency: 'INR', bankReference: refundRef, valueAt: new Date(), narrationRedacted: null, counterpartyMasked: null, sourceRowHash: uid() },
    ], 'fin-1');
    await completePgRefund({ refundId: req1.refundId, bankReference: refundRef, evidence: { note: 'bank app screenshot ref 1' }, actor: { id: T.ownerId } });
    const rec = await prisma.pgRefundRecord.findUniqueOrThrow({ where: { refundId: req1.refundId } });
    const debit = await prisma.pgBankTransaction.findFirstOrThrow({ where: { receivingAccountId: T.account.id, direction: 'DEBIT', bankReference: refundRef } });
    expect(rec.bankTransactionId).toBe(debit.id);
    expect(debit.status).toBe('ALLOCATED');

    // Refund completed first, DEBIT imported second; a DEBIT with a different amount is never linked.
    const lp2 = await latePayment(T, 14600);
    const req2 = await requestPgRefund({ attemptId: lp2.attempt.id, kind: 'LATE_PAYMENT', amountPaise: 14600, reason: 'late', actor: { id: sa1.id } });
    await approvePgRefund({ refundId: req2.refundId, actor: { id: T.ownerId } });
    const ref2 = `RF${uid().toUpperCase()}`;
    await completePgRefund({ refundId: req2.refundId, bankReference: ref2, evidence: { note: 'ok' }, actor: { id: T.ownerId } });
    await ingestBankTransactions(T.account.id, 'STATEMENT_IMPORT', [
      { direction: 'DEBIT', amountPaise: 14600, currency: 'INR', bankReference: ref2, valueAt: new Date(), narrationRedacted: null, counterpartyMasked: null, sourceRowHash: uid() },
    ], 'fin-1');
    expect((await prisma.pgRefundRecord.findUniqueOrThrow({ where: { refundId: req2.refundId } })).bankTransactionId).not.toBeNull();
    expect(await prisma.pgFinancialEvent.count({ where: { kind: 'REFUND_BANK_LINKED', refundId: { in: [req1.refundId, req2.refundId] } } })).toBe(2);
  });

  it('order exports label Flavrly PG orders as direct UPI, not RAZORPAY/PHONEPE', async () => {
    const T = await makeTenant();
    const order = await makePendingOrder(T, 9000);
    await makeSession(T, order.id, 9000);
    const csv = await new Response(ordersCsvStream([T.branchId], { from: new Date(0), to: new Date() })).text();
    const line = csv.split('\n').find((l: string) => l.startsWith(order.code))!;
    expect(line.endsWith(',FLAVRLY_PG_DIRECT_UPI')).toBe(true);
  });
});
