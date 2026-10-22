/**
 * Flavrly PG reconciliation sweep — safety net for lost webhooks. Asks the gateway
 * about every in-flight Flavrly PG payment via `reconcileYoupiPayment` (the only
 * place that can capture). Advisory-lock guarded against overlapping runs.
 *
 * Run from /api/platform/jobs/youpi-reconcile/run every 3 minutes.
 */

import { prisma } from '../db';
import { log } from '../log';
import { reconcileYoupiPayment } from '../payments/youpi-reconcile';
import { YOUPI_PROVIDER_NAME } from '../payments/youpi';
import { PaymentStatus } from '@prisma/client';

export interface YoupiSweepResult {
  scanned: number;
  reconciled: number;
  captured: number;
  failed: number;
  /** PENDING/AUTHORIZED rows older than MAX_AGE_MS needing operator attention. */
  abandoned: number;
}

const LOCK_KEY = 889201990;
const MIN_AGE_MS = 90_000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const BATCH = 100;

export async function runYoupiReconcileSweep(): Promise<YoupiSweepResult> {
  const now = Date.now();
  const result: YoupiSweepResult = { scanned: 0, reconciled: 0, captured: 0, failed: 0, abandoned: 0 };

  const lockRows = await prisma.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS locked`;
  if (!lockRows?.[0]?.locked) {
    log.warn('youpi reconcile sweep: another run holds the lock; skipping this tick');
    return result;
  }
  try {
    const pending = await prisma.payment.findMany({
      where: {
        providerName: YOUPI_PROVIDER_NAME,
        status: { in: [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED] },
        createdAt: { lt: new Date(now - MIN_AGE_MS), gt: new Date(now - MAX_AGE_MS) },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
    });

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
    return result;
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${LOCK_KEY})`;
  }
}
