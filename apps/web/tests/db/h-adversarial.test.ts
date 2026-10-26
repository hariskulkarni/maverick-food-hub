/**
 * Agent H — adversarial / negative cases against real Postgres and the real webhook route.
 * Only gateway HTTP (fetch) and notification side effects are stubbed.
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

import crypto from 'node:crypto';
import { prisma } from '@/server/db';
import { saveConfig } from '@/server/integrations';
import { runInbox } from '@/server/pg/inbox';
import { runOutbox } from '@/server/pg/outbox';
import { enqueueOutbox } from '@/server/pg/outbox';
import { transitionOrder } from '@/server/orders';
import {
  approveManualBankTransaction,
  enterManualBankTransaction,
  importStatementCsv,
} from '@/server/pg/bank-ingest';
import {
  allocateBankCredit,
  approveManualAllocation,
  proposeManualAllocation,
  recordObservation,
  tryAllocateBankTxn,
} from '@/server/pg/reconcile-engine';
import { reconcileYoupiPayment } from '@/server/payments/youpi-reconcile';
import {
  MAPPING,
  gatewayFetch,
  istToday,
  makePendingOrder,
  makeSession,
  makeTenant,
  postWebhook,
  settleInbox,
  signStandard,
  signV2,
  snapshot,
  statementCsv,
  uid,
  type GatewayStatus,
  type Tenant,
} from './h-support';

const gw = new Map<string, GatewayStatus>();
let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  A = await makeTenant();
  B = await makeTenant();
});
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(gatewayFetch(gw)));
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma.$disconnect();
});

const utrOf = () => `U${uid().toUpperCase()}`;

async function session(t: Tenant, amount = 25000) {
  const order = await makePendingOrder(t, amount);
  const s = await makeSession(t, order.id, amount);
  return { order, ...s, amount };
}

/** Signed webhook + inline processing settled + one worker pass. */
async function deliver(t: Tenant, s: { gatewayPaymentId: string; attemptKey: string }, body: Record<string, unknown>) {
  const signed = signV2({ event: 'SUCCESS', paymentId: s.gatewayPaymentId, orderId: s.attemptKey, ...body }, t.secret);
  const res = await postWebhook(signed);
  await settleInbox(`youpi:${signed.headers['x-gateway-delivery-id']}`);
  await runInbox();
  return res;
}

async function importCsv(t: Tenant, rows: Parameters<typeof statementCsv>[0], name = 'stmt.csv') {
  return importStatementCsv({ receivingAccountId: t.account.id, fileName: name, content: statementCsv(rows), mapping: MAPPING, uploadedById: t.ownerId });
}

const webhookRows = (deliveryId: string) => prisma.paymentWebhookEvent.count({ where: { providerEventId: `youpi:${deliveryId}` } });

// ───────────────────────────── webhook authentication ─────────────────────────────

