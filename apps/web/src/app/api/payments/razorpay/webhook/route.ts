/**
 * Razorpay webhook receiver.
 *
 * - Signature verified against RAZORPAY_WEBHOOK_SECRET (HMAC-SHA256 of raw body)
 * - Idempotent: every event is persisted in PaymentWebhookEvent keyed by
 *   provider event ID. Duplicate deliveries become no-ops.
 * - The raw payload is stored before any business logic runs, so a crash
 *   midway through can be retried safely.
 */
import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { prisma } from '@/server/db';
import { log } from '@/server/log';
import { PaymentStatus } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verify(rawBody: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  // Constant-time compare to defeat timing oracles
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers.get('x-razorpay-signature') ?? '';
  const raw = await req.text();

  if (!secret) {
    log.error({}, 'RAZORPAY_WEBHOOK_SECRET not set — refusing webhook');
    return new Response('Webhook not configured', { status: 500 });
  }
  if (!verify(raw, signature, secret)) {
    log.warn({ signature: signature.slice(0, 12) }, 'Razorpay webhook signature mismatch');
    return new Response('Bad signature', { status: 400 });
  }

  let event: any;
  try { event = JSON.parse(raw); } catch { return new Response('Bad JSON', { status: 400 }); }

  const providerEventId: string | null = event?.id ?? event?.event_id ?? null;
  const eventType: string = event?.event ?? 'unknown';
  const paymentId: string | null = event?.payload?.payment?.entity?.id ?? null;
  const razorpayOrderId: string | null = event?.payload?.payment?.entity?.order_id ?? event?.payload?.order?.entity?.id ?? null;

  // Idempotency: if we've seen this providerEventId before, skip.
  if (providerEventId) {
    const seen = await prisma.paymentWebhookEvent.findUnique({ where: { providerEventId } });
    if (seen) return Response.json({ ok: true, deduped: true, eventId: providerEventId });
  }

  // Find the matching Payment by Razorpay order id
  const payment = razorpayOrderId
    ? await prisma.payment.findFirst({ where: { providerRef: razorpayOrderId } })
    : null;

  // Persist the raw event first so a crash below can still be replayed.
  // Guard the concurrent-duplicate race: two identical deliveries can both pass
  // the findUnique check above, then race to insert. The unique constraint on
  // providerEventId makes the loser throw P2002 — treat that as a safe dedupe.
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
        processed: false
      }
    });
  } catch (e: unknown) {
    if (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002') {
      return Response.json({ ok: true, deduped: true, eventId: providerEventId });
    }
    throw e;
  }

  // Best-effort processing — failures get recorded but the webhook still 200s
  try {
    if (payment) {
      const status = event?.payload?.payment?.entity?.status as string | undefined;
      if (status === 'captured') {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.CAPTURED, providerRef: paymentId ?? payment.providerRef }
        });
      } else if (status === 'failed') {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: PaymentStatus.FAILED, errorMessage: event?.payload?.payment?.entity?.error_description ?? 'failed' }
        });
      }
    }
    await prisma.paymentWebhookEvent.update({
      where: { id: stored.id },
      data: { processed: true, processedAt: new Date() }
    });
  } catch (e) {
    await prisma.paymentWebhookEvent.update({
      where: { id: stored.id },
      data: { error: (e as Error).message }
    });
    log.error({ err: e, eventId: providerEventId }, 'webhook processing failed (will retry on next delivery)');
  }

  return Response.json({ ok: true });
}
