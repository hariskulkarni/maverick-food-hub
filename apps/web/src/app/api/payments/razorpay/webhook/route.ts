/**
 * Razorpay webhook receiver.
 *
 * - Signature verified against the per-restaurant stored webhook secret (the one
 *   the admin pastes in the Storefront CMS → Integrations → Razorpay), resolved
 *   from the event's order/payment → restaurant. Falls back to the platform
 *   RAZORPAY_WEBHOOK_SECRET env when no per-restaurant secret is stored. HMAC-
 *   SHA256 of the raw body, constant-time compared.
 * - Idempotent: every event is persisted in PaymentWebhookEvent keyed by
 *   provider event ID. Duplicate deliveries become no-ops.
 * - Handles payment.captured / payment.failed / order.paid (payment status) AND
 *   refund.created / refund.processed / refund.failed (refund notifications) —
 *   the latter flips our Refund rows to COMPLETED/FAILED so an
 *   original-payment refund initiated in-app is confirmed by the gateway.
 * - The raw payload is stored before business logic runs, so a crash midway can
 *   be retried safely.
 */
import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { prisma } from '@/server/db';
import { log } from '@/server/log';
import { getConfig } from '@/server/integrations';
import { refundStatusFromEvent, paymentStatusFromEvent } from '@/server/payments/webhook-events';
import { PaymentStatus, RefundStatus } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verify(rawBody: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/** The Razorpay webhook secret stored for the restaurant that owns this payment. */
async function restaurantWebhookSecret(paymentId: string | null): Promise<string | null> {
  if (!paymentId) return null;
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: { order: { select: { branch: { select: { restaurantId: true } } } } },
    });
    const restaurantId = payment?.order?.branch?.restaurantId;
    if (!restaurantId) return null;
    const cfg = await getConfig(restaurantId, 'RAZORPAY');
    return cfg?.webhookSecret || null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get('x-razorpay-signature') ?? '';
  const raw = await req.text();

  // Parse first (without trusting) so we can locate the owning restaurant and
  // use its stored webhook secret. We still verify before any state change.
  let event: any;
  try { event = JSON.parse(raw); } catch { return new Response('Bad JSON', { status: 400 }); }

  const providerEventId: string | null = event?.id ?? event?.event_id ?? null;
  const eventType: string = event?.event ?? 'unknown';
  const paymentEntity = event?.payload?.payment?.entity ?? null;
  const refundEntity = event?.payload?.refund?.entity ?? null;
  const paymentId: string | null = paymentEntity?.id ?? refundEntity?.payment_id ?? null;
  const razorpayOrderId: string | null =
    paymentEntity?.order_id ?? event?.payload?.order?.entity?.id ?? null;

  // Locate the Payment (by gateway payment id first, then by the order id we
  // stored at create time). Used both for secret resolution and processing.
  const payment =
    (paymentId ? await prisma.payment.findFirst({ where: { providerRef: paymentId } }) : null) ??
    (razorpayOrderId ? await prisma.payment.findFirst({ where: { providerRef: razorpayOrderId } }) : null);

  // Resolve the signing secret: per-restaurant (preferred) else platform env.
  const perRestaurant = await restaurantWebhookSecret(payment?.id ?? null);
  const secret = perRestaurant || process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    log.error({}, 'No Razorpay webhook secret (per-restaurant or env) — refusing webhook');
    return new Response('Webhook not configured', { status: 500 });
  }
  if (!verify(raw, signature, secret)) {
    log.warn({ signature: signature.slice(0, 12), perRestaurant: Boolean(perRestaurant) }, 'Razorpay webhook signature mismatch');
    return new Response('Bad signature', { status: 400 });
  }

  // Idempotency: skip if we've already recorded this event id.
  if (providerEventId) {
    const seen = await prisma.paymentWebhookEvent.findUnique({ where: { providerEventId } });
    if (seen) return Response.json({ ok: true, deduped: true, eventId: providerEventId });
  }

  // Persist the raw event first so a crash below can still be replayed. Guard the
  // concurrent-duplicate race via the unique constraint (P2002 ⇒ safe dedupe).
  let stored;
  try {
    stored = await prisma.paymentWebhookEvent.create({
      data: {
        provider: 'razorpay',
        eventType,
        paymentId,
        orderId: payment?.orderId ?? null,
        providerEventId,
        signature,
        rawPayload: event,
        processed: false,
      },
    });
  } catch (e: unknown) {
    if (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002') {
      return Response.json({ ok: true, deduped: true, eventId: providerEventId });
    }
    throw e;
  }

  // Best-effort processing — failures get recorded but the webhook still 200s so
  // Razorpay doesn't hammer retries on a transient DB blip.
  try {
    // ── Refund events ────────────────────────────────────────────────────
    const refundStatus = refundStatusFromEvent(eventType, refundEntity?.status);
    if (refundStatus) {
      const razorpayRefundId: string | null = refundEntity?.id ?? null;
      // Match our Refund row by the gateway refund id we saved when initiating,
      // else the most recent in-flight original-payment refund for this payment.
      let refund =
        razorpayRefundId
          ? await prisma.refund.findFirst({ where: { providerRef: razorpayRefundId } })
          : null;
      if (!refund && payment) {
        refund = await prisma.refund.findFirst({
          where: { paymentId: payment.id, destination: 'ORIGINAL_PAYMENT' },
          orderBy: { createdAt: 'desc' },
        });
      }
      if (refund) {
        await prisma.refund.update({
          where: { id: refund.id },
          data: {
            status: refundStatus as RefundStatus,
            providerRef: refund.providerRef ?? razorpayRefundId,
            providerData: {
              ...(typeof refund.providerData === 'object' && refund.providerData ? (refund.providerData as object) : {}),
              webhookEvent: eventType,
              gatewayStatus: refundEntity?.status ?? null,
              confirmedAt: new Date().toISOString(),
            },
          },
        });
        // A fully-settled refund on the source marks the payment REFUNDED.
        if (refundStatus === 'COMPLETED' && payment) {
          await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.REFUNDED } }).catch(() => {});
        }
      } else {
        log.warn({ razorpayRefundId, paymentId }, 'refund webhook: no matching Refund row to update');
      }
    } else {
      // ── Payment events ─────────────────────────────────────────────────
      const payStatus = paymentStatusFromEvent(eventType, paymentEntity?.status);
      if (payStatus && payment) {
        if (payStatus === 'CAPTURED') {
          await prisma.payment.update({
            where: { id: payment.id },
            data: { status: PaymentStatus.CAPTURED, providerRef: paymentId ?? payment.providerRef },
          });
        } else if (payStatus === 'FAILED') {
          await prisma.payment.update({
            where: { id: payment.id },
            data: { status: PaymentStatus.FAILED, errorMessage: paymentEntity?.error_description ?? 'failed' },
          });
        }
      }
    }

    await prisma.paymentWebhookEvent.update({
      where: { id: stored.id },
      data: { processed: true, processedAt: new Date() },
    });
  } catch (e) {
    await prisma.paymentWebhookEvent.update({
      where: { id: stored.id },
      data: { error: (e as Error).message },
    }).catch(() => {});
    log.error({ err: e, eventId: providerEventId }, 'webhook processing failed (will retry on next delivery)');
  }

  return Response.json({ ok: true });
}