describe('H webhook route: authentication and replay', () => {
  it('forged signature -> 401, nothing stored', async () => {
    const s = await session(A);
    const signed = signV2({ event: 'SUCCESS', paymentId: s.gatewayPaymentId, orderId: s.attemptKey, utr: utrOf() }, A.secret);
    signed.headers['x-gateway-signature-v2'] = `sha256=${crypto.randomBytes(32).toString('hex')}`;
    expect((await postWebhook(signed)).status).toBe(401);
    expect(await webhookRows(signed.headers['x-gateway-delivery-id'])).toBe(0);
  });

  it("signature made with ANOTHER restaurant's secret -> 401", async () => {
    const s = await session(A);
    const signed = signV2({ event: 'SUCCESS', paymentId: s.gatewayPaymentId, orderId: s.attemptKey, utr: utrOf() }, B.secret);
    expect((await postWebhook(signed)).status).toBe(401);
    expect(await webhookRows(signed.headers['x-gateway-delivery-id'])).toBe(0);
  });

  it('platform secret is NOT accepted for a restaurant that has its own secret', async () => {
    const s = await session(A);
    const signed = signV2({ event: 'SUCCESS', paymentId: s.gatewayPaymentId, orderId: s.attemptKey, utr: utrOf() }, 'fake-platform-webhook-secret-h');
    expect((await postWebhook(signed)).status).toBe(401);
  });

  it('body tampered after signing (UTR swapped) -> 401', async () => {
    const s = await session(A);
    const signed = signV2({ event: 'SUCCESS', paymentId: s.gatewayPaymentId, orderId: s.attemptKey, utr: 'UTRGOOD0001' }, A.secret);
    signed.raw = signed.raw.replace('UTRGOOD0001', 'UTREVIL0001');
    expect((await postWebhook(signed)).status).toBe(401);
  });

  it('legacy body-only X-Gateway-Signature (timestamp unauthenticated) -> 401', async () => {
    const s = await session(A);
    const raw = JSON.stringify({ event: 'SUCCESS', paymentId: s.gatewayPaymentId, orderId: s.attemptKey, utr: utrOf() });
    const sig = crypto.createHmac('sha256', A.secret).update(raw).digest('hex');
    const res = await postWebhook({ raw, headers: { 'content-type': 'application/json', 'x-gateway-signature': `sha256=${sig}` } });
    expect(res.status).toBe(401);
  });

  it('Standard-Webhooks: re-stamping webhook-timestamp on a captured delivery -> 401', async () => {
    const s = await session(A);
    const signed = signStandard({ type: 'payment.succeeded', data: { object: { id: s.gatewayPaymentId, orderId: s.attemptKey } } }, A.secret, {
      tsSec: Math.floor(Date.now() / 1000) - 3600,
    });
    signed.headers['webhook-timestamp'] = String(Math.floor(Date.now() / 1000));
    expect((await postWebhook(signed)).status).toBe(401);
  });

  it('replayed delivery: 200 deduped, one inbox row, one evidence row', async () => {
    const s = await session(A);
    const signed = signV2({ event: 'SUCCESS', paymentId: s.gatewayPaymentId, orderId: s.attemptKey, utr: utrOf(), amountPaise: s.amount }, A.secret);
    const id = signed.headers['x-gateway-delivery-id'];
    expect((await postWebhook(signed)).status).toBe(200);
    await settleInbox(`youpi:${id}`);
    const r2 = await postWebhook(signed);
    expect(r2.status).toBe(200);
    expect(await r2.json()).toMatchObject({ deduped: true });
    await runInbox();
    expect(await webhookRows(id)).toBe(1);
    expect(await prisma.pgPaymentEvidence.count({ where: { attemptId: s.attempt.id, source: 'GATEWAY_WEBHOOK' } })).toBe(1);
  });

  it('stale timestamp for an unknown delivery -> 400 and not stored; for a stored delivery -> 200 no-op', async () => {
    const s = await session(A);
    const old = Math.floor(Date.now() / 1000) - 600;
    const stale = signV2({ event: 'SUCCESS', paymentId: s.gatewayPaymentId, orderId: s.attemptKey, utr: utrOf() }, A.secret, { tsSec: old });
    expect((await postWebhook(stale)).status).toBe(400);
    expect(await webhookRows(stale.headers['x-gateway-delivery-id'])).toBe(0);

    const fresh = signV2({ event: 'SUCCESS', paymentId: s.gatewayPaymentId, orderId: s.attemptKey, utr: utrOf() }, A.secret);
    expect((await postWebhook(fresh)).status).toBe(200);
    await settleInbox(`youpi:${fresh.headers['x-gateway-delivery-id']}`);
    // Upstream retry 10 minutes later: original body + original timestamp, byte-for-byte.
    const realNow = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(realNow + 10 * 60_000);
    let r: Response;
    try {
      r = await postWebhook(fresh);
    } finally {
      spy.mockRestore();
    }
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ deduped: true });
    expect(await webhookRows(fresh.headers['x-gateway-delivery-id'])).toBe(1);
  });

  it('future timestamp beyond skew -> 400', async () => {
    const s = await session(A);
    const signed = signV2({ event: 'SUCCESS', paymentId: s.gatewayPaymentId, orderId: s.attemptKey }, A.secret, {
      tsSec: Math.floor(Date.now() / 1000) + 600,
    });
    expect((await postWebhook(signed)).status).toBe(400);
  });

  it('header/body mismatch: delivery id, body timestamp, event type, missing identity -> 400', async () => {
    const s = await session(A);
    const base = { event: 'SUCCESS', paymentId: s.gatewayPaymentId, orderId: s.attemptKey };
    const d1 = signV2(base, A.secret, { headerDeliveryId: `other_${uid()}` });
    expect((await postWebhook(d1)).status).toBe(400);
    const d2 = signV2(base, A.secret, { bodyTimestamp: '1700000000' });
    expect((await postWebhook(d2)).status).toBe(400);
    const d3 = signV2(base, A.secret, { event: 'FAILED' });
    expect((await postWebhook(d3)).status).toBe(400);
    const d4 = signV2({ event: 'SUCCESS' }, 'fake-platform-webhook-secret-h');
    expect((await postWebhook(d4)).status).toBe(400);
    for (const d of [d1, d2, d3, d4]) expect(await webhookRows(d.headers['x-gateway-delivery-id'])).toBe(0);
  });

  it('body over 64 KiB -> 413 before any HMAC work', async () => {
    const s = await session(A);
    const signed = signV2({ event: 'SUCCESS', paymentId: s.gatewayPaymentId, orderId: s.attemptKey, pad: 'x'.repeat(70 * 1024) }, A.secret);
    expect((await postWebhook(signed)).status).toBe(413);
  });

  it('attempt whose restaurant has no webhook secret (not on platform merchant) -> 503, never 200', async () => {
    const C = await makeTenant();
    await saveConfig(C.restaurantId, 'YOUPI', { merchantId: C.account.gatewayMerchantId, receivingVpa: C.account.vpa });
    const s = await session(C);
    const signed = signV2({ event: 'SUCCESS', paymentId: s.gatewayPaymentId, orderId: s.attemptKey }, C.secret);
    expect((await postWebhook(signed)).status).toBe(503);
  });

  it('identity confusion: body names B attemptKey + A gatewayPaymentId, signed by A -> B never gets evidence', async () => {
    for (const bFirst of [true, false]) {
      const make = async (t: Tenant) => session(t);
      const sB = bFirst ? await make(B) : undefined;
      const sA = await make(A);
      const sB2 = sB ?? (await make(B));
      const utr = utrOf();
      const signed = signV2({ event: 'SUCCESS', paymentId: sA.gatewayPaymentId, orderId: sB2.attemptKey, utr, amountPaise: sB2.amount }, A.secret);
      const res = await postWebhook(signed);
      if (res.status === 200) await settleInbox(`youpi:${signed.headers['x-gateway-delivery-id']}`);
      await runInbox();
      const b = await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: sB2.attempt.id } });
      expect(b.observedUtr).toBeNull();
      expect(await prisma.pgPaymentEvidence.count({ where: { attemptId: sB2.attempt.id } })).toBe(0);
    }
  });
});

