/**
 * Flavrly PG webhook receiver (contract D10). Verify -> durable insert -> 200.
 *
 * Trust model: the webhook is only an authenticated HINT. We never act on the
 * body's status. The stored row is processed by the lease-based inbox worker
 * (server/pg/inbox.ts), which records the signed UTR/amount as an observation
 * and reconciles; capture needs bank evidence (D3).
 *
 * 1. Raw bytes, max 64 KiB (413 before any HMAC work).
 * 2. Candidate secrets from the restaurant binding of the payment the body names
 *    (PgPaymentAttempt by attemptKey/gatewayPaymentId -> IntegrationCredential
 *    (restaurantId, YOUPI)); previous secret accepted until rotatedAt + 24h. The
 *    platform secret is used only for legacy rows without an attempt, or for the
 *    one binding that runs on the platform merchant id.
 * 3. Timestamp-binding HMAC-SHA256 (Standard Webhooks `webhook-signature`, or
 *    upstream `X-Gateway-Signature-V2`), constant-time. Body-only signatures are
 *    rejected: they leave the timestamp unauthenticated.
 * 4. Header/body identity must agree (delivery id, timestamp, event type).
 * 5. Freshness: |now - ts| <= 5 min. Upstream retries resend the ORIGINAL
 *    timestamp, so a stale timestamp is accepted ONLY for a delivery id we
 *    already stored durably (answered 200 as a duplicate, nothing re-run).
 * 6. Insert PaymentWebhookEvent (dedupe `youpi:<deliveryId>`); 200 only after
 *    commit; any DB failure -> 503 so the gateway retries.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { log } from '@/server/log';
import { getConfig } from '@/server/integrations';
import { processInboxEventNow } from '@/server/pg/inbox';
import {
  MAX_SKEW_MS,
  candidateSecrets,
  identityMismatch,
  parseWebhookBody,
  readBodyCapped,
  verifyWebhookSignature,
  type WebhookBodyIdentity,
} from '@/server/pg/webhook-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PLATFORM_ID = '__platform__';

async function resolveSecrets(id: WebhookBodyIdentity): Promise<{ restaurantId: string | null; secrets: string[] }> {
  const or = [
    ...(id.attemptKey ? [{ attemptKey: id.attemptKey }] : []),
    ...(id.gatewayPaymentId ? [{ gatewayPaymentId: id.gatewayPaymentId }] : []),
  ];
  const attempt = or.length
    ? await prisma.pgPaymentAttempt.findFirst({ where: { OR: or }, select: { restaurantId: true, gatewayMerchantId: true } })
    : null;
  const platform = await getConfig(PLATFORM_ID, 'YOUPI');
  if (!attempt) return { restaurantId: null, secrets: candidateSecrets(platform) };
  const own = await getConfig(attempt.restaurantId, 'YOUPI');
  if (own?.webhookSecret) return { restaurantId: attempt.restaurantId, secrets: candidateSecrets(own) };
  const onPlatformMerchant = !!platform?.merchantId && platform.merchantId === attempt.gatewayMerchantId;
  return { restaurantId: attempt.restaurantId, secrets: onPlatformMerchant ? candidateSecrets(platform) : [] };
}

const isUniqueViolation = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';

export async function POST(req: NextRequest) {
  const raw = await readBodyCapped(req);
  if (raw === null) {
    log.warn({}, 'youpi.webhook.too_large');
    return new Response('Payload too large', { status: 413 });
  }

  let body: unknown;
  try { body = JSON.parse(raw.toString('utf8')); } catch { return new Response('Bad JSON', { status: 400 }); }
  const identity = parseWebhookBody(body);

  let resolved: { restaurantId: string | null; secrets: string[] };
  try {
    resolved = await resolveSecrets(identity);
  } catch (e) {
    log.error({ err: (e as Error).message }, 'youpi.webhook.secret_lookup_failed');
    return new Response('Temporarily unavailable', { status: 503 });
  }

  const v = verifyWebhookSignature(raw, req.headers, resolved.secrets);
  if (!v.ok) {
    if (v.reason === 'no_secret') {
      // Misconfiguration on our side: ask the gateway to retry rather than drop.
      log.error({ hasAttempt: resolved.restaurantId !== null }, 'youpi.webhook.no_secret');
      return new Response('Webhook not configured', { status: 503 });
    }
    log.warn({ reason: v.reason, hasAttempt: resolved.restaurantId !== null }, 'youpi.webhook.auth_failed');
    return new Response('Bad signature', { status: 401 });
  }

  const mismatch = identityMismatch(v, req.headers, identity);
  if (mismatch) {
    log.warn({ mismatch, deliveryId: v.deliveryId }, 'youpi.webhook.identity_mismatch');
    return new Response('Header/body identity mismatch', { status: 400 });
  }

  const providerEventId = `youpi:${v.deliveryId}`;
  try {
    if (Math.abs(Date.now() - v.timestampMs) > MAX_SKEW_MS) {
      // Legitimate upstream retries keep their original timestamp. Only an
      // already-stored delivery may be acknowledged; nothing is re-processed.
      const known = await prisma.paymentWebhookEvent.findUnique({ where: { providerEventId }, select: { id: true } });
      if (known) return Response.json({ ok: true, deduped: true });
      log.warn({ deliveryId: v.deliveryId, scheme: v.scheme }, 'youpi.webhook.stale_unknown_delivery');
      return new Response('Stale timestamp', { status: 400 });
    }

    const stored = await prisma.paymentWebhookEvent.create({
      data: {
        provider: 'youpi',
        eventType: identity.bodyEventType ?? req.headers.get('x-gateway-event') ?? 'unknown',
        paymentId: identity.gatewayPaymentId,
        orderId: identity.attemptKey,
        providerEventId,
        signature: v.scheme,
        rawPayload: body as object,
        processed: false,
        restaurantId: resolved.restaurantId,
        nextAttemptAt: new Date(),
      },
      select: { id: true },
    });

    // Best effort only: the inbox worker owns correctness.
    void processInboxEventNow(stored.id).catch((e) =>
      log.error({ err: (e as Error).message, deliveryId: v.deliveryId }, 'youpi.webhook.inline_process_failed'),
    );
    return Response.json({ ok: true });
  } catch (e) {
    if (isUniqueViolation(e)) return Response.json({ ok: true, deduped: true });
    log.error({ err: (e as Error).message, deliveryId: v.deliveryId }, 'youpi.webhook.store_failed');
    return new Response('Temporarily unavailable', { status: 503 });
  }
}
