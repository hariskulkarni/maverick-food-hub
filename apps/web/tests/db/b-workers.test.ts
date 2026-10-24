/**
 * Agent B real-Postgres tests: inbox/outbox lease claims, crash recovery,
 * dead-lettering and PgJobLease exclusivity. Only the payment lookup and the
 * gateway reconcile are stubbed; every claim/finish/exception write is real SQL.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const h = vi.hoisted(() => ({ reconcile: vi.fn() }));
vi.mock('@/server/payments/youpi-reconcile', () => ({ reconcileYoupiPayment: h.reconcile }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { prisma } from '@/server/db';
import { INBOX_MAX_ATTEMPTS, inboxMetrics, runInbox } from '@/server/pg/inbox';
import { OUTBOX_MAX_ATTEMPTS, enqueueOutbox, outboxMetrics, runOutbox } from '@/server/pg/outbox';
import { acquireJobLease, renewJobLease, withJobLease } from '@/server/pg/job-lease';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function seedEvents(n: number, prefix = 'e') {
  await prisma.paymentWebhookEvent.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      provider: 'youpi',
      eventType: 'SUCCESS',
      paymentId: `yp_${prefix}${i}`,
      orderId: `ord-${prefix}${i}`,
      providerEventId: `youpi:${prefix}${i}`,
      rawPayload: { event: 'SUCCESS', paymentId: `yp_${prefix}${i}`, orderId: `ord-${prefix}${i}`, utr: `U${i}`, amountPaise: 100 },
      nextAttemptAt: new Date(Date.now() - 1000),
    })),
  });
}

beforeEach(async () => {
  vi.restoreAllMocks();
  h.reconcile.mockReset();
  await prisma.paymentWebhookEvent.deleteMany({});
  await prisma.pgOutbox.deleteMany({});
  await prisma.pgReconException.deleteMany({});
  await prisma.pgJobLease.deleteMany({});
  // Payment lookup stub: gateway payment id `yp_x` -> local payment `pay_yp_x`.
  vi.spyOn(prisma.payment, 'findFirst').mockImplementation((async (args: any) => {
    const ref = args?.where?.providerRef;
    return typeof ref === 'string' && ref.startsWith('yp_') && !ref.includes('unmatched') ? { id: `pay_${ref}`, providerRef: ref } : null;
  }) as any);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('inbox (PaymentWebhookEvent leases)', () => {
  it('three concurrent workers: every row reconciled exactly once', async () => {
    await seedEvents(60);
    h.reconcile.mockImplementation(async (paymentId: string) => {
      await sleep(3);
      return { status: 'PENDING', captured: false, paymentId, orderId: 'o' };
    });
    const results = await Promise.all([runInbox({ batch: 7 }), runInbox({ batch: 7 }), runInbox({ batch: 7 })]);
    const ids = h.reconcile.mock.calls.map((c) => c[0]);
    expect(ids).toHaveLength(60);
    expect(new Set(ids).size).toBe(60);
    expect(results.reduce((a, r) => a + r.processed, 0)).toBe(60);
    const rows = await prisma.paymentWebhookEvent.findMany();
    expect(rows.every((r) => r.processed && r.attempts === 1 && r.leaseOwner === null)).toBe(true);
    expect(results.filter((r) => r.claimed > 0).length).toBeGreaterThan(1); // really concurrent
  });

  it('crash = lease expiry: a row leased by a dead worker is reclaimed only after expiry', async () => {
    await seedEvents(1, 'crash');
    await prisma.$executeRaw`UPDATE "PaymentWebhookEvent" SET "leaseOwner" = 'dead-worker',
      "leaseExpiresAt" = timezone('utc', now()) + interval '400 milliseconds', "attempts" = 1`;
    h.reconcile.mockResolvedValue({ status: 'PENDING', captured: false });
    expect((await runInbox()).claimed).toBe(0);
    await sleep(600);
    const r = await runInbox();
    expect(r).toMatchObject({ claimed: 1, processed: 1 });
    const row = await prisma.paymentWebhookEvent.findFirstOrThrow();
    expect(row).toMatchObject({ processed: true, attempts: 2, leaseOwner: null });
    // The dead worker's late finish is fenced out.
    const late = await prisma.paymentWebhookEvent.updateMany({ where: { id: row.id, leaseOwner: 'dead-worker' }, data: { error: 'late' } });
    expect(late.count).toBe(0);
  });

  it('transient failure: backoff schedules a future retry and is not hot-looped', async () => {
    await seedEvents(1, 'flaky');
    h.reconcile.mockResolvedValue({ status: 'PENDING', captured: false, indeterminate: true });
    const r1 = await runInbox();
    expect(r1).toMatchObject({ claimed: 1, retried: 1, processed: 0 });
    const row = await prisma.paymentWebhookEvent.findFirstOrThrow();
    expect(row.processed).toBe(false);
    expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 20_000);
    expect(row.error).toMatch(/indeterminate/);
    expect((await runInbox()).claimed).toBe(0);
  });

  it('poison event: dead-lettered after the attempt budget with one WEBHOOK_DEAD_LETTER exception', async () => {
    await seedEvents(1, 'poison');
    await prisma.paymentWebhookEvent.updateMany({ data: { attempts: INBOX_MAX_ATTEMPTS - 1 } });
    h.reconcile.mockRejectedValue(new Error('boom'));
    const r = await runInbox();
    expect(r).toMatchObject({ claimed: 1, deadLettered: 1 });
    const row = await prisma.paymentWebhookEvent.findFirstOrThrow();
    expect(row.deadLetteredAt).not.toBeNull();
    expect(row.processed).toBe(false);
    const ex = await prisma.pgReconException.findMany();
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ kind: 'WEBHOOK_DEAD_LETTER', dedupeKey: `WEBHOOK_DEAD_LETTER:${row.id}`, status: 'OPEN' });
    expect((await runInbox()).claimed).toBe(0);
    expect((await inboxMetrics()).deadLettered).toBe(1);
  });

  it('crash-looping poison (budget exhausted while leased) is dead-lettered without being run again', async () => {
    await seedEvents(1, 'loop');
    await prisma.$executeRaw`UPDATE "PaymentWebhookEvent" SET "attempts" = ${INBOX_MAX_ATTEMPTS},
      "leaseOwner" = 'dead', "leaseExpiresAt" = timezone('utc', now()) - interval '1 second'`;
    const r = await runInbox();
    expect(r).toMatchObject({ claimed: 1, deadLettered: 1 });
    expect(h.reconcile).not.toHaveBeenCalled();
  });

  it('unmatched payment is retried (not silently marked processed); other providers are never touched', async () => {
    await prisma.paymentWebhookEvent.create({
      data: { provider: 'youpi', eventType: 'SUCCESS', paymentId: 'yp_unmatched', orderId: 'ord-x', providerEventId: 'youpi:u1', rawPayload: {}, nextAttemptAt: new Date(Date.now() - 1000) },
    });
    await prisma.paymentWebhookEvent.create({
      data: { provider: 'phonepe', eventType: 'x', providerEventId: 'phonepe:1', rawPayload: {} },
    });
    const r = await runInbox();
    expect(r).toMatchObject({ claimed: 1, retried: 1 });
    const pp = await prisma.paymentWebhookEvent.findUniqueOrThrow({ where: { providerEventId: 'phonepe:1' } });
    expect(pp).toMatchObject({ attempts: 0, leaseOwner: null, processed: false });
    const m = await inboxMetrics();
    expect(m.pending).toBe(1);
    expect(m.retrying).toBe(1);
  });

  it('legacy unprocessed rows (nextAttemptAt NULL, old error marker) are picked up', async () => {
    await prisma.paymentWebhookEvent.create({
      data: { provider: 'youpi', eventType: 'SUCCESS', paymentId: 'yp_legacy', providerEventId: 'youpi:legacy', rawPayload: {}, error: 'youpi-replay:stale-claim' },
    });
    h.reconcile.mockResolvedValue({ status: 'PENDING', captured: false });
    expect(await runInbox()).toMatchObject({ claimed: 1, processed: 1 });
  });
});

describe('outbox (PgOutbox)', () => {
  it('enqueue is idempotent inside one transaction and does not abort it', async () => {
    const created = await prisma.$transaction(async (tx) => {
      const a = await enqueueOutbox(tx, { topic: 'T', aggregateId: 'o1', dedupeKey: 'T:o1', payload: { n: 1 } });
      const b = await enqueueOutbox(tx, { topic: 'T', aggregateId: 'o1', dedupeKey: 'T:o1', payload: { n: 2 } });
      await tx.pgReconException.create({ data: { kind: 'STALE_PENDING', dedupeKey: 'still-usable' } });
      return [a, b];
    });
    expect(created).toEqual([true, false]);
    expect(await prisma.pgOutbox.count()).toBe(1);
    expect(await prisma.pgReconException.count()).toBe(1);
  });

  it('rolled-back transaction leaves no outbox intent', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await enqueueOutbox(tx, { topic: 'T', aggregateId: 'o2', dedupeKey: 'T:o2', payload: {} });
        throw new Error('state change failed');
      }),
    ).rejects.toThrow();
    expect(await prisma.pgOutbox.count()).toBe(0);
  });

  it('concurrent runners deliver each message exactly once', async () => {
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < 40; i++) await enqueueOutbox(tx, { topic: 'T', aggregateId: `a${i}`, dedupeKey: `T:${i}`, payload: { i } });
    });
    const seen: number[] = [];
    const handlers = { T: async (p: unknown) => { await sleep(2); seen.push((p as { i: number }).i); } };
    const rs = await Promise.all([runOutbox({ handlers, batch: 5 }), runOutbox({ handlers, batch: 5 }), runOutbox({ handlers, batch: 5 })]);
    expect(seen).toHaveLength(40);
    expect(new Set(seen).size).toBe(40);
    expect(rs.reduce((a, r) => a + r.done, 0)).toBe(40);
    expect(await prisma.pgOutbox.count({ where: { status: 'DONE' } })).toBe(40);
  });

  it('unknown topic: retried, then DEAD with one OUTBOX_DEAD_LETTER exception — never dropped', async () => {
    await prisma.$transaction((tx) => enqueueOutbox(tx, { topic: 'NOPE', aggregateId: 'x', dedupeKey: 'NOPE:x', payload: {} }));
    const r1 = await runOutbox({ handlers: {} });
    expect(r1).toMatchObject({ claimed: 1, retried: 1 });
    let row = await prisma.pgOutbox.findFirstOrThrow();
    expect(row).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(row.lastError).toMatch(/No outbox handler/);
    await prisma.pgOutbox.updateMany({ data: { nextAttemptAt: new Date(Date.now() - 1000), attempts: OUTBOX_MAX_ATTEMPTS - 1 } });
    expect(await runOutbox({ handlers: {} })).toMatchObject({ dead: 1 });
    row = await prisma.pgOutbox.findFirstOrThrow();
    expect(row.status).toBe('DEAD');
    const ex = await prisma.pgReconException.findFirstOrThrow();
    expect(ex).toMatchObject({ kind: 'OUTBOX_DEAD_LETTER', dedupeKey: `OUTBOX_DEAD_LETTER:${row.id}` });
    expect(await outboxMetrics()).toMatchObject({ backlog: 0, dead: 1 });
  });
});

describe('PgJobLease', () => {
  it('only one of many concurrent contenders acquires; released lease can be re-taken', async () => {
    let inside = 0;
    let maxInside = 0;
    const body = async () => { inside++; maxInside = Math.max(maxInside, inside); await sleep(50); inside--; return 'ran'; };
    const rs = await Promise.all(Array.from({ length: 6 }, () => withJobLease('job-x', 10_000, body)));
    expect(rs.filter((r) => r.acquired)).toHaveLength(1);
    expect(maxInside).toBe(1);
    expect(await prisma.pgJobLease.count()).toBe(0); // released
    expect((await withJobLease('job-x', 10_000, async () => 1)).acquired).toBe(true);
  });

  it('an expired lease (crashed holder) is taken over; the old holder can no longer renew', async () => {
    expect(await acquireJobLease('job-y', 'crashed', 200)).toBe(true);
    expect(await acquireJobLease('job-y', 'other', 10_000)).toBe(false);
    await sleep(350);
    expect(await acquireJobLease('job-y', 'other', 10_000)).toBe(true);
    expect(await renewJobLease('job-y', 'crashed', 10_000)).toBe(false);
    expect(await renewJobLease('job-y', 'other', 10_000)).toBe(true);
  });

  it('heartbeat keeps a long run exclusive past its ttl', async () => {
    const long = withJobLease('job-z', 1_200, async () => { await sleep(2_000); return 'done'; });
    await sleep(1_500); // past the original ttl
    expect((await withJobLease('job-z', 1_200, async () => 'intruder')).acquired).toBe(false);
    expect(await long).toEqual({ acquired: true, result: 'done' });
  });
});
