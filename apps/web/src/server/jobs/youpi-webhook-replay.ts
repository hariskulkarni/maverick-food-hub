/**
 * Replays inbound Flavrly PG webhook deliveries that were durably saved but
 * interrupted before processing. This is complementary to the existing
 * gateway-status sweep; it does NOT repair a gateway-side webhook that was
 * never emitted or persisted (upstream issue #86).
 *
 * At-least-once processing: an atomic compare-and-set claim reduces overlap;
 * reconciliation remains idempotent and never trusts the saved webhook's
 * success flag, UTR, or amount as proof of funds.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../db';
import { log } from '../log';
import { reconcileYoupiPayment } from '../payments/youpi-reconcile';

const MIN_AGE_MS = 30_000; // let the original request finish first
const BATCH = 100;

export type YoupiWebhookReplayResult = {
  scanned: number;
  claimed: number;
  processed: number;
  unresolved: number;
  errors: number;
};

export async function runYoupiWebhookReplay(): Promise<YoupiWebhookReplayResult> {
  const result: YoupiWebhookReplayResult = {
    scanned: 0, claimed: 0, processed: 0, unresolved: 0, errors: 0,
  };

  const events = await prisma.paymentWebhookEvent.findMany({
    where: {
      provider: 'youpi',
      processed: false,
      createdAt: { lt: new Date(Date.now() - MIN_AGE_MS) },
    },
    select: { id: true, providerEventId: true, paymentId: true, orderId: true, error: true },
    orderBy: { createdAt: 'asc' },
    take: BATCH,
  });

  for (const ev of events) {
    result.scanned++;
    // Guard concurrent cron/manual invocations without adding DB columns.
    // The previous claim marker is reclaimable after an interrupted run.
    const claim = `youpi-replay:${randomUUID()}`;
    const acquired = await prisma.paymentWebhookEvent.updateMany({
      where: { id: ev.id, provider: 'youpi', processed: false, error: ev.error },
      data: { error: claim },
    });
    if (acquired.count !== 1) continue;
    result.claimed++;

    try {
      // Use only signed-and-stored identifiers to find a local attempt.
      // They are *routing hints*, not payment authenticity or bank proof.
      const gatewayRef = ev.paymentId;
      const attemptRef = ev.orderId;
      const payment =
        (gatewayRef
          ? await prisma.payment.findFirst({
              where: { providerName: 'youpi', providerRef: gatewayRef },
              select: { id: true, providerRef: true },
            })
          : null) ??
        (attemptRef
          ? await prisma.payment.findFirst({
              where: { providerName: 'youpi', providerRef: attemptRef },
              select: { id: true, providerRef: true },
            })
          : null) ??
        // Old YouPI checkouts used internal Order.id rather than attempt key.
        (attemptRef
          ? await prisma.payment.findFirst({
              where: { providerName: 'youpi', orderId: attemptRef },
              orderBy: { createdAt: 'desc' },
              select: { id: true, providerRef: true },
            })
          : null);

      if (!payment) {
        result.unresolved++;
        await prisma.paymentWebhookEvent.updateMany({
          where: { id: ev.id, error: claim, processed: false },
          data: { error: 'Unmatched local payment; needs reconciliation' },
        });
        continue;
      }

      if (gatewayRef && attemptRef && payment.providerRef === attemptRef) {
        // If the webhook outran the payment-creation response, repair the
        // locally seeded attemptRef, never replacing an unrelated gateway ref.
        await prisma.payment.updateMany({
          where: {
            id: payment.id, providerName: 'youpi', status: 'PENDING',
            providerRef: attemptRef,
          },
          data: { providerRef: gatewayRef },
        });
      }

      const outcome = await reconcileYoupiPayment(payment.id);
      if (outcome.indeterminate) {
        result.unresolved++;
        await prisma.paymentWebhookEvent.updateMany({
          where: { id: ev.id, error: claim, processed: false },
          data: { error: 'Gateway verification indeterminate; retry scheduled' },
        });
        continue;
      }

      // "processed" means the notification was consumed; it does NOT imply
      // that a bank credit was verified or that the order was paid.
      const finished = await prisma.paymentWebhookEvent.updateMany({
        where: { id: ev.id, error: claim, processed: false },
        data: { processed: true, processedAt: new Date(), error: null },
      });
      if (finished.count === 1) result.processed++;
    } catch {
      result.errors++;
      await prisma.paymentWebhookEvent.updateMany({
        where: { id: ev.id, error: claim, processed: false },
        data: { error: 'Webhook replay encountered a processing error' },
      }).catch(() => {});
      log.error({ eventId: ev.id }, 'youpi.webhook_replay.failure');
    }
  }

  if (result.unresolved || result.errors) {
    log.warn(result as unknown as Record<string, unknown>, 'youpi.webhook_replay.unresolved');
  }
  return result;
}
