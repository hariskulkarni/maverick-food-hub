/**
 * POST /api/integrations/novaryq/webhook/[restaurantId] — Novaryq POS → Flavrly (CONTRACT §5).
 *
 * 1. Feature flag + restaurant config (enabled, webhookSecret) or 404.
 * 2. Raw body capped at 64 KiB (413 before any HMAC work).
 * 3. X-Novaryq-Signature `t=,v1=` = HMAC-SHA256(webhookSecret, `${t}.${rawBody}`),
 *    constant time, |now - t| <= 5 min (Novaryq re-signs every attempt) else 401.
 * 4. Store NovaryqWebhookEvent BEFORE answering 200; DB failure → 503 so Novaryq retries.
 *    Dedupe key (per restaurant): the SIGNED envelope event name + `id` when present — stable across
 *    retries and not forgeable, unlike the unsigned delivery header (QA-C5) — else
 *    X-Novaryq-Idempotency-Key || X-Novaryq-Delivery (required either way).
 * 5. Process asynchronously: inline best-effort after storing, the novaryq-worker
 *    job owns correctness (retries, dead-letter).
 */
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { log } from '@/server/log';
import { readBodyCapped } from '@/server/pg/webhook-auth';
import { loadNovaryqConfig, novaryqFlagOn } from '@/server/novaryq/config';
import { processNovaryqDeliveryNow, verifyNovaryqSignature } from '@/server/novaryq/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 64 * 1024;
const notFound = () => new Response('Not found', { status: 404 });

export async function POST(req: NextRequest, { params }: { params: Promise<{ restaurantId: string }> }) {
  if (!novaryqFlagOn()) return notFound();
  const { restaurantId } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(restaurantId)) return notFound();

  const raw = await readBodyCapped(req, MAX_BYTES);
  if (raw === null) {
    log.warn({ restaurantId }, 'novaryq.webhook.too_large');
    return new Response('Payload too large', { status: 413 });
  }

  let cfg;
  try {
    cfg = await loadNovaryqConfig(restaurantId);
  } catch (e) {
    log.error({ restaurantId, err: (e as Error).message }, 'novaryq.webhook.config_failed');
    return new Response('Temporarily unavailable', { status: 503 });
  }
  if (!cfg?.enabled || !cfg.webhookSecret) return notFound();

  const v = verifyNovaryqSignature(raw, req.headers.get('x-novaryq-signature'), cfg.webhookSecret);
  if (!v.ok) {
    log.warn({ restaurantId, reason: v.reason }, 'novaryq.webhook.auth_failed');
    return new Response('Bad signature', { status: 401 });
  }

  const delivery = (req.headers.get('x-novaryq-idempotency-key') || req.headers.get('x-novaryq-delivery') || '').trim();
  if (!delivery || delivery.length > 200) return new Response('Missing X-Novaryq-Delivery', { status: 400 });

  let body: unknown;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  const envelope = (body ?? {}) as { id?: unknown; eventType?: unknown };
  const event = (req.headers.get('x-novaryq-event') || (typeof envelope.eventType === 'string' ? envelope.eventType : '') || 'unknown').slice(0, 100);
  const eventId = typeof envelope.id === 'string' && envelope.id.length <= 128 ? envelope.id : null;
  // Namespaced per restaurant so one tenant can never pre-empt another's ids.
  // The event name is part of the key so an alias delivery can never shadow the real event.
  const deliveryId = eventId ? `${restaurantId}:evt:${event}:${eventId}` : `${restaurantId}:${delivery}`;

  try {
    const r = await prisma.novaryqWebhookEvent.createMany({
      data: [{ restaurantId, deliveryId, event, payload: body as Prisma.InputJsonValue }],
      skipDuplicates: true,
    });
    if (r.count === 0) return Response.json({ ok: true, deduped: true });
  } catch (e) {
    log.error({ restaurantId, deliveryId, err: (e as Error).message }, 'novaryq.webhook.store_failed');
    return new Response('Temporarily unavailable', { status: 503 });
  }

  void processNovaryqDeliveryNow(deliveryId).catch((e) =>
    log.error({ deliveryId, err: (e as Error).message }, 'novaryq.webhook.inline_process_failed'),
  );
  return Response.json({ ok: true });
}
