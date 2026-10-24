/**
 * Fork gateways ask the payer for order amount + k paise (k in 0..99). The bank credit
 * then equals that signed payable amount, not the order amount.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { PgEvidenceSource } from '@prisma/client';
import { prisma, makeAccount, makeAttempt, makeCredit, uid } from './fixtures';
import { recordObservation, tryAllocateForAttempt } from '@/server/pg/reconcile-engine';

afterAll(async () => {
  await prisma.$disconnect();
});

const observe = (attemptId: string, utr: string, payable: number | null) =>
  recordObservation({
    attemptId,
    source: PgEvidenceSource.GATEWAY_WEBHOOK,
    utr,
    amountPaise: 25000,
    payableAmountPaise: payable,
    authenticated: true,
    dedupeKey: `t:${uid()}`,
  });

describe('fork paise offset (real DB)', () => {
  it('signed payable 25037 -> credit of 25037 captures; order amount 25000 alone would not', async () => {
    const acc = await makeAccount();
    const { attempt } = await makeAttempt(acc, { observedUtr: null, state: 'AWAITING_PAYMENT' });
    const utr = `U${uid().toUpperCase()}`;
    await observe(attempt.id, utr, 25037);
    await makeCredit(acc, { amountPaise: 25037, reference: utr });
    expect((await tryAllocateForAttempt(attempt.id)).outcome).toBe('CAPTURED');
    const a = await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(a.payableAmountPaise).toBe(25037);
    expect(a.state).toBe('CAPTURED');
  });

  it('without a signed payable amount the offset credit is AMOUNT_MISMATCH (no capture)', async () => {
    const acc = await makeAccount();
    const { attempt } = await makeAttempt(acc, { observedUtr: null, state: 'AWAITING_PAYMENT' });
    const utr = `U${uid().toUpperCase()}`;
    await observe(attempt.id, utr, null);
    await makeCredit(acc, { amountPaise: 25037, reference: utr });
    expect((await tryAllocateForAttempt(attempt.id)).outcome).not.toBe('CAPTURED');
  });

  it('payable outside 0..99 paise of the order amount is rejected and not stored', async () => {
    const acc = await makeAccount();
    const { attempt } = await makeAttempt(acc, { observedUtr: null, state: 'AWAITING_PAYMENT' });
    await observe(attempt.id, `U${uid().toUpperCase()}`, 25100);
    const a = await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(a.payableAmountPaise).toBeNull();
    expect(a.state).toBe('AWAITING_PAYMENT');
    const ex = await prisma.pgReconException.findMany({ where: { attemptId: attempt.id, kind: 'AMOUNT_MISMATCH' } });
    expect(ex.length).toBe(1);
  });

  it('DB CHECK rejects an out-of-range payable written directly', async () => {
    const acc = await makeAccount();
    const { attempt } = await makeAttempt(acc);
    await expect(
      prisma.pgPaymentAttempt.update({ where: { id: attempt.id }, data: { payableAmountPaise: 24999 } }),
    ).rejects.toThrow();
  });
});
