/** reconcileYoupiPayment against real Postgres; only the gateway HTTP + config lookup are stubbed. */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ status: vi.fn() }));
vi.mock('@/server/payments/youpi-api', () => ({ getYoupiStatus: h.status }));
vi.mock('@/server/payments/youpi', () => ({ resolveYoupiConfig: async () => ({ baseUrl: 'http://gw.invalid' }) }));

import { reconcileYoupiPayment } from '@/server/payments/youpi-reconcile';
import { prisma, makeAccount, makeAttempt, makeCredit } from './fixtures';

afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(() => h.status.mockReset());

describe('reconcileYoupiPayment (real DB)', () => {
  it('status SUCCESS alone never captures; it captures once the matching bank credit exists', async () => {
    const acc = await makeAccount();
    const { attempt, payment, orderId } = await makeAttempt(acc, { state: 'AWAITING_PAYMENT', observedUtr: null });
    h.status.mockResolvedValue({ status: 'CAPTURED', utr: 'UTRSTATUS1', amountPaise: 25000 });

    const first = await reconcileYoupiPayment(payment.id);
    expect(first).toMatchObject({ status: 'PENDING', captured: false });
    const a1 = await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(a1).toMatchObject({ state: 'OBSERVED', observedUtr: 'UTRSTATUS1' });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PENDING');

    await makeCredit(acc, { amountPaise: 25000, reference: 'UTRSTATUS1' });
    const second = await reconcileYoupiPayment(payment.id);
    expect(second).toMatchObject({ status: 'CAPTURED', captured: true });
    expect(await prisma.pgOutbox.count({ where: { aggregateId: orderId, topic: 'ORDER_RELEASE' } })).toBe(1);
    // Evidence deduped per attempt across sweeps.
    expect(await prisma.pgPaymentEvidence.count({ where: { attemptId: attempt.id } })).toBe(1);
  });

  it('legacy youpi payment without attempt stays PENDING with a STALE_PENDING exception', async () => {
    const acc = await makeAccount();
    const { orderId } = await makeAttempt(acc);
    const legacy = await prisma.payment.create({
      data: { orderId, method: 'RAZORPAY', amount: '250.00', providerName: 'youpi', providerRef: 'yp_legacy' },
    });
    h.status.mockResolvedValue({ status: 'CAPTURED', utr: 'U', amountPaise: 25000 });
    const r = await reconcileYoupiPayment(legacy.id);
    expect(r).toMatchObject({ status: 'PENDING', captured: false, indeterminate: true });
    expect(h.status).not.toHaveBeenCalled();
    expect(await prisma.pgReconException.count({ where: { dedupeKey: `STALE_PENDING:legacy:${legacy.id}` } })).toBe(1);
  });

  it('gateway FAILED on an unobserved attempt -> Payment FAILED + attempt FAILED', async () => {
    const acc = await makeAccount();
    const { attempt, payment } = await makeAttempt(acc, { state: 'AWAITING_PAYMENT', observedUtr: null });
    h.status.mockResolvedValue({ status: 'FAILED' });
    expect((await reconcileYoupiPayment(payment.id)).status).toBe('FAILED');
    expect((await prisma.pgPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).state).toBe('FAILED');
  });
});
