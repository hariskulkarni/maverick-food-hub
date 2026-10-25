/**
 * Money-critical invariants proven against real Postgres (npm run test:db).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma, makeAccount, makeAttempt, makeCredit, uid } from './fixtures';
import {
  allocateBankCredit,
  approveManualAllocation,
  proposeManualAllocation,
  recordObservation,
  recordReversal,
  tryAllocateBankTxn,
  tryAllocateForAttempt,
} from '@/server/pg/reconcile-engine';
import {
  approveManualBankTransaction,
  enterManualBankTransaction,
  importStatementCsv,
} from '@/server/pg/bank-ingest';
import { openException, resolveException } from '@/server/pg/exceptions';
import type { StatementColumnMapping } from '@/server/pg/bank-source';

afterAll(async () => {
  await prisma.$disconnect();
});

const outboxFor = (orderId: string) => prisma.pgOutbox.findMany({ where: { aggregateId: orderId, topic: 'ORDER_RELEASE' } });

/** Today's calendar date in IST (YYYY-MM-DD). The UTC date is a day behind after 18:30 UTC, which put the
 *  statement row (23:59:59 IST of that date) before the attempt and outside the match window. */
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

describe('allocateBankCredit (real DB)', () => {
  it('20 concurrent allocations of one credit -> exactly 1 allocation, 1 capture, 1 release', async () => {
    const acc = await makeAccount();
    const { attempt, orderId, payment } = await makeAttempt(acc);
    const credit = await makeCredit(acc, { amountPaise: 25000, reference: attempt.observedUtr! });

    const results = await Promise.all(
      Array.from({ length: 20 }, () => allocateBankCredit({ attemptId: attempt.id, bankTransactionId: credit.id })),
    );
    const outcomes = results.map((r) => r.outcome);
    expect(outcomes.filter((o) => o === 'CAPTURED')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'ALREADY_ALLOCATED')).toHaveLength(19);

    expect(await prisma.pgAllocation.count({ where: { bankTransactionId: credit.id } })).toBe(1);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('CAPTURED');
    expect((await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).state).toBe('CAPTURED');
    expect((await prisma.pgBankTransaction.findUniqueOrThrow({ where: { id: credit.id } })).status).toBe('ALLOCATED');
    expect(await outboxFor(orderId)).toHaveLength(1);
    expect(await prisma.pgFinancialEvent.count({ where: { orderId, kind: 'PAYMENT_CAPTURED' } })).toBe(1);
  });

  it('two credits for one order (two attempts) -> 1 ORDER_PAYMENT + 1 OVERCOLLECTION + exception, 1 release', async () => {
    const acc = await makeAccount();
    const first = await makeAttempt(acc);
    const second = await makeAttempt(acc, { orderId: first.orderId });
    const c1 = await makeCredit(acc, { amountPaise: 25000, reference: first.attempt.observedUtr! });
    const c2 = await makeCredit(acc, { amountPaise: 25000, reference: second.attempt.observedUtr! });

    expect((await tryAllocateBankTxn(c1.id)).outcome).toBe('CAPTURED');
    const r2 = await tryAllocateBankTxn(c2.id);
    expect(r2.outcome).toBe('OVERCOLLECTION');

    const allocs = await prisma.pgAllocation.findMany({ where: { orderId: first.orderId }, orderBy: { createdAt: 'asc' } });
    expect(allocs.map((a) => a.kind)).toEqual(['ORDER_PAYMENT', 'OVERCOLLECTION']);
    const ex = await prisma.pgReconException.findMany({ where: { orderId: first.orderId, kind: 'OVERCOLLECTION' } });
    expect(ex).toHaveLength(1);
    expect(ex[0].status).toBe('OPEN');
    expect(await outboxFor(first.orderId)).toHaveLength(1);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: second.payment.id } })).status).toBe('PENDING');
  });

  it('DB itself rejects a second live ORDER_PAYMENT allocation for one order (partial unique index)', async () => {
    const acc = await makeAccount();
    const a1 = await makeAttempt(acc);
    const a2 = await makeAttempt(acc, { orderId: a1.orderId });
    const c1 = await makeCredit(acc, { amountPaise: 25000, reference: `R${uid().toUpperCase()}` });
    const c2 = await makeCredit(acc, { amountPaise: 25000, reference: `R${uid().toUpperCase()}` });
    await prisma.pgAllocation.create({
      data: { bankTransactionId: c1.id, attemptId: a1.attempt.id, orderId: a1.orderId, kind: 'ORDER_PAYMENT', amountPaise: 25000 },
    });
    await expect(
      prisma.pgAllocation.create({
        data: { bankTransactionId: c2.id, attemptId: a2.attempt.id, orderId: a1.orderId, kind: 'ORDER_PAYMENT', amountPaise: 25000 },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('amount off by 1 paisa -> no allocation, AMOUNT_MISMATCH exception', async () => {
    const acc = await makeAccount();
    const { attempt, payment } = await makeAttempt(acc, { amountPaise: 25000 });
    const credit = await makeCredit(acc, { amountPaise: 24999, reference: attempt.observedUtr! });
    const r = await tryAllocateForAttempt(attempt.id);
    expect(r.outcome).toBe('REJECTED');
    expect(await prisma.pgAllocation.count({ where: { bankTransactionId: credit.id } })).toBe(0);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PENDING');
    expect(await prisma.pgReconException.count({ where: { attemptId: attempt.id, kind: 'AMOUNT_MISMATCH' } })).toBe(1);
    expect((await prisma.pgBankTransaction.findUniqueOrThrow({ where: { id: credit.id } })).status).toBe('UNMATCHED');
  });

  it('same UTR on another receiving account -> no allocation; both rows coexist', async () => {
    const accA = await makeAccount();
    const accB = await makeAccount();
    const { attempt, payment } = await makeAttempt(accA);
    const onB = await makeCredit(accB, { amountPaise: 25000, reference: attempt.observedUtr! });
    expect((await tryAllocateForAttempt(attempt.id)).outcome).toBe('NO_CANDIDATE');
    const direct = await allocateBankCredit({ attemptId: attempt.id, bankTransactionId: onB.id });
    expect(direct).toMatchObject({ outcome: 'REJECTED', reason: 'different receiving account' });
    const onA = await makeCredit(accA, { amountPaise: 25000, reference: attempt.observedUtr! });
    expect(await prisma.pgBankTransaction.count({ where: { bankReference: attempt.observedUtr! } })).toBe(2);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PENDING');
    expect((await tryAllocateBankTxn(onA.id)).outcome).toBe('CAPTURED');
  });

  it('no UTR observed -> MISSING_UTR exception, no allocation', async () => {
    const acc = await makeAccount();
    const { attempt } = await makeAttempt(acc, { observedUtr: null });
    const r = await tryAllocateForAttempt(attempt.id);
    expect(r.outcome).toBe('NO_UTR');
    expect(await prisma.pgReconException.count({ where: { attemptId: attempt.id, kind: 'MISSING_UTR' } })).toBe(1);
    await tryAllocateForAttempt(attempt.id);
    expect(await prisma.pgReconException.count({ where: { attemptId: attempt.id, kind: 'MISSING_UTR' } })).toBe(1);
  });

  it('credit outside the time window is not auto-allocated', async () => {
    const acc = await makeAccount();
    const { attempt } = await makeAttempt(acc, { createdAt: new Date(Date.now() - 72 * 3_600_000) });
    const credit = await makeCredit(acc, { amountPaise: 25000, reference: attempt.observedUtr! });
    const r = await tryAllocateBankTxn(credit.id);
    expect(r).toMatchObject({ outcome: 'REJECTED', reason: 'credit outside the match time window' });
    expect(await prisma.pgAllocation.count({ where: { bankTransactionId: credit.id } })).toBe(0);
  });

  it('two attempts observed the same UTR -> AMBIGUOUS exception, no allocation', async () => {
    const acc = await makeAccount();
    const utr = `UTR${uid().toUpperCase()}`;
    await makeAttempt(acc, { observedUtr: utr });
    await makeAttempt(acc, { observedUtr: utr });
    const credit = await makeCredit(acc, { amountPaise: 25000, reference: utr });
    expect((await tryAllocateBankTxn(credit.id)).outcome).toBe('AMBIGUOUS');
    expect(await prisma.pgAllocation.count({ where: { bankTransactionId: credit.id } })).toBe(0);
    expect(await prisma.pgReconException.count({ where: { bankTransactionId: credit.id, kind: 'AMBIGUOUS_MATCH' } })).toBe(1);
  });

  it('late payment after order cancellation -> LATE_PAYMENT allocation + exception, no release, no capture', async () => {
    const acc = await makeAccount();
    const { attempt, orderId, payment } = await makeAttempt(acc);
    await prisma.order.update({ where: { id: orderId }, data: { status: 'CANCELLED_BY_CUSTOMER' } });
    const credit = await makeCredit(acc, { amountPaise: 25000, reference: attempt.observedUtr! });
    const r = await tryAllocateBankTxn(credit.id);
    expect(r.outcome).toBe('LATE_PAYMENT');
    expect((await prisma.pgAllocation.findUniqueOrThrow({ where: { bankTransactionId: credit.id } })).kind).toBe('LATE_PAYMENT');
    expect(await prisma.pgReconException.count({ where: { orderId, kind: 'LATE_PAYMENT' } })).toBe(1);
    expect(await outboxFor(orderId)).toHaveLength(0);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PENDING');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('CANCELLED_BY_CUSTOMER');
  });

  it('late payment on an EXPIRED attempt -> LATE_PAYMENT, no release', async () => {
    const acc = await makeAccount();
    const { attempt, orderId } = await makeAttempt(acc, { state: 'EXPIRED' });
    const credit = await makeCredit(acc, { amountPaise: 25000, reference: attempt.observedUtr! });
    expect((await tryAllocateBankTxn(credit.id)).outcome).toBe('LATE_PAYMENT');
    expect(await outboxFor(orderId)).toHaveLength(0);
  });

  it('manual allocation needs a second, different approver', async () => {
    const acc = await makeAccount();
    const { attempt, payment } = await makeAttempt(acc, { observedUtr: null });
    const credit = await makeCredit(acc, { amountPaise: 25000, reference: `R${uid().toUpperCase()}` });
    const { proposalId } = await proposeManualAllocation({
      attemptId: attempt.id,
      bankTransactionId: credit.id,
      operatorId: 'op-1',
      reason: 'customer shared bank SMS; reference verified on statement',
    });
    await expect(approveManualAllocation({ proposalId, approverId: 'op-1' })).rejects.toThrow(/second approver/);
    expect(await prisma.pgAllocation.count({ where: { bankTransactionId: credit.id } })).toBe(0);
    const r = await approveManualAllocation({ proposalId, approverId: 'fin-2' });
    expect(r.outcome).toBe('CAPTURED');
    const alloc = await prisma.pgAllocation.findUniqueOrThrow({ where: { bankTransactionId: credit.id } });
    expect(alloc).toMatchObject({ createdById: 'op-1', approvedById: 'fin-2', kind: 'ORDER_PAYMENT' });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('CAPTURED');
  });

  it('reversal marks allocation reversed + txn REVERSED + REVERSAL exception, order untouched', async () => {
    const acc = await makeAccount();
    const { attempt, orderId } = await makeAttempt(acc);
    const credit = await makeCredit(acc, { amountPaise: 25000, reference: attempt.observedUtr! });
    await tryAllocateBankTxn(credit.id);
    const before = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const r = await recordReversal({ bankTransactionId: credit.id, reason: 'bank chargeback', actorId: 'fin-1' });
    expect(r.reversed).toBe(true);
    expect((await prisma.pgAllocation.findUniqueOrThrow({ where: { bankTransactionId: credit.id } })).reversedAt).not.toBeNull();
    expect((await prisma.pgBankTransaction.findUniqueOrThrow({ where: { id: credit.id } })).status).toBe('REVERSED');
    expect(await prisma.pgReconException.count({ where: { bankTransactionId: credit.id, kind: 'REVERSAL' } })).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(before.status);
    expect((await recordReversal({ bankTransactionId: credit.id, reason: 'again', actorId: 'fin-1' })).reversed).toBe(false);
  });
});

describe('recordObservation (real DB)', () => {
  it('authenticated SUCCESS -> OBSERVED + UTR, never CAPTURED; duplicate dedupeKey is a no-op', async () => {
    const acc = await makeAccount();
    const { attempt, payment } = await makeAttempt(acc, { state: 'AWAITING_PAYMENT', observedUtr: null });
    const dedupeKey = `wh-${uid()}`;
    const r = await recordObservation({
      attemptId: attempt.id,
      source: 'GATEWAY_WEBHOOK',
      utr: ' utr 77 ',
      amountPaise: 25000,
      authenticated: true,
      eventAt: new Date(),
      dedupeKey,
    });
    expect(r).toMatchObject({ state: 'OBSERVED', observedUtr: 'UTR77', duplicate: false });
    const again = await recordObservation({ attemptId: attempt.id, source: 'GATEWAY_WEBHOOK', utr: 'UTR77', amountPaise: 25000, authenticated: true, dedupeKey });
    expect(again.duplicate).toBe(true);
    expect(await prisma.pgPaymentEvidence.count({ where: { attemptId: attempt.id } })).toBe(1);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PENDING');
  });

  it('unauthenticated evidence is stored but does not change state', async () => {
    const acc = await makeAccount();
    const { attempt } = await makeAttempt(acc, { state: 'AWAITING_PAYMENT', observedUtr: null });
    const r = await recordObservation({ attemptId: attempt.id, source: 'OBSERVER', utr: 'X1', authenticated: false, dedupeKey: `o-${uid()}` });
    expect(r).toMatchObject({ state: 'AWAITING_PAYMENT', observedUtr: null });
  });

  it('observed amount mismatch -> exception, state unchanged', async () => {
    const acc = await makeAccount();
    const { attempt } = await makeAttempt(acc, { state: 'AWAITING_PAYMENT', observedUtr: null });
    const r = await recordObservation({ attemptId: attempt.id, source: 'GATEWAY_WEBHOOK', utr: 'U1', amountPaise: 25001, authenticated: true, dedupeKey: `w-${uid()}` });
    expect(r.state).toBe('AWAITING_PAYMENT');
    expect(await prisma.pgReconException.count({ where: { attemptId: attempt.id, kind: 'AMOUNT_MISMATCH' } })).toBe(1);
  });
});

describe('bank ingest (real DB)', () => {
  const mapping: StatementColumnMapping = {
    date: 'Date',
    narration: 'Narration',
    reference: 'Reference',
    credit: 'Credit',
    debit: 'Debit',
    dateFormat: 'YYYY-MM-DD',
  };

  it('duplicate CSV import is idempotent (file sha + row identity) and auto-allocates once', async () => {
    const acc = await makeAccount();
    const { attempt, orderId } = await makeAttempt(acc);
    const today = istToday(); // statement dates are IST days pinned to 23:59:59 IST, never before the attempt
    const csv = `Date,Narration,Reference,Debit,Credit\n${today},UPI from 9876543210,${attempt.observedUtr},,250.00\n${today},other,REF${uid()},,99.00\n`;
    const first = await importStatementCsv({ receivingAccountId: acc.account.id, fileName: 's.csv', content: csv, mapping, uploadedById: 'fin-1' });
    expect(first).toMatchObject({ duplicateFile: false, insertedCount: 2, rejected: [] });
    const again = await importStatementCsv({ receivingAccountId: acc.account.id, fileName: 's.csv', content: csv, mapping, uploadedById: 'fin-1' });
    expect(again).toMatchObject({ duplicateFile: true, importId: first.importId, insertedCount: 0 });
    // Same rows in a different file (extra blank line) -> rows deduped by account+direction+reference.
    const third = await importStatementCsv({ receivingAccountId: acc.account.id, fileName: 's2.csv', content: `${csv}\n`, mapping, uploadedById: 'fin-1' });
    expect(third).toMatchObject({ duplicateFile: false, insertedCount: 0, duplicateCount: 2 });

    expect(await prisma.pgBankTransaction.count({ where: { receivingAccountId: acc.account.id } })).toBe(2);
    expect(await prisma.pgFinancialEvent.count({ where: { kind: 'BANK_TXN_INGESTED', restaurantId: acc.restaurant.id } })).toBe(2);
    expect(await outboxFor(orderId)).toHaveLength(1);
    const narr = (await prisma.pgBankTransaction.findFirstOrThrow({ where: { bankReference: attempt.observedUtr! } })).narrationRedacted;
    expect(narr).not.toContain('9876543210');
  });

  it('same reference with different amount -> not overwritten, DUPLICATE_CREDIT exception', async () => {
    const acc = await makeAccount();
    const ref = `REF${uid().toUpperCase()}`;
    const today = istToday(); // statement dates are IST days pinned to 23:59:59 IST, never before the attempt
    await importStatementCsv({ receivingAccountId: acc.account.id, fileName: 'a.csv', content: `Date,Narration,Reference,Debit,Credit\n${today},x,${ref},,10.00\n`, mapping, uploadedById: 'fin-1' });
    const r = await importStatementCsv({ receivingAccountId: acc.account.id, fileName: 'b.csv', content: `Date,Narration,Reference,Debit,Credit\n${today},x,${ref},,11.00\n`, mapping, uploadedById: 'fin-1' });
    expect(r.conflictCount).toBe(1);
    expect((await prisma.pgBankTransaction.findFirstOrThrow({ where: { bankReference: ref } })).amountPaise).toBe(1000);
    expect(await prisma.pgReconException.count({ where: { receivingAccountId: acc.account.id, kind: 'DUPLICATE_CREDIT' } })).toBe(1);
  });

  it('manual entry: PENDING_APPROVAL, self-approval rejected, other user approves -> allocates', async () => {
    const acc = await makeAccount();
    const { attempt, payment } = await makeAttempt(acc);
    const m = await enterManualBankTransaction({
      receivingAccountId: acc.account.id,
      direction: 'CREDIT',
      amountPaise: 25000,
      bankReference: attempt.observedUtr!.toLowerCase(),
      valueAt: new Date(),
      enteredById: 'op-1',
    });
    expect((await prisma.pgBankTransaction.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('PENDING_APPROVAL');
    // Not allocatable while pending approval.
    expect((await tryAllocateForAttempt(attempt.id)).outcome).not.toBe('CAPTURED');
    await expect(approveManualBankTransaction(m.id, 'op-1')).rejects.toThrow(/different user/);
    expect((await prisma.pgBankTransaction.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('PENDING_APPROVAL');
    await approveManualBankTransaction(m.id, 'fin-2');
    expect((await prisma.pgBankTransaction.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('ALLOCATED');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('CAPTURED');
  });
});

describe('DB-level guards', () => {
  it('PgFinancialEvent UPDATE and DELETE are rejected by trigger', async () => {
    const ev = await prisma.pgFinancialEvent.create({ data: { kind: 'TEST' } });
    await expect(prisma.pgFinancialEvent.update({ where: { id: ev.id }, data: { kind: 'HACK' } })).rejects.toThrow(/append-only/);
    await expect(prisma.pgFinancialEvent.delete({ where: { id: ev.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRaw`UPDATE "PgFinancialEvent" SET kind = 'HACK' WHERE id = ${ev.id}`).rejects.toThrow(/append-only/);
    expect((await prisma.pgFinancialEvent.findUniqueOrThrow({ where: { id: ev.id } })).kind).toBe('TEST');
  });

  it('CHECK constraints reject non-positive amounts and unnormalized references', async () => {
    const acc = await makeAccount();
    await expect(makeCredit(acc, { amountPaise: 0, reference: `R${uid().toUpperCase()}` })).rejects.toBeInstanceOf(Prisma.PrismaClientUnknownRequestError);
    await expect(makeCredit(acc, { amountPaise: 100, reference: 'lower case' })).rejects.toThrow(/bankReference_normalized/);
  });

  it('only one VERIFIED account per gateway merchant id and per restaurant', async () => {
    const acc = await makeAccount();
    const base = {
      vpa: `x${uid()}@bank`,
      accountFingerprint: uid(),
      legalEntityName: 'X',
      status: 'VERIFIED' as const,
    };
    await expect(
      prisma.pgReceivingAccount.create({
        data: { ...base, restaurantId: `other-${uid()}`, gatewayMerchantId: acc.account.gatewayMerchantId, vpaNormalized: base.vpa },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      prisma.pgReceivingAccount.create({
        data: { ...base, restaurantId: acc.restaurant.id, gatewayMerchantId: `m-${uid()}`, vpaNormalized: base.vpa },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('openException is idempotent; resolveException requires actor and records it', async () => {
    const key = `T:${uid()}`;
    const a = await openException(prisma, { kind: 'STALE_PENDING', dedupeKey: key });
    const b = await openException(prisma, { kind: 'STALE_PENDING', dedupeKey: key });
    expect(b).toEqual({ id: a.id, created: false });
    await expect(resolveException({ exceptionId: a.id, actorId: '', resolution: 'x' })).rejects.toThrow(/actorId/);
    await resolveException({ exceptionId: a.id, actorId: 'fin-1', resolution: 'checked statement' });
    expect(await prisma.pgReconException.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({
      status: 'RESOLVED',
      resolvedById: 'fin-1',
    });
  });
});
