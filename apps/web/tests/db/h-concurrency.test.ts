/**
 * Agent H — concurrency against real Postgres (row locks, partial unique indexes, leases).
 * Gateway HTTP is a fetch stub; everything else is production code.
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
import { runInbox } from '@/server/pg/inbox';
import { runOutbox } from '@/server/pg/outbox';
import { approveManualBankTransaction, enterManualBankTransaction, importStatementCsv } from '@/server/pg/bank-ingest';
import { allocateBankCredit, recordObservation, tryAllocateBankTxn } from '@/server/pg/reconcile-engine';
import { runYoupiReconcileSweep } from '@/server/jobs/youpi-reconcile-sweep';
import {
  MAPPING,
  gatewayFetch,
  makePendingOrder,
  makeSession,
  makeTenant,
  postWebhook,
  settleInbox,
  signV2,
  snapshot,
  statementCsv,
  uid,
  type GatewayStatus,
  type Tenant,
} from './h-support';

const gw = new Map<string, GatewayStatus>();
let A: Tenant;

beforeAll(async () => {
  A = await makeTenant();
});
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(gatewayFetch(gw)));
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma.$disconnect();
});

const utrOf = () => `U${uid().toUpperCase()}`;

async function observedSession(amount: number, orderId?: string, createdAt?: Date) {
  const oid = orderId ?? (await makePendingOrder(A, amount, createdAt)).id;
  const s = await makeSession(A, oid, amount, { createdAt });
  const utr = utrOf();
  await recordObservation({ attemptId: s.attempt.id, source: 'GATEWAY_WEBHOOK', utr, amountPaise: amount, authenticated: true, dedupeKey: `h:${uid()}` });
  return { orderId: oid, ...s, utr, amount };
}

function credit(utr: string, amountPaise: number) {
  return prisma.pgBankTransaction.create({
    data: { receivingAccountId: A.account.id, direction: 'CREDIT', amountPaise, bankReference: utr, valueAt: new Date(), source: 'STATEMENT_IMPORT', sourceRowHash: uid() },
  });
}

describe('H concurrency', () => {
  it('signed webhook processing races two reconcile sweeps and a second inbox worker for one attempt -> captured once', async () => {
    const amount = 31000;
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
    const order = await makePendingOrder(A, amount, fiveMinAgo);
    const s = await makeSession(A, order.id, amount, { createdAt: fiveMinAgo });
    const utr = utrOf();
    gw.set(s.gatewayPaymentId, { status: 'SUCCESS', amountPaise: amount });
    // Credit lands first (NO_CANDIDATE), so capture must come from the attempt side.
    await importStatementCsv({ receivingAccountId: A.account.id, fileName: 'race.csv', content: statementCsv([{ ref: utr, creditPaise: amount }]), mapping: MAPPING, uploadedById: A.ownerId });
    const signed = signV2({ event: 'SUCCESS', paymentId: s.gatewayPaymentId, orderId: s.attemptKey, utr, amountPaise: amount }, A.secret);
    const [res] = await Promise.all([postWebhook(signed), runInbox(), runYoupiReconcileSweep(), runYoupiReconcileSweep(), runInbox()]);
    expect(res.status).toBe(200);
    await settleInbox(`youpi:${signed.headers['x-gateway-delivery-id']}`);
    await runInbox();
    await runYoupiReconcileSweep();
    await Promise.all([runOutbox(), runOutbox(), runOutbox()]);
    const snap = await snapshot(order.id);
    expect(snap.payments[0].status).toBe('CAPTURED');
    expect(snap.allocations).toHaveLength(1);
    expect(snap.events.filter((k) => k === 'PAYMENT_CAPTURED')).toHaveLength(1);
    expect(snap.outbox).toEqual([{ id: expect.any(String), status: 'DONE', topic: 'ORDER_RELEASE' }]);
    expect(snap.statusEvents.filter((e) => e.status === 'RECEIVED')).toHaveLength(1);
    expect(snap.evidence.filter((e) => e.source === 'GATEWAY_WEBHOOK')).toHaveLength(1);
  });

  it('20 independent allocations in parallel -> 20 captures, 20 release rows', async () => {
    const sessions = [];
    for (let i = 0; i < 20; i++) sessions.push(await observedSession(10000 + i));
    const credits = await Promise.all(sessions.map((s) => credit(s.utr, s.amount)));
    const results = await Promise.all(credits.map((c) => tryAllocateBankTxn(c.id)));
    expect(results.map((r) => r.outcome)).toEqual(Array(20).fill('CAPTURED'));
    expect(await prisma.payment.count({ where: { id: { in: sessions.map((s) => s.payment.id) }, status: 'CAPTURED' } })).toBe(20);
    expect(await prisma.pgOutbox.count({ where: { aggregateId: { in: sessions.map((s) => s.orderId) } } })).toBe(20);
  });

  it('20 parallel allocations of the SAME credit -> exactly one CAPTURED, 19 ALREADY_ALLOCATED', async () => {
    const s = await observedSession(15500);
    const c = await credit(s.utr, s.amount);
    const results = await Promise.all(Array.from({ length: 20 }, () => allocateBankCredit({ attemptId: s.attempt.id, bankTransactionId: c.id })));
    const outcomes = results.map((r) => r.outcome).sort();
    expect(outcomes.filter((o) => o === 'CAPTURED')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'ALREADY_ALLOCATED')).toHaveLength(19);
    expect(await prisma.pgAllocation.count({ where: { bankTransactionId: c.id } })).toBe(1);
    expect(await prisma.pgFinancialEvent.count({ where: { kind: 'PAYMENT_CAPTURED', attemptId: s.attempt.id } })).toBe(1);
  });

  it('20 attempts on ONE order, each with its own credit, allocated in parallel -> 1 ORDER_PAYMENT + 19 OVERCOLLECTION', async () => {
    const order = await makePendingOrder(A, 20000);
    const sessions = [];
    for (let i = 0; i < 20; i++) sessions.push(await observedSession(20000, order.id));
    const credits = await Promise.all(sessions.map((s) => credit(s.utr, s.amount)));
    const results = await Promise.all(credits.map((c) => tryAllocateBankTxn(c.id)));
    const outcomes = results.map((r) => r.outcome);
    expect(outcomes.filter((o) => o === 'CAPTURED')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'OVERCOLLECTION')).toHaveLength(19);
    await Promise.all([runOutbox(), runOutbox()]);
    const snap = await snapshot(order.id);
    expect(snap.payments.filter((p) => p.status === 'CAPTURED')).toHaveLength(1);
    expect(snap.allocations.filter((a) => a.kind === 'ORDER_PAYMENT')).toHaveLength(1);
    expect(snap.exceptions.filter((e) => e.kind === 'OVERCOLLECTION')).toHaveLength(19);
    expect(snap.outbox).toHaveLength(1);
    expect(snap.statusEvents.filter((e) => e.status === 'RECEIVED')).toHaveLength(1);
  });

  it('the same statement file uploaded 5x in parallel -> one import, one txn per row, one capture', async () => {
    const s = await observedSession(17700);
    const other = utrOf();
    const content = statementCsv([{ ref: s.utr, creditPaise: s.amount }, { ref: other, creditPaise: 999 }]);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => importStatementCsv({ receivingAccountId: A.account.id, fileName: 'p.csv', content, mapping: MAPPING, uploadedById: A.ownerId })),
    );
    expect(results.filter((r) => !r.duplicateFile)).toHaveLength(1);
    expect(new Set(results.map((r) => r.importId)).size).toBe(1);
    expect(await prisma.pgBankTransaction.count({ where: { receivingAccountId: A.account.id, bankReference: { in: [s.utr, other] } } })).toBe(2);
    expect(await prisma.pgAllocation.count({ where: { attemptId: s.attempt.id } })).toBe(1);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: s.payment.id } })).status).toBe('CAPTURED');
  });

  it('5 DIFFERENT files with overlapping rows imported in parallel -> each reference once, captured once', async () => {
    const s = await observedSession(18800);
    const files = Array.from({ length: 5 }, (_, i) => statementCsv([{ ref: s.utr, creditPaise: s.amount, narration: `copy ${i}` }, { ref: utrOf(), creditPaise: 100 + i }]));
    await Promise.all(files.map((content, i) => importStatementCsv({ receivingAccountId: A.account.id, fileName: `f${i}.csv`, content, mapping: MAPPING, uploadedById: A.ownerId })));
    expect(await prisma.pgBankTransaction.count({ where: { receivingAccountId: A.account.id, bankReference: s.utr } })).toBe(1);
    expect(await prisma.pgAllocation.count({ where: { attemptId: s.attempt.id } })).toBe(1);
    expect(await prisma.pgFinancialEvent.count({ where: { kind: 'PAYMENT_CAPTURED', attemptId: s.attempt.id } })).toBe(1);
  });

  it('5 approvers approve one manual entry concurrently -> one approval event, one capture', async () => {
    const s = await observedSession(19900);
    const m = await enterManualBankTransaction({ receivingAccountId: A.account.id, direction: 'CREDIT', amountPaise: s.amount, bankReference: s.utr, valueAt: new Date(), enteredById: 'maker' });
    await Promise.all(['c1', 'c2', 'c3', 'c4', 'c5'].map((who) => approveManualBankTransaction(m.id, who)));
    expect(await prisma.pgFinancialEvent.count({ where: { kind: 'BANK_TXN_APPROVED', bankTransactionId: m.id } })).toBe(1);
    expect(await prisma.pgAllocation.count({ where: { bankTransactionId: m.id } })).toBe(1);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: s.payment.id } })).status).toBe('CAPTURED');
  });

  it('overlapping workers (2x inbox, 2x outbox, 2x sweep) over 5 paid sessions -> each order released exactly once', async () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60_000);
    const sessions = [];
    for (let i = 0; i < 5; i++) {
      const order = await makePendingOrder(A, 21000 + i, tenMinAgo);
      const s = await makeSession(A, order.id, 21000 + i, { createdAt: tenMinAgo });
      gw.set(s.gatewayPaymentId, { status: 'SUCCESS', amountPaise: 21000 + i });
      sessions.push({ order, ...s, utr: utrOf(), amount: 21000 + i });
    }
    await importStatementCsv({
      receivingAccountId: A.account.id, fileName: 'w.csv', content: statementCsv(sessions.map((s) => ({ ref: s.utr, creditPaise: s.amount }))), mapping: MAPPING, uploadedById: A.ownerId,
    });
    const posts = sessions.map((s) => postWebhook(signV2({ event: 'SUCCESS', paymentId: s.gatewayPaymentId, orderId: s.attemptKey, utr: s.utr, amountPaise: s.amount }, A.secret)));
    await Promise.all([...posts, runInbox(), runInbox(), runYoupiReconcileSweep(), runYoupiReconcileSweep(), runOutbox(), runOutbox()]);
    for (let i = 0; i < 3; i++) {
      await Promise.all([runInbox(), runInbox(), runYoupiReconcileSweep()]);
      await Promise.all([runOutbox(), runOutbox()]);
    }
    for (const s of sessions) {
      const snap = await snapshot(s.order.id);
      expect(snap.payments[0].status).toBe('CAPTURED');
      expect(snap.allocations).toHaveLength(1);
      expect(snap.statusEvents.filter((e) => e.status === 'RECEIVED')).toHaveLength(1);
      expect(snap.outbox[0]?.status).toBe('DONE');
    }
  });
});
