/**
 * Agent H — fault injection against real Postgres. Crashes are simulated by leaving rows in the
 * exact state a killed process leaves them (lease held, expiry passed); DB failures are injected
 * by making a single Prisma call reject. Gateway HTTP is a fetch stub.
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
import { INBOX_MAX_ATTEMPTS, runInbox } from '@/server/pg/inbox';
import { OUTBOX_MAX_ATTEMPTS, runOutbox } from '@/server/pg/outbox';
import { handleOrderRelease } from '@/server/pg/fulfillment';
import { importStatementCsv } from '@/server/pg/bank-ingest';
import { allocateBankCredit, recordObservation } from '@/server/pg/reconcile-engine';
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
  PLATFORM_SECRET,
  type GatewayStatus,
  type Tenant,
} from './h-support';

const gw = new Map<string, GatewayStatus>();
let A: Tenant;

beforeAll(async () => {
  A = await makeTenant();
});
beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', vi.fn(gatewayFetch(gw)));
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma.$disconnect();
});

const utrOf = () => `U${uid().toUpperCase()}`;
const past = (ms = 1000) => new Date(Date.now() - ms);

async function session(amount = 25000, createdAt?: Date) {
  const order = await makePendingOrder(A, amount, createdAt);
  const s = await makeSession(A, order.id, amount, { createdAt });
  return { order, ...s, amount };
}

/** Observed + allocated: Payment CAPTURED and ORDER_RELEASE PENDING in the outbox. */
async function captured() {
  const s = await session();
  const utr = utrOf();
  await recordObservation({ attemptId: s.attempt.id, source: 'GATEWAY_WEBHOOK', utr, amountPaise: s.amount, authenticated: true, dedupeKey: `h:${uid()}` });
  await importStatementCsv({ receivingAccountId: A.account.id, fileName: 'c.csv', content: statementCsv([{ ref: utr, creditPaise: s.amount }]), mapping: MAPPING, uploadedById: A.ownerId });
  const ob = await prisma.pgOutbox.findUniqueOrThrow({ where: { dedupeKey: `ORDER_RELEASE:${s.order.id}` } });
  expect(ob.status).toBe('PENDING');
  return { ...s, utr, outboxId: ob.id };
}

