/**
 * Flavrly PG reconciliation sweep — safety net for lost webhooks. Asks the gateway
 * about every in-flight Flavrly PG payment via `reconcileYoupiPayment` (the only
 * place that can capture). Guarded against overlapping runs by a PgJobLease row
 * (contract D11): a session advisory lock is unsafe with a connection pool, as
 * the unlock can run on a different pooled session than the lock.
 *
 * Run from /api/platform/jobs/youpi-reconcile/run every 3 minutes.
 */

import { prisma } from '../db';
import { log } from '../log';
import { reconcileYoupiPayment } from '../payments/youpi-reconcile';
import { YOUPI_PROVIDER_NAME } from '../payments/youpi';
import { PaymentStatus } from '@prisma/client';
import { withJobLease } from '../pg/job-lease';

export interface YoupiSweepResult {
  scanned: number;
  reconciled: number;
  captured: number;
  failed: number;
  /** PENDING/AUTHORIZED rows older than MAX_AGE_MS needing operator attention. */
  abandoned: number;
}

export const SWEEP_LEASE_NAME = 'youpi-reconcile-sweep';
const LEASE_MS = 5 * 60_000;
const MIN_AGE_MS = 90_000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const BATCH = 100;
const LEGACY_BATCH = 10;

export async function runYoupiReconcileSweep(): Promise<YoupiSweepResult> {
  const now = Date.now();
  const result: YoupiSweepResult = { scanned: 0, reconciled: 0, captured: 0, failed: 0, abandoned: 0 };

  const run = await withJobLease(SWEEP_LEASE_NAME, LEASE_MS, async () => {
    const base = {
      providerName: YOUPI_PROVIDER_NAME,
      status: { in: [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED] },
      createdAt: { lt: new Date(now - MIN_AGE_MS), gt: new Date(now - MAX_AGE_MS) },
    };
    // Least-recently-probed first, so long-pending rows (awaiting a bank statement)
    // cannot starve newer sessions. Legacy rows without an attempt can never be
    // captured (they only raise an exception), so they get a small separate batch.
    const withAttempt = await prisma.payment.findMany({
      where: { ...base, pgAttempt: { isNot: null } },
      select: { id: true },
      orderBy: { pgAttempt: { lastStatusAt: { sort: 'asc', nulls: 'first' } } },
      take: BATCH,
    });
    const legacy = await prisma.payment.findMany({
      where: { ...base, pgAttempt: { is: null } },
      select: { id: true },
      orderBy: { updatedAt: 'asc' },
      take: LEGACY_BATCH,
    });
    const pending = [...withAttempt, ...legacy];

    for (const p of pending) {
      result.scanned += 1;
      try {
        const outcome = await reconcileYoupiPayment(p.id);
        result.reconciled += 1;
        if (outcome.status === PaymentStatus.CAPTURED) result.captured += 1;
        else if (outcome.status === PaymentStatus.FAILED) result.failed += 1;
      } catch (e) {
        log.error({ err: (e as Error).message, paymentId: p.id }, 'youpi sweep: payment reconcile threw');
      }
    }

    result.abandoned = await prisma.payment.count({
      where: {
        providerName: YOUPI_PROVIDER_NAME,
        status: { in: [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED] },
        createdAt: { lt: new Date(now - MAX_AGE_MS) },
      },
    });
    if (result.abandoned > 0) {
      log.warn({ abandoned: result.abandoned }, 'youpi reconcile sweep: payments older than MAX_AGE unresolved; operator attention needed');
    }
    if (result.scanned || result.abandoned) {
      log.info(result as unknown as Record<string, unknown>, 'youpi reconcile sweep complete');
    }
  });
  if (!run.acquired) log.warn('youpi reconcile sweep: another run holds the lease; skipping this tick');
  return result;
}
