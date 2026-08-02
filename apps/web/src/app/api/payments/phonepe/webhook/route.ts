/**
 * PhonePe webhook receiver.
 *
 * Configure in PhonePe Business Dashboard → Developer Settings → Webhooks:
 *   URL      https://<your-domain>/api/payments/phonepe/webhook
 *   Auth     SHA  (username + password — paste the same pair into
 *                  Storefront CMS → Integrations → PhonePe)
 *   Events   checkout.order.completed, checkout.order.failed,
 *            pg.refund.accepted, pg.refund.completed, pg.refund.failed
 *
 * Security model — read this before changing anything here:
 *
 *   PhonePe does NOT sign the body. The Authorization header is a static
 *   `SHA256(username:password)`, identical on every delivery, so possession of
 *   one captured header is enough to replay any payload. Authentication here
 *   therefore proves *who* is calling, not *what* is true. Consequently the
 *   webhook never writes a payment outcome directly: it authenticates, records
 *   the raw event, and then asks the Order Status / Refund Status API what
 *   actually happened (`reconcile.ts`). PhonePe's own integration guidance says
 *   the same — treat the callback as a trigger, confirm server-to-server.
 *
 * Idempotency: PhonePe sends no event id, so we synthesise a stable one from
 * (event, subject, state, body digest) and rely on the unique index on
 * PaymentWebhookEvent.providerEventId. Redeliveries collapse; genuine state
 * progressions do not.
 *
 * Latency: PhonePe expects a 2xx within 3–5s. The status round-trip fits, but
 * every failure path still returns 200 with a body describing what happened —
 * a non-2xx would only buy us a retry storm for a problem retries can't fix.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { log } from '@/server/log';
import { getConfigInherited } from '@/server/integrations';
import {
  normalizePhonePeEvent,
  phonePeEventId,
  verifyWebhookAuth,
  type NormalizedPhonePeEvent,
} from '@/server/payments/phonepe-events';
import {
  findPhonePePayment,
  reconcilePhonePePayment,
  reconcilePhonePeRefund,
} from '@/server/payments/reconcile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** PhonePe sends this as `Authorization`; some proxies lowercase it. */
function authHeader(req: NextRequest): string | null {
  return req.headers.get('authorization') ?? req.headers.get('x-verify') ?? null;
}

/**
 * Webhook credentials for the restaurant that owns this event.
 *
 * We locate the tenant from the payload *before* authenticating — unavoidable,
 * since the credential is per-tenant. Nothing is written on the strength of the
 * untrusted payload; it is only used to pick which secret to check against.
 * Falls back to the platform env pair when the tenant has none.
 */
async function resolveWebhookCreds(
  e: NormalizedPhonePeEvent,
): Promise<{ username: string; password: string; restaurantId: string | null } | null> {
  let restaurantId: string | null = null;

  if (e.merchantOrderId) {
    const payment = await prisma.payment.findFirst({
      where: { providerRef: e.merchantOrderId },
      select: { order: { select: { branch: { select: { restaurantId: true } } } } },
    });
    restaurantId = payment?.order?.branch?.restaurantId ?? null;
  }
  if (!restaurantId && e.merchantRefundId) {
    const refund = await prisma.refund.findFirst({
      where: { providerRef: e.merchantRefundId },
      select: { order: { select: { branch: { select: { restaurantId: true } } } } },
    });
    restaurantId = refund?.order?.branch?.restaurantId ?? null;
  }
  // udf3 carries the restaurant id on every order event we created.
  if (!restaurantId) {
    const meta = e.payload.metaInfo as Record<string, string> | undefined;
    if (meta?.udf3) restaurantId = meta.udf3;
  }

  if (restaurantId) {
    try {
      // Inherited: a child outlet transacting on the parent brand's merchant
      // account is authenticated by the parent's webhook pair.
      const cfg = (await getConfigInherited(restaurantId, 'PHONEPE'))?.config;
      if (cfg?.webhookUsername && cfg?.webhookPassword) {
        return { username: cfg.webhookUsername, password: cfg.webhookPassword, restaurantId };
      }
    } catch {
      /* fall through to env */
    }
  }

  const username = process.env.PHONEPE_WEBHOOK_USERNAME;
  const password = process.env.PHONEPE_WEBHOOK_PASSWORD;
  if (username && password) return { username, password, restaurantId };
  return null;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  const event = normalizePhonePeEvent(body);

  const creds = await resolveWebhookCreds(event);
  if (!creds) {
    log.error({ event: event.event }, 'PhonePe webhook: no credentials configured (tenant or env) — refusing');
    return new Response('Webhook not configured', { status: 500 });
  }

  if (!verifyWebhookAuth(authHeader(req), creds.username, creds.password)) {
    log.warn(
      { event: event.event, merchantOrderId: event.merchantOrderId, restaurantId: creds.restaurantId },
      'PhonePe webhook auth mismatch',
    );
    return new Response('Unauthorized', { status: 401 });
  }

  // ── Record first, act second ──────────────────────────────────────────────
  const providerEventId = phonePeEventId(event, raw);
  const existing = await prisma.paymentWebhookEvent.findUnique({ where: { providerEventId } });
  if (existing) return Response.json({ ok: true, deduped: true });

  let stored;
  try {
    stored = await prisma.paymentWebhookEvent.create({
      data: {
        provider: 'phonepe',
        eventType: event.event,
        paymentId: null,
        orderId: null,
        providerEventId,
        // The static auth header is not a signature; storing it would persist a
        // reusable credential in the DB for no forensic gain.
        signature: null,
        rawPayload: body as any,
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
    if (event.kind === 'REFUND') {
      const refund = event.merchantRefundId
        ? await prisma.refund.findFirst({ where: { providerRef: event.merchantRefundId } })
        : null;
      if (!refund) {
        log.warn({ merchantRefundId: event.merchantRefundId }, 'PhonePe refund webhook: no matching Refund row');
      } else {
        await prisma.paymentWebhookEvent.update({
          where: { id: stored.id },
          data: { orderId: refund.orderId, paymentId: refund.paymentId },
        });
        await reconcilePhonePeRefund(refund.id);
      }
    } else if (event.kind === 'ORDER') {
      const payment = event.merchantOrderId ? await findPhonePePayment(event.merchantOrderId) : null;
      if (!payment) {
        log.warn({ merchantOrderId: event.merchantOrderId }, 'PhonePe order webhook: no matching Payment row');
      } else {
        await prisma.paymentWebhookEvent.update({
          where: { id: stored.id },
          data: { orderId: payment.orderId, paymentId: payment.id },
        });
        // Deliberately re-queries PhonePe rather than trusting the payload.
        await reconcilePhonePePayment(payment.id);
      }
    } else {
      log.warn({ event: event.event }, 'PhonePe webhook: unrecognised event kind — recorded, not processed');
    }

    await prisma.paymentWebhookEvent.update({
      where: { id: stored.id },
      data: { processed: true, processedAt: new Date() },
    });
  } catch (e) {
    await prisma.paymentWebhookEvent
      .update({ where: { id: stored.id }, data: { error: (e as Error).message } })
      .catch(() => {});
    log.error({ err: e, event: event.event }, 'PhonePe webhook processing failed (sweeper will pick it up)');
  }

  return Response.json({ ok: true });
}