describe('H faults: crash recovery', () => {
  it('worker killed after allocation commit, before the outbox ran: lease expires -> released exactly once', async () => {
    const s = await captured();
    // A worker claimed the row and died: lease held but not expired -> nobody steals it.
    await prisma.pgOutbox.update({ where: { id: s.outboxId }, data: { leaseOwner: 'dead-worker', leaseExpiresAt: new Date(Date.now() + 60_000), attempts: 1 } });
    await runOutbox();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: s.order.id } })).status).toBe('PAYMENT_PENDING');
    // Lease expires.
    await prisma.pgOutbox.update({ where: { id: s.outboxId }, data: { leaseExpiresAt: past() } });
    await runOutbox();
    await runOutbox();
    const snap = await snapshot(s.order.id);
    expect(snap.outbox[0].status).toBe('DONE');
    expect(snap.statusEvents.filter((e) => e.status === 'RECEIVED')).toHaveLength(1);
  });

  it('worker killed after transitionOrder committed but before outbox DONE: retry no-ops, one RECEIVED event', async () => {
    const s = await captured();
    await handleOrderRelease({ orderId: s.order.id, attemptId: s.attempt.id, paymentId: s.payment.id });
    await prisma.pgOutbox.update({ where: { id: s.outboxId }, data: { leaseOwner: 'dead-worker', leaseExpiresAt: past(), attempts: 1 } });
    const r = await runOutbox();
    expect(r.done).toBeGreaterThanOrEqual(1);
    const snap = await snapshot(s.order.id);
    expect(snap.outbox[0].status).toBe('DONE');
    expect(snap.statusEvents.filter((e) => e.status === 'RECEIVED')).toHaveLength(1);
  });

  it('inbox worker killed mid-event: expired lease is reclaimed and processed once', async () => {
    const s = await session();
    const utr = utrOf();
    const signed = signV2({ event: 'SUCCESS', paymentId: s.gatewayPaymentId, orderId: s.attemptKey, utr, amountPaise: s.amount }, A.secret);
    const pid = `youpi:${signed.headers['x-gateway-delivery-id']}`;
    // Store exactly as the route does, but as if a worker claimed it and crashed.
    await prisma.paymentWebhookEvent.create({
      data: {
        provider: 'youpi', eventType: 'SUCCESS', paymentId: s.gatewayPaymentId, orderId: s.attemptKey, providerEventId: pid,
        signature: 'v2', rawPayload: JSON.parse(signed.raw), restaurantId: A.restaurantId,
        leaseOwner: 'dead-inbox', leaseExpiresAt: past(), attempts: 1, nextAttemptAt: past(),
      },
    });
    await runInbox();
    const ev = await prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { providerEventId: pid } });
    expect(ev).toMatchObject({ processed: true, attempts: 2, leaseOwner: null });
    expect((await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: s.attempt.id } })).observedUtr).toBe(utr);
    expect(await prisma.pgPaymentEvidence.count({ where: { attemptId: s.attempt.id, source: 'GATEWAY_WEBHOOK' } })).toBe(1);
  });

  it('outbox handler keeps throwing -> backoff, then DEAD + OUTBOX_DEAD_LETTER exception; order never released', async () => {
    await runOutbox(); // drain unrelated due rows
    const s = await captured();
    const boom = { ORDER_RELEASE: async () => { throw new Error('kitchen service unavailable'); } };
    const r1 = await runOutbox({ handlers: boom });
    expect(r1.retried).toBeGreaterThanOrEqual(1);
    const after1 = await prisma.pgOutbox.findUniqueOrThrow({ where: { id: s.outboxId } });
    expect(after1.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 15_000); // >= 30s * 0.8 backoff
    expect(after1.lastError).toMatch(/kitchen service unavailable/);
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS + 2; i++) {
      await prisma.pgOutbox.updateMany({ where: { id: s.outboxId, status: 'PENDING' }, data: { nextAttemptAt: past() } });
      await runOutbox({ handlers: boom });
    }
    const dead = await prisma.pgOutbox.findUniqueOrThrow({ where: { id: s.outboxId } });
    expect(dead.status).toBe('DEAD');
    expect(dead.attempts).toBe(OUTBOX_MAX_ATTEMPTS);
    expect(await prisma.pgReconException.count({ where: { dedupeKey: `OUTBOX_DEAD_LETTER:${s.outboxId}` } })).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: s.order.id } })).status).toBe('PAYMENT_PENDING');
  });

  it('signed webhook for an unknown payment retries with backoff and dead-letters with WEBHOOK_DEAD_LETTER', async () => {
    const signed = signV2({ event: 'SUCCESS', paymentId: `gp_unknown_${uid()}`, orderId: `ord_unknown_${uid()}`, utr: utrOf() }, PLATFORM_SECRET);
    const pid = `youpi:${signed.headers['x-gateway-delivery-id']}`;
    expect((await postWebhook(signed)).status).toBe(200);
    await settleInbox(pid);
    for (let i = 0; i < INBOX_MAX_ATTEMPTS + 2; i++) {
      await prisma.paymentWebhookEvent.updateMany({ where: { providerEventId: pid, deadLetteredAt: null }, data: { nextAttemptAt: past() } });
      await runInbox();
    }
    const ev = await prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { providerEventId: pid } });
    expect(ev.processed).toBe(false);
    expect(ev.deadLetteredAt).not.toBeNull();
    expect(await prisma.pgReconException.count({ where: { dedupeKey: `WEBHOOK_DEAD_LETTER:${ev.id}` } })).toBe(1);
  });
});

describe('H faults: database unavailable during webhook', () => {
  it('insert fails -> 503 (gateway retries), never 200', async () => {
    const s = await session();
    vi.spyOn(prisma.paymentWebhookEvent, 'create').mockRejectedValueOnce(new Error("Can't reach database server at localhost:55432"));
    const signed = signV2({ event: 'SUCCESS', paymentId: s.gatewayPaymentId, orderId: s.attemptKey, utr: utrOf() }, A.secret);
    expect((await postWebhook(signed)).status).toBe(503);
    vi.restoreAllMocks();
    // The retry after recovery is accepted and stored once.
    expect((await postWebhook(signed)).status).toBe(200);
    await settleInbox(`youpi:${signed.headers['x-gateway-delivery-id']}`);
    expect(await prisma.paymentWebhookEvent.count({ where: { providerEventId: `youpi:${signed.headers['x-gateway-delivery-id']}` } })).toBe(1);
  });

  it('secret lookup fails -> 503', async () => {
    const s = await session();
    vi.spyOn(prisma.pgPaymentAttempt, 'findFirst').mockRejectedValueOnce(new Error('Connection terminated unexpectedly'));
    const signed = signV2({ event: 'SUCCESS', paymentId: s.gatewayPaymentId, orderId: s.attemptKey }, A.secret);
    expect((await postWebhook(signed)).status).toBe(503);
  });

  it('stale-retry lookup fails -> 503, not 400', async () => {
    const s = await session();
    const signed = signV2({ event: 'SUCCESS', paymentId: s.gatewayPaymentId, orderId: s.attemptKey }, A.secret, {
      tsSec: Math.floor(Date.now() / 1000) - 900,
    });
    vi.spyOn(prisma.paymentWebhookEvent, 'findUnique').mockRejectedValueOnce(new Error("Can't reach database server"));
    expect((await postWebhook(signed)).status).toBe(503);
  });
});