// ───────────────────────────── money adversarial ─────────────────────────────

describe('H money path: gateway claims are never bank proof', () => {
  it('signed SUCCESS + status SUCCESS, no bank credit, repeated worker/sweep passes -> never CAPTURED', async () => {
    const s = await session(A);
    gw.set(s.gatewayPaymentId, { status: 'SUCCESS', amountPaise: s.amount });
    await deliver(A, s, { utr: utrOf(), amountPaise: s.amount });
    for (let i = 0; i < 3; i++) {
      await reconcileYoupiPayment(s.payment.id);
      await runOutbox();
    }
    const snap = await snapshot(s.order.id);
    expect(snap.payments[0].status).toBe('PENDING');
    expect(snap.attempts[0].state).toBe('OBSERVED');
    expect(snap.allocations).toEqual([]);
    expect(snap.order.status).toBe('PAYMENT_PENDING');
  });

  it('webhook amount 1 paisa off -> AMOUNT_MISMATCH exception, attempt not OBSERVED, UTR not adopted', async () => {
    const s = await session(A);
    const utr = utrOf();
    await deliver(A, s, { utr, amountPaise: s.amount - 1 });
    const a = await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: s.attempt.id } });
    expect(a.state).toBe('AWAITING_PAYMENT');
    expect(a.observedUtr).toBeNull();
    expect(await prisma.pgReconException.count({ where: { attemptId: s.attempt.id, kind: 'AMOUNT_MISMATCH' } })).toBe(1);
  });

  it('bank credit 1 paisa short with the right UTR -> REJECTED (AMOUNT_MISMATCH), credit stays UNMATCHED', async () => {
    const s = await session(A);
    const utr = utrOf();
    await deliver(A, s, { utr, amountPaise: s.amount });
    const imp = await importCsv(A, [{ ref: utr, creditPaise: s.amount - 1 }]);
    expect(imp.insertedCount).toBe(1);
    const txn = await prisma.pgBankTransaction.findFirstOrThrow({ where: { receivingAccountId: A.account.id, bankReference: utr } });
    expect(txn.status).toBe('UNMATCHED');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: s.payment.id } })).status).toBe('PENDING');
    expect(await prisma.pgReconException.count({ where: { bankTransactionId: txn.id, kind: 'AMOUNT_MISMATCH' } })).toBe(1);
  });

  it("credit with A's UTR landing in B's account never captures A; B's credit finds no candidate", async () => {
    const s = await session(A);
    const utr = utrOf();
    await deliver(A, s, { utr, amountPaise: s.amount });
    await importCsv(B, [{ ref: utr, creditPaise: s.amount }]);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: s.payment.id } })).status).toBe('PENDING');
    const bTxn = await prisma.pgBankTransaction.findFirstOrThrow({ where: { receivingAccountId: B.account.id, bankReference: utr } });
    expect(bTxn.status).toBe('UNMATCHED');
    // Forcing it through the engine is refused with WRONG_ACCOUNT.
    const r = await allocateBankCredit({ attemptId: s.attempt.id, bankTransactionId: bTxn.id });
    expect(r).toMatchObject({ outcome: 'REJECTED' });
    expect(await prisma.pgReconException.count({ where: { bankTransactionId: bTxn.id, kind: 'WRONG_ACCOUNT' } })).toBe(1);
    expect(await prisma.pgAllocation.count({ where: { bankTransactionId: bTxn.id } })).toBe(0);
  });

  it('same UTR observed on two attempts of the same account -> AMBIGUOUS, nobody captured', async () => {
    const s1 = await session(A);
    const s2 = await session(A);
    const utr = utrOf();
    await deliver(A, s1, { utr, amountPaise: s1.amount });
    await deliver(A, s2, { utr, amountPaise: s2.amount });
    await importCsv(A, [{ ref: utr, creditPaise: s1.amount }]);
    const txn = await prisma.pgBankTransaction.findFirstOrThrow({ where: { receivingAccountId: A.account.id, bankReference: utr } });
    expect(txn.status).toBe('UNMATCHED');
    expect(await prisma.pgReconException.count({ where: { bankTransactionId: txn.id, kind: 'AMBIGUOUS_MATCH' } })).toBe(1);
    for (const s of [s1, s2]) expect((await prisma.payment.findUniqueOrThrow({ where: { id: s.payment.id } })).status).toBe('PENDING');
  });

  it('missing UTR: signed SUCCESS without utr + status SUCCESS -> MISSING_UTR exception, credit not auto-allocated', async () => {
    const s = await session(A);
    gw.set(s.gatewayPaymentId, { status: 'SUCCESS', amountPaise: s.amount });
    await deliver(A, s, { amountPaise: s.amount });
    const a = await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: s.attempt.id } });
    expect(a).toMatchObject({ state: 'OBSERVED', observedUtr: null });
    expect(await prisma.pgReconException.count({ where: { dedupeKey: `MISSING_UTR:${s.attempt.id}` } })).toBe(1);
    await importCsv(A, [{ ref: utrOf(), creditPaise: s.amount }]);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: s.payment.id } })).status).toBe('PENDING');
  });

  // DEFECT H-03: OPERATIONS_RUNBOOK.md §3.5 promises unmatched credits "become UNMATCHED_CREDIT";
  // no code path ever opens PgExceptionKind.UNMATCHED_CREDIT (grep: zero writers). A real credit
  // with no candidate attempt is invisible in the exception queue. Left failing deliberately.
  it('a bank credit with no candidate attempt raises an UNMATCHED_CREDIT exception', async () => {
    const ref = utrOf();
    const imp = await importCsv(A, [{ ref, creditPaise: 12345 }]);
    expect(imp.insertedCount).toBe(1);
    const txn = await prisma.pgBankTransaction.findFirstOrThrow({ where: { receivingAccountId: A.account.id, bankReference: ref } });
    expect(txn.status).toBe('UNMATCHED');
    expect(await prisma.pgReconException.count({ where: { bankTransactionId: txn.id, kind: 'UNMATCHED_CREDIT' } })).toBe(1);
  });

  it('two attempts on one order both paid -> one ORDER_PAYMENT, one OVERCOLLECTION (+exception), released once', async () => {
    const order = await makePendingOrder(A, 20000);
    const s1 = { order, ...(await makeSession(A, order.id, 20000)), amount: 20000 };
    const s2 = { order, ...(await makeSession(A, order.id, 20000)), amount: 20000 };
    const u1 = utrOf();
    const u2 = utrOf();
    await deliver(A, s1, { utr: u1, amountPaise: 20000 });
    await deliver(A, s2, { utr: u2, amountPaise: 20000 });
    await importCsv(A, [{ ref: u1, creditPaise: 20000 }, { ref: u2, creditPaise: 20000 }]);
    await runOutbox();
    await runOutbox();
    const snap = await snapshot(order.id);
    expect(snap.allocations.map((a) => a.kind).sort()).toEqual(['ORDER_PAYMENT', 'OVERCOLLECTION']);
    expect(snap.payments.map((p) => p.status).sort()).toEqual(['CAPTURED', 'PENDING']);
    expect(snap.exceptions.filter((e) => e.kind === 'OVERCOLLECTION')).toHaveLength(1);
    expect(snap.outbox).toHaveLength(1);
    expect(snap.statusEvents.filter((e) => e.status === 'RECEIVED')).toHaveLength(1);
  });

  it('payment after customer cancellation -> LATE_PAYMENT allocation, Payment not CAPTURED, order untouched', async () => {
    const s = await session(A);
    const utr = utrOf();
    await deliver(A, s, { utr, amountPaise: s.amount });
    await transitionOrder(s.order.id, 'CANCELLED_BY_CUSTOMER' as any, { note: 'changed mind' });
    await importCsv(A, [{ ref: utr, creditPaise: s.amount }]);
    await runOutbox();
    const snap = await snapshot(s.order.id);
    expect(snap.allocations.map((a) => a.kind)).toEqual(['LATE_PAYMENT']);
    expect(snap.payments[0].status).toBe('PENDING');
    expect(snap.order.status).toBe('CANCELLED_BY_CUSTOMER');
    expect(snap.outbox).toEqual([]);
    expect(snap.exceptions.filter((e) => e.kind === 'LATE_PAYMENT')).toHaveLength(1);
  });

  it('gateway FAILED first, then a late signed SUCCESS with UTR + credit -> LATE_PAYMENT, not captured', async () => {
    const s = await session(A);
    gw.set(s.gatewayPaymentId, { status: 'EXPIRED' });
    await reconcileYoupiPayment(s.payment.id);
    expect((await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: s.attempt.id } })).state).toBe('FAILED');
    const utr = utrOf();
    await deliver(A, s, { utr, amountPaise: s.amount });
    await importCsv(A, [{ ref: utr, creditPaise: s.amount }]);
    const snap = await snapshot(s.order.id);
    expect(snap.allocations.map((a) => a.kind)).toEqual(['LATE_PAYMENT']);
    expect(snap.payments[0].status).toBe('FAILED');
    // Round-2 P0-4: gateway FAILED with no other live attempt fails the order (was stuck PAYMENT_PENDING).
    // The late credit still never releases it.
    expect(snap.order.status).toBe('PAYMENT_FAILED');
  });

  it('a DEBIT row carrying the observed UTR is never allocated', async () => {
    const s = await session(A);
    const utr = utrOf();
    await deliver(A, s, { utr, amountPaise: s.amount });
    await importCsv(A, [{ ref: utr, debitPaise: s.amount }]);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: s.payment.id } })).status).toBe('PENDING');
    expect(await prisma.pgAllocation.count({ where: { attemptId: s.attempt.id } })).toBe(0);
  });

  it('credit dated 3 days after the attempt -> REJECTED as outside the window (LATE_PAYMENT exception)', async () => {
    const s = await session(A);
    const utr = utrOf();
    await deliver(A, s, { utr, amountPaise: s.amount });
    await importCsv(A, [{ ref: utr, creditPaise: s.amount, date: istToday(3) }]);
    const txn = await prisma.pgBankTransaction.findFirstOrThrow({ where: { receivingAccountId: A.account.id, bankReference: utr } });
    expect(txn.status).toBe('UNMATCHED');
    expect(await prisma.pgReconException.count({ where: { bankTransactionId: txn.id, kind: 'LATE_PAYMENT' } })).toBe(1);
  });

  it('a forged ORDER_RELEASE outbox row for an uncaptured attempt never releases food', async () => {
    const s = await session(A);
    await prisma.$transaction((tx) =>
      enqueueOutbox(tx, {
        topic: 'ORDER_RELEASE',
        aggregateId: s.order.id,
        dedupeKey: `ORDER_RELEASE:${s.order.id}`,
        payload: { orderId: s.order.id, attemptId: s.attempt.id, paymentId: s.payment.id },
      }),
    );
    await runOutbox();
    const row = await prisma.pgOutbox.findUniqueOrThrow({ where: { dedupeKey: `ORDER_RELEASE:${s.order.id}` } });
    expect(row).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(row.lastError).toMatch(/not CAPTURED/);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: s.order.id } })).status).toBe('PAYMENT_PENDING');
  });

  it('admin/manual transition PAYMENT_PENDING -> RECEIVED on a youpi order is refused', async () => {
    const s = await session(A);
    await expect(transitionOrder(s.order.id, 'RECEIVED' as any, { actorId: A.ownerId })).rejects.toThrow(/bank-verified/);
  });
});

