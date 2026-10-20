/**
 * YouPI webhook receiver.
 *
 * Trust model: the webhook is only a HINT that a payment may have changed. We
 * never act on the body's event/status/amount. After authenticating the
 * delivery we call reconcileYoupiPayment(), which re-verifies against YouPI's
 * status API and applies the single-winner capture (status + UTR + exact amount).
 *
 * - HMAC-SHA256 over the RAW body with the platform YouPI webhook secret,
 *   constant-time compared (X-Gateway-Signature).
 * - Replay window: X-Gateway-Timestamp must be within 5 minutes of now.
 * - Idempotent: PaymentWebhookEvent keyed 'youpi:<X-Gateway-Delivery-Id>'
 *   (namespaced; the column is globally unique across providers). The event is
 *   stored before any business logic.
 * - After the event is stored, reconcile failures are logged and still 200 —
 *   the poller/sweep is the safety net.
 */
import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { prisma } from '@/server/db';
import { log } from '@/server/log';
import { getConfig } from '@/server/integrations';
import type { ProviderKey } from '@/server/integrations/providers';
import { reconcileYoupiPayment } from '@/server/payments/youpi-reconcile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_SKEW_MS = 5 * 60 * 1000;

function signatureMatches(raw: string, signature: string, secret: string): boolean {
  if (!signature) return false;
  const mac = crypto.createHmac('sha256', secret).update(raw).digest();
  const candidates = [Buffer.from(mac.toString('hex')), Buffer.from(mac.toString('base64'))];
  const given = Buffer.from(signature.trim().replace(/^sha256=/i, ''));
  let ok = false;
  for (const c of candidates) {
    // Length check first: timingSafeEqual throws on unequal lengths.
    if (c.length === given.length && crypto.timingSafeEqual(c, given)) ok = true;
  }
  return ok;
}

/** Accepts epoch seconds, epoch millis, or an ISO date. Returns ms or null. */
function parseTimestampMs(v: string | null): number | null {
  if (!v) return null;
  const t = v.trim();
  if (/^\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    return n < 1e12 ? n * 1000 : n;
  }
  const d = Date.parse(t);
  return Number.isNaN(d) ? null : d;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  let secret: string | null = null;
  try {
    const cfg = await getConfig('__platform__', 'YOUPI' as ProviderKey);
    secret = (cfg?.webhookSecret as string | undefined) || null;
  } catch (e) {
    log.error({ err: e }, 'youpi.webhook.config_error');
  }
  if (!secret) {
    log.error({}, 'youpi.webhook.no_secret');
    return new Response('Webhook not configured', { status: 503 });
  }

  const signature = req.headers.get('x-gateway-signature') ?? '';
  if (!signatureMatches(raw, signature, secret)) {
    log.warn({}, 'youpi.webhook.bad_signature');
    return new Response('Bad signature', { status: 401 });
  }

  const tsMs = parseTimestampMs(req.headers.get('x-gateway-timestamp'));
  if (tsMs === null || Math.abs(Date.now() - tsMs) > MAX_SKEW_MS) {
    log.warn({ hasTs: tsMs !== null }, 'youpi.webhook.stale_timestamp');
    return new Response('Stale or invalid timestamp', { status: 400 });
  }

  const deliveryId = (req.headers.get('x-gateway-delivery-id') ?? '').trim();
  if (!deliveryId) return new Response('Missing delivery id', { status: 400 });
  const providerEventId = `youpi:${deliveryId}`;

  let event: any;
  try { event = JSON.parse(raw); } catch { return new Response('Bad JSON', { status: 400 }); }
  const eventType = String(req.headers.get('x-gateway-event') ?? event?.event ?? 'unknown');
  const gatewayPaymentId: string | null = typeof event?.paymentId === 'string' ? event.paymentId : null;
  const gatewayOrderId: string | null = typeof event?.orderId === 'string' ? event.orderId : null;

  // Idempotency: already seen → no-op.
  const seen = await prisma.paymentWebhookEvent.findUnique({ where: { providerEventId } });
  if (seen) return Response.json({ ok: true, deduped: true });

  // Persist before any business logic. P2002 ⇒ concurrent duplicate.
  let stored;
  try {
    stored = await prisma.paymentWebhookEvent.create({
      data: {
        provider: 'youpi',
        eventType,
        paymentId: gatewayPaymentId,
        orderId: gatewayOrderId,
        providerEventId,
        signature,
        rawPayload: event,
        processed: false,
      },
    });
  } catch (e: unknown) {
    if (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002') {
      return Response.json({ ok: true, deduped: true });
    }
    throw e;
  }

  try {
    // Map the gateway's payment id to OUR Payment row (providerRef). The body's
    // status/amount/utr are deliberately ignored — reconcile re-verifies.
    const payment =
      (gatewayPaymentId
        ? await prisma.payment.findFirst({ where: { providerName: 'youpi', providerRef: gatewayPaymentId }, select: { id: true } })
        : null) ??
      (gatewayOrderId
        ? await prisma.payment.findFirst({ where: { providerName: 'youpi', orderId: gatewayOrderId }, orderBy: { createdAt: 'desc' }, select: { id: true } })
        : null);

    if (!payment) {
      log.warn({ deliveryId }, 'youpi.webhook.no_matching_payment');
    } else {
      await reconcileYoupiPayment(payment.id);
    }
    await prisma.paymentWebhookEvent.update({
      where: { id: stored.id },
      data: { processed: true, processedAt: new Date() },
    });
  } catch (e) {
    await prisma.paymentWebhookEvent
      .update({ where: { id: stored.id }, data: { error: (e as Error).message } })
      .catch(() => {});
    log.error({ err: e, deliveryId }, 'youpi.webhook.reconcile_failed');
  }

  return Response.json({ ok: true });
}