describe('H faults: statement import and allocation failures', () => {
  // DEFECT H-02: importStatementCsv commits PgStatementImport(status PROCESSING, fileSha256) BEFORE
  // ingesting rows. If ingestion dies part-way, re-uploading the same file is answered
  // `duplicateFile: true` and the missing rows can never be imported from that file.
  it('a DB error mid-import does not make the rest of the statement un-importable', async () => {
    const r1 = utrOf();
    const r2 = utrOf();
    const r3 = utrOf();
    const content = statementCsv([{ ref: r1, creditPaise: 1000 }, { ref: r2, creditPaise: 2000 }, { ref: r3, creditPaise: 3000 }]);
    const orig = prisma.$transaction.bind(prisma);
    let n = 0;
    vi.spyOn(prisma, '$transaction').mockImplementation(((arg: any, opts?: any) => {
      if (typeof arg === 'function' && ++n === 2) return Promise.reject(new Error('Connection reset by peer'));
      return orig(arg, opts);
    }) as any);
    await expect(
      importStatementCsv({ receivingAccountId: A.account.id, fileName: 's.csv', content, mapping: MAPPING, uploadedById: A.ownerId }),
    ).rejects.toThrow(/Connection reset/);
    vi.restoreAllMocks();

    const retry = await importStatementCsv({ receivingAccountId: A.account.id, fileName: 's.csv', content, mapping: MAPPING, uploadedById: A.ownerId });
    const refs = await prisma.pgBankTransaction.findMany({ where: { receivingAccountId: A.account.id, bankReference: { in: [r1, r2, r3] } } });
    expect({ retryDuplicate: retry.duplicateFile, imported: refs.length }).toEqual({ retryDuplicate: false, imported: 3 });
  });

  // DEFECT H-02b: importStatementCsv offers new credits to the engine in a plain loop after the
  // rows are committed (bank-ingest.ts:129-131). Any throw from one allocation (lock wait > maxWait,
  // connection reset, deadlock) aborts the loop: later credits in the same file are never offered,
  // the import row stays PROCESSING, and re-uploading the file is a no-op (duplicateFile).
  it('a transient failure allocating one credit does not strand the other credits of the same file', async () => {
    const s1 = await session(41000);
    const u1 = utrOf();
    await recordObservation({ attemptId: s1.attempt.id, source: 'GATEWAY_WEBHOOK', utr: u1, amountPaise: 41000, authenticated: true, dedupeKey: `h:${uid()}` });
    const s2 = await session(42000);
    const u2 = utrOf();
    await recordObservation({ attemptId: s2.attempt.id, source: 'GATEWAY_WEBHOOK', utr: u2, amountPaise: 42000, authenticated: true, dedupeKey: `h:${uid()}` });
    const content = statementCsv([{ ref: u1, creditPaise: 41000 }, { ref: u2, creditPaise: 42000 }]);

    const orig = prisma.$transaction.bind(prisma);
    let allocCalls = 0;
    vi.spyOn(prisma, '$transaction').mockImplementation(((arg: any, opts?: any) => {
      // allocateBankCredit passes TX_OPTS; ingest row transactions pass none.
      if (typeof arg === 'function' && opts && ++allocCalls === 1) {
        return Promise.reject(new Error('Transaction API error: Unable to start a transaction in the given time.'));
      }
      return orig(arg, opts);
    }) as any);
    let threw = false;
    try {
      await importStatementCsv({ receivingAccountId: A.account.id, fileName: 'mixed.csv', content, mapping: MAPPING, uploadedById: A.ownerId });
    } catch {
      threw = true;
    }
    vi.restoreAllMocks();
    // Operator retries the same file.
    const retry = await importStatementCsv({ receivingAccountId: A.account.id, fileName: 'mixed.csv', content, mapping: MAPPING, uploadedById: A.ownerId });
    const imp = await prisma.pgStatementImport.findUniqueOrThrow({ where: { id: retry.importId } });
    const p2 = await prisma.payment.findUniqueOrThrow({ where: { id: s2.payment.id } });
    expect({ threw, importStatus: imp.status, secondCreditCaptured: p2.status }).toEqual({ threw: false, importStatus: 'COMPLETED', secondCreditCaptured: 'CAPTURED' });
  });

  // DEFECT H-01 (Low on current pg/lead, no known producer of this state after Agent A's merge):
  // allocateBankCredit throws and rolls back WITHOUT recording anything when the attempt is live and
  // the order PAYMENT_PENDING but the Payment row is not PENDING/AUTHORIZED (reconcile-engine.ts:340).
  // The credit stays UNMATCHED with no exception and every retry throws again.
  it('allocation against a live attempt whose Payment is FAILED opens an exception instead of throwing silently', async () => {
    const s = await session(43000);
    await prisma.payment.update({ where: { id: s.payment.id }, data: { status: 'FAILED' } });
    const utr = utrOf();
    await recordObservation({ attemptId: s.attempt.id, source: 'GATEWAY_WEBHOOK', utr, amountPaise: 43000, authenticated: true, dedupeKey: `h:${uid()}` });
    const t = await prisma.pgBankTransaction.create({
      data: { receivingAccountId: A.account.id, direction: 'CREDIT', amountPaise: 43000, bankReference: utr, valueAt: new Date(), source: 'STATEMENT_IMPORT', sourceRowHash: uid() },
    });
    await allocateBankCredit({ attemptId: s.attempt.id, bankTransactionId: t.id }).catch(() => undefined);
    expect(await prisma.pgReconException.count({ where: { bankTransactionId: t.id } })).toBeGreaterThan(0);
  });
});

