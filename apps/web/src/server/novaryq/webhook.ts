/**
 * Novaryq inbound webhooks (CONTRACT §5): signature check, inbox processing.
 *
 * The route stores every verified delivery in NovaryqWebhookEvent (deduped on
 * `${restaurantId}:${X-Novaryq-Idempotency-Key}`) before answering 200; this module
 * processes stored rows — inline best-effort right after the 200, and from the
 * novaryq-worker job, which owns correctness. A claim bumps `attempts` and pushes
 * `nextAttemptAt` out by the lease, so the inline path and the worker never run the
 * same row at once; completion is fenced on the claimed attempt number.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { log } from '../log';
import { applyOrderStatusEvent } from './status';
import { applyAvailabilityEvent } from './menu';
import { pushBackoffMs } from './push';
import { sendNovaryqAlert } from './alerts';

export const WEBHOOK_MAX_SKEW_SEC = 300;
export const WEBHOOK_MAX_ATTEMPTS = 8;
const LEASE_MS = 2 * 60_000;
const BATCH = 50;

export type SignatureCheck = { ok: true; t: number } | { ok: false; reason: 'missing' | 'malformed' | 'stale' | 'mismatch' | 'no_secret' };

/** `X-Novaryq-Signature: t=<sec>,v1=<hex>[,v1=<hex>]` = HMAC_SHA256(webhookSecret, `${t}.${rawBody}`). */
export function verifyNovaryqSignature(raw: Buffer, header: string | null, secret: string, nowMs = Date.now()): SignatureCheck {
  if (!secret) return { ok: false, reason: 'no_secret' };
  if (!header) return { ok: false, reason: 'missing' };
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.trim().split('=', 2);
    if (k === 't' && /^\d+$/.test(v ?? '')) t = Number(v);
    else if (k === 'v1' && v) v1.push(v);
  }
  if (t === null || v1.length === 0) return { ok: false, reason: 'malformed' };
  if (Math.abs(nowMs / 1000 - t) > WEBHOOK_MAX_SKEW_SEC) return { ok: false, reason: 'stale' };
  const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.`).update(raw).digest('hex'));
  const hit = v1.some((sig) => {
    const got = Buffer.from(sig);
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  return hit ? { ok: true, t } : { ok: false, reason: 'mismatch' };
}

export interface ClaimedEvent {
  id: string;
  restaurantId: string;
  deliveryId: string;
  event: string;
  payload: Prisma.JsonValue;
  attempts: number;
  receivedAt: Date;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

/**
 * Novaryq's envelope carries the event data in `data` (mirrored in `payload`) next to
 * `eventId/id, eventType, occurredAt`; a bare payload is accepted too.
 */
function eventData(body: unknown): Obj {
  if (!isObj(body)) return {};
  const inner = isObj(body.data) ? body.data : isObj(body.payload) ? body.payload : null;
  return inner ? { ...inner, occurredAt: inner.occurredAt ?? body.occurredAt } : body;
}

/** Events Flavrly acts on (NQ-API-FINAL §4). Legacy aliases (order.sent/closed/updated) are stored and ignored (NQ-2). */
const STATUS_EVENTS = new Set(['order.status_changed']);
const AVAILABILITY_EVENTS = new Set(['menu.item.availability_changed', 'menu.item.86ed', 'menu.item.restored']);

export async function routeNovaryqEvent(ev: ClaimedEvent): Promise<string> {
  // Novaryq console "Send test": proves the webhook leg; shown as "last webhook received".
  if (ev.event === 'webhook.test') return 'test_received';
  const p = eventData(ev.payload);
  const occurredAt = str(p.occurredAt) ?? ev.receivedAt.toISOString();

  if (AVAILABILITY_EVENTS.has(ev.event)) {
    const itemCode = str(p.itemCode);
    const available = typeof p.available === 'boolean' ? p.available : ev.event === 'menu.item.86ed' ? false : ev.event === 'menu.item.restored' ? true : null;
    if (!itemCode || available === null) return 'ignored:malformed';
    return applyAvailabilityEvent({
      restaurantId: ev.restaurantId, itemCode, available, locationId: str(p.locationId), occurredAt: new Date(occurredAt),
    });
  }

  if (STATUS_EVENTS.has(ev.event)) {
    const status = str(p.status) ?? str(p.to);
    if (!status || !(str(p.externalRef) || str(p.orderId))) return 'ignored:malformed';
    if (str(p.source) && p.source !== 'flavrly') return 'ignored:other_source';
    let externalRef = str(p.externalRef);
    if (!externalRef) {
      const sync = await prisma.novaryqOrderSync.findFirst({
        where: { restaurantId: ev.restaurantId, novaryqOrderId: str(p.orderId)! },
        select: { orderId: true },
      });
      if (!sync) return 'ignored:unknown_order';
      externalRef = sync.orderId;
    }
    return applyOrderStatusEvent({ restaurantId: ev.restaurantId, externalRef, orderId: str(p.orderId), status, occurredAt });
  }
  return 'ignored:unhandled';
}

export async function handleClaimedEvent(ev: ClaimedEvent): Promise<'done' | 'retried' | 'dead'> {
  const fence = { id: ev.id, attempts: ev.attempts, processedAt: null };
  try {
    const outcome = await routeNovaryqEvent(ev);
    await prisma.novaryqWebhookEvent.updateMany({
      where: fence,
      data: { processedAt: new Date(), error: outcome.startsWith('ignored:') ? outcome : null },
    });
    return 'done';
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    log.warn({ eventId: ev.id, event: ev.event, attempts: ev.attempts, err: error }, 'novaryq.webhook.process_failed');
    if (ev.attempts >= WEBHOOK_MAX_ATTEMPTS) {
      await prisma.novaryqWebhookEvent.updateMany({ where: fence, data: { processedAt: new Date(), error: `dead: ${error}` } });
      await sendNovaryqAlert({
        restaurantId: ev.restaurantId,
        kind: 'webhook_dead',
        entityId: ev.id,
        subject: 'A Novaryq update could not be applied in Flavrly',
        text: `Event ${ev.event} (${ev.deliveryId}) failed ${ev.attempts} times: ${error}`,
      });
      return 'dead';
    }
    await prisma.novaryqWebhookEvent.updateMany({
      where: fence,
      data: { error, nextAttemptAt: new Date(Date.now() + pushBackoffMs(ev.attempts)) },
    });
    return 'retried';
  }
}

async function claim(limit: number, deliveryId?: string): Promise<ClaimedEvent[]> {
  const only = deliveryId ? Prisma.sql`AND "deliveryId" = ${deliveryId}` : Prisma.empty;
  return prisma.$queryRaw<ClaimedEvent[]>`
    UPDATE "NovaryqWebhookEvent" AS e
    SET "attempts" = e."attempts" + 1,
        "nextAttemptAt" = timezone('utc', now()) + ${LEASE_MS}::int * interval '1 millisecond'
    WHERE e."id" IN (
      SELECT "id" FROM "NovaryqWebhookEvent"
      WHERE "processedAt" IS NULL AND "nextAttemptAt" <= timezone('utc', now()) ${only}
      ORDER BY "receivedAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED)
    RETURNING e."id", e."restaurantId", e."deliveryId", e."event", e."payload", e."attempts", e."receivedAt"`;
}

/** Inline, best-effort processing right after the route stored the delivery. */
export async function processNovaryqDeliveryNow(deliveryId: string): Promise<void> {
  const [ev] = await claim(1, deliveryId);
  if (ev) await handleClaimedEvent(ev);
}

export async function runNovaryqWebhookWorker(opts: { maxMs?: number } = {}): Promise<{ claimed: number; done: number; retried: number; dead: number }> {
  const deadline = Date.now() + (opts.maxMs ?? 30_000);
  const out = { claimed: 0, done: 0, retried: 0, dead: 0 };
  while (Date.now() < deadline) {
    const rows = await claim(BATCH);
    if (rows.length === 0) break;
    out.claimed += rows.length;
    for (const ev of rows) out[await handleClaimedEvent(ev)] += 1;
  }
  return out;
}
