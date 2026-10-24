/**
 * Agent H — full money chain against real Postgres. Only the gateway HTTP (global fetch) and
 * notification side effects are stubbed. Every hop is the production code:
 *   signed webhook POST (route handler) -> inbox worker -> evidence -> status probe
 *   -> CSV statement import (bank-ingest) -> allocateBankCredit -> outbox -> handleOrderRelease
 *   -> transitionOrder -> Order RECEIVED.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64'); // fake test key
  delete process.env.REDIS_URL;
});
const h = vi.hoisted(() => ({ sms: vi.fn(async () => undefined), publish: vi.fn() }));
vi.mock('@/server/realtime', () => ({ publish: h.publish }));
vi.mock('@/server/notifications', () => ({ notify: { sms: h.sms } }));
vi.mock('@/server/push/milestones', () => ({ pushOrderMilestone: vi.fn(async () => undefined) }));
vi.mock('@/server/rider-push', () => ({ notifyRidersOfNewOrder: vi.fn(async () => undefined) }));
vi.mock('@/server/batch-dispatch', () => ({ maybeOfferAsBatch: vi.fn(async () => undefined) }));

import { prisma } from '@/server/db';
import { runInbox } from '@/server/pg/inbox';
import { createPgAttempt } from '@/server/pg/attempts';
import { runOutbox } from '@/server/pg/outbox';
import { importStatementCsv } from '@/server/pg/bank-ingest';
import { runYoupiReconcileSweep } from '@/server/jobs/youpi-reconcile-sweep';
import {
  MAPPING,
  gatewayFetch,
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
const calls: string[] = [];
let t: Tenant;

beforeAll(async () => {
  t = await makeTenant();
});
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(gatewayFetch(gw, calls)));
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma.$disconnect();
});

describe('H full chain: signed webhook -> bank statement -> capture -> kitchen release', () => {
  it('captures only after the statement credit, releases exactly once, and every replay is a no-op', async () => {
    const amount = 34567;
    const utr = `4${Date.now()}`.slice(0, 12);
    const order = await makePendingOrder(t, amount);
    // 0. Real session creation (pg/attempts.ts): binding, limits, gateway create + private readback.
    const created = await createPgAttempt({ id: order.id, restaurantId: t.restaurantId, customerId: t.customerId }, { amountPaise: amount, method: 'RAZORPAY' });
    expect(created).toMatchObject({ reused: false, amountPaise: amount });
    const s = {
      gatewayPaymentId: created.gatewayPaymentId,
      attemptKey: created.attemptKey,
      payment: { id: created.paymentId },
      attempt: { id: created.attemptId },
    };
    expect(await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: s.attempt.id } })).toMatchObject({
      state: 'AWAITING_PAYMENT', gatewayPaymentId: s.gatewayPaymentId, receivingAccountId: t.account.id, expectedAmountPaise: amount,
    });
    expect(await prisma.pgLimitReservation.count({ where: { attemptId: s.attempt.id } })).toBe(1);
    // A second session for the same order while this one is open is not minted (reuse).
    const again0 = await createPgAttempt({ id: order.id, restaurantId: t.restaurantId, customerId: t.customerId }, { amountPaise: amount, method: 'RAZORPAY' });
    expect(again0).toMatchObject({ reused: true, attemptId: s.attempt.id });
    gw.set(s.gatewayPaymentId, { status: 'SUCCESS' });

    // 1. Signed webhook (upstream V2 scheme) into the real route.
    const signed = signV2(
      { event: 'SUCCESS', paymentId: s.gatewayPaymentId, orderId: s.attemptKey, amountPaise: amount, utr },
      t.secret,
      { event: 'SUCCESS' },
    );
    const deliveryId = signed.headers['x-gateway-delivery-id'];
    const res = await postWebhook(signed);
    expect(res.status).toBe(200);
    const ev = await prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { providerEventId: `youpi:${deliveryId}` } });
    expect(ev).toMatchObject({ provider: 'youpi', restaurantId: t.restaurantId, paymentId: s.gatewayPaymentId, orderId: s.attemptKey });
    await settleInbox(`youpi:${deliveryId}`);
    await runInbox();

    // 2. Observation only: attempt OBSERVED with the signed UTR; nothing captured, nothing released.
    let snap = await snapshot(order.id);
    expect(snap.order.status).toBe('PAYMENT_PENDING');
    expect(snap.payments).toEqual([{ id: s.payment.id, status: 'PENDING' }]);
    expect(snap.attempts).toEqual([{ id: s.attempt.id, state: 'OBSERVED', observedUtr: utr }]);
    expect(snap.allocations).toEqual([]);
    expect(snap.outbox).toEqual([]);
    expect(snap.evidence.map((e) => e.source).sort()).toEqual(['GATEWAY_STATUS', 'GATEWAY_WEBHOOK']);
    expect(snap.evidence.find((e) => e.source === 'GATEWAY_WEBHOOK')?.utr).toBe(utr);
    expect(snap.exceptions).toEqual([]);
    expect((await prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { id: ev.id } })).processed).toBe(true);
    expect(calls.some((c) => c.includes(`/api/v1/payments/${s.gatewayPaymentId}`))).toBe(true);

    // 3. Bank statement import is the bank evidence -> atomic capture + ORDER_RELEASE outbox.
    const csv = statementCsv([{ ref: utr, creditPaise: amount }, { ref: `DR${uid()}`, debitPaise: 1000 }]);
    const imp = await importStatementCsv({ receivingAccountId: t.account.id, fileName: 'stmt.csv', content: csv, mapping: MAPPING, uploadedById: t.ownerId });
    expect(imp).toMatchObject({ duplicateFile: false, insertedCount: 2, duplicateCount: 0, conflictCount: 0, rejected: [] });
    const credit = await prisma.pgBankTransaction.findFirstOrThrow({ where: { receivingAccountId: t.account.id, bankReference: utr } });
    expect(credit).toMatchObject({ direction: 'CREDIT', amountPaise: amount, status: 'ALLOCATED', source: 'STATEMENT_IMPORT', importId: imp.importId });
    expect(await prisma.pgStatementImport.findUniqueOrThrow({ where: { id: imp.importId } })).toMatchObject({ status: 'COMPLETED', insertedCount: 2 });

    snap = await snapshot(order.id);
    expect(snap.order.status).toBe('PAYMENT_PENDING'); // kitchen sees nothing until the outbox runs
    expect(snap.payments[0].status).toBe('CAPTURED');
    expect(snap.attempts[0].state).toBe('CAPTURED');
    expect(snap.allocations).toEqual([{ id: expect.any(String), kind: 'ORDER_PAYMENT', bankTransactionId: credit.id }]);
    expect(snap.outbox).toEqual([{ id: expect.any(String), status: 'PENDING', topic: 'ORDER_RELEASE' }]);
    expect(snap.events).toEqual(
      ['ALLOCATION_ORDER_PAYMENT', 'ATTEMPT_OBSERVED', 'EVIDENCE_RECORDED', 'EVIDENCE_RECORDED', 'PAYMENT_CAPTURED'].sort(),
    );
    expect(await prisma.pgFinancialEvent.count({ where: { bankTransactionId: credit.id, kind: 'BANK_TXN_INGESTED' } })).toBe(1);

    // 4. Outbox -> handleOrderRelease -> transitionOrder.
    const out = await runOutbox(); // shared DB: other files may leave due rows; assert on ours
    expect(out.done).toBeGreaterThanOrEqual(1);
    snap = await snapshot(order.id);
    expect(snap.order.status).not.toBe('PAYMENT_PENDING');
    expect(snap.statusEvents.map((e) => e.status)).toContain('RECEIVED');
    expect(snap.statusEvents.filter((e) => e.status === 'RECEIVED')).toHaveLength(1);
    expect(snap.outbox[0].status).toBe('DONE');
    expect(snap.exceptions).toEqual([]);

    // 5. Replays everywhere change nothing.
    const before = await snapshot(order.id);
    expect((await postWebhook(signed)).status).toBe(200); // same delivery, fresh request
    await runInbox();
    const again = await importStatementCsv({ receivingAccountId: t.account.id, fileName: 'stmt-again.csv', content: csv, mapping: MAPPING, uploadedById: t.ownerId });
    expect(again).toMatchObject({ duplicateFile: true, importId: imp.importId, insertedCount: 0 });
    await runOutbox();
    await runYoupiReconcileSweep();
    expect(await snapshot(order.id)).toEqual(before);
    expect(await prisma.paymentWebhookEvent.count({ where: { providerEventId: `youpi:${deliveryId}` } })).toBe(1);
  });

  it('Standard-Webhooks signed delivery takes the same path (OBSERVED, never CAPTURED without a credit)', async () => {
    const amount = 10001;
    const order = await makePendingOrder(t, amount);
    const s = await makeSession(t, order.id, amount);
    gw.set(s.gatewayPaymentId, { status: 'SUCCESS', amountPaise: amount });
    const signed = signStandard(
      { type: 'payment.succeeded', data: { object: { id: s.gatewayPaymentId, orderId: s.attemptKey, amountPaise: amount, utr: 'STDUTR0001' } } },
      t.secret,
    );
    const res = await postWebhook(signed);
    expect(res.status).toBe(200);
    await settleInbox(`youpi:${signed.headers['webhook-id']}`);
    await runInbox();
    const snap = await snapshot(order.id);
    expect(snap.attempts[0]).toMatchObject({ state: 'OBSERVED', observedUtr: 'STDUTR0001' });
    expect(snap.payments[0].status).toBe('PENDING');
    expect(snap.allocations).toEqual([]);
    expect(snap.order.status).toBe('PAYMENT_PENDING');
  });
});