describe('H faults: liveness gaps', () => {
  // DEFECT H-04: when the bank credit is ingested BEFORE the signed webhook UTR is observed, the
  // inbox only re-tries allocation via reconcileYoupiPayment, which calls tryAllocateForAttempt
  // only if the gateway STATUS says SUCCESS. With the gateway down/lagging, a fully proven
  // payment (signed UTR + exact bank credit, same account, in window) is not captured.
  it('credit first, then signed webhook UTR while the status API is down -> captured from bank evidence', async () => {
    const s = await session(26000);
    const utr = utrOf();
    await importStatementCsv({ receivingAccountId: A.account.id, fileName: 'early.csv', content: statementCsv([{ ref: utr, creditPaise: 26000 }]), mapping: MAPPING, uploadedById: A.ownerId });
    gw.set(s.gatewayPaymentId, 'DOWN');
    const signed = signV2({ event: 'SUCCESS', paymentId: s.gatewayPaymentId, orderId: s.attemptKey, utr, amountPaise: 26000 }, A.secret);
    expect((await postWebhook(signed)).status).toBe(200);
    await settleInbox(`youpi:${signed.headers['x-gateway-delivery-id']}`);
    await runInbox();
    expect((await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: s.attempt.id } })).observedUtr).toBe(utr);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: s.payment.id } })).status).toBe('CAPTURED');
  });

  // DEFECT H-05: the sweep takes the OLDEST 100 PENDING youpi payments of the last 24 h every tick.
  // Legacy rows (no attempt) and observed-awaiting-statement rows stay PENDING all day, so with
  // >=100 of them newer payments are never probed (never closed as FAILED, no MISSING_UTR).
  it('sweep is not starved by 100 older long-pending payments', async () => {
    // Control: with a short backlog the sweep does close an EXPIRED session.
    const control = await session(27001, new Date(Date.now() - 10 * 60_000));
    gw.set(control.gatewayPaymentId, { status: 'EXPIRED' });
    await runYoupiReconcileSweep();
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: control.payment.id } })).status).toBe('FAILED');

    const twoHours = new Date(Date.now() - 2 * 3_600_000);
    const holder = await makePendingOrder(A, 100, twoHours);
    await prisma.payment.createMany({
      data: Array.from({ length: 100 }, () => ({
        orderId: holder.id, method: 'RAZORPAY' as const, amount: '1.00', providerName: 'youpi', providerRef: `legacy_${uid()}`, createdAt: twoHours,
      })),
    });
    const s = await session(27000, new Date(Date.now() - 10 * 60_000));
    gw.set(s.gatewayPaymentId, { status: 'EXPIRED' });
    await runYoupiReconcileSweep();
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: s.payment.id } })).status).toBe('FAILED');
  });
});