// ───────────────────────────── statements and dual control ─────────────────────────────

describe('H statements and dual control', () => {
  it('duplicate rows inside one CSV and an overlapping second file -> one bank txn per reference', async () => {
    const r1 = utrOf();
    const r2 = utrOf();
    const f1 = await importCsv(A, [{ ref: r1, creditPaise: 1111 }, { ref: r1, creditPaise: 1111 }, { ref: r2, creditPaise: 2222 }], 'a.csv');
    expect(f1).toMatchObject({ insertedCount: 2, duplicateCount: 1, conflictCount: 0 });
    const f2 = await importCsv(A, [{ ref: r2, creditPaise: 2222 }, { ref: r1, creditPaise: 1111, narration: 'different bytes' }], 'b.csv');
    expect(f2).toMatchObject({ duplicateFile: false, insertedCount: 0, duplicateCount: 2 });
    expect(await prisma.pgBankTransaction.count({ where: { receivingAccountId: A.account.id, bankReference: { in: [r1, r2] } } })).toBe(2);
  });

  it('same reference, different amount in a later file -> not overwritten, DUPLICATE_CREDIT exception', async () => {
    const r = utrOf();
    await importCsv(A, [{ ref: r, creditPaise: 5000 }], 'x.csv');
    const f = await importCsv(A, [{ ref: r, creditPaise: 5001 }], 'y.csv');
    expect(f.conflictCount).toBe(1);
    const txn = await prisma.pgBankTransaction.findFirstOrThrow({ where: { receivingAccountId: A.account.id, bankReference: r } });
    expect(txn.amountPaise).toBe(5000);
    expect(await prisma.pgReconException.count({ where: { bankTransactionId: txn.id, kind: 'DUPLICATE_CREDIT' } })).toBe(1);
  });

  it('manual bank entry: self-approval refused, unapproved entry not allocatable, second user approves -> captured', async () => {
    const s = await session(A);
    const utr = utrOf();
    await deliver(A, s, { utr, amountPaise: s.amount });
    const m = await enterManualBankTransaction({
      receivingAccountId: A.account.id, direction: 'CREDIT', amountPaise: s.amount, bankReference: utr, valueAt: new Date(), enteredById: 'op-1',
    });
    await expect(approveManualBankTransaction(m.id, 'op-1')).rejects.toThrow(/different user/);
    expect(await tryAllocateBankTxn(m.id)).toMatchObject({ outcome: 'NO_CANDIDATE' });
    const forced = await allocateBankCredit({ attemptId: s.attempt.id, bankTransactionId: m.id });
    expect(forced.outcome).toBe('REJECTED');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: s.payment.id } })).status).toBe('PENDING');
    await approveManualBankTransaction(m.id, 'op-2');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: s.payment.id } })).status).toBe('CAPTURED');
  });

  it('manual allocation: proposer cannot approve own proposal; a second user can', async () => {
    const s = await session(A);
    // No UTR observed at all: only dual-control can link this credit.
    const ref = utrOf();
    await importCsv(A, [{ ref, creditPaise: s.amount }]);
    const txn = await prisma.pgBankTransaction.findFirstOrThrow({ where: { receivingAccountId: A.account.id, bankReference: ref } });
    const p = await proposeManualAllocation({ attemptId: s.attempt.id, bankTransactionId: txn.id, operatorId: 'op-1', reason: 'customer screenshot + bank call' });
    await expect(approveManualAllocation({ proposalId: p.proposalId, approverId: 'op-1' })).rejects.toThrow(/second approver/);
    const r = await approveManualAllocation({ proposalId: p.proposalId, approverId: 'op-2' });
    expect(r.outcome).toBe('CAPTURED');
    const alloc = await prisma.pgAllocation.findUniqueOrThrow({ where: { bankTransactionId: txn.id } });
    expect(alloc).toMatchObject({ createdById: 'op-1', approvedById: 'op-2' });
    // Approving the same proposal twice is a no-op.
    expect((await approveManualAllocation({ proposalId: p.proposalId, approverId: 'op-3' })).outcome).toBe('ALREADY_ALLOCATED');
  });

  it('recordObservation is idempotent per dedupeKey and never sets CAPTURED', async () => {
    const s = await session(A);
    const input = { attemptId: s.attempt.id, source: 'GATEWAY_WEBHOOK' as const, utr: utrOf(), amountPaise: s.amount, authenticated: true, dedupeKey: `h:${uid()}` };
    const a = await recordObservation(input);
    const b = await recordObservation(input);
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect((await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: s.attempt.id } })).state).toBe('OBSERVED');
  });
});
