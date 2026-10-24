/**
 * Flavrly PG durable inbound webhook inbox (contract D10).
 *
 * The webhook route only authenticates and durably inserts a PaymentWebhookEvent
 * (provider 'youpi'). This worker processes those rows at-least-once:
 *
 *  - claim: one statement, `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)`,
 *    sets leaseOwner/leaseExpiresAt and increments `attempts` (a crash therefore
 *    still consumes an attempt, so a poison row cannot crash-loop forever);
 *  - an expired lease makes the row claimable again (crash recovery);
 *  - every finish write is fenced on `leaseOwner`, so a worker whose lease was
 *    taken over cannot overwrite the new owner's outcome;
 *  - transient outcome -> nextAttemptAt = now + bounded exponential backoff with jitter;
 *  - after MAX_ATTEMPTS -> deadLetteredAt + PgReconException WEBHOOK_DEAD_LETTER;
 *  - processed=true only on a definitive outcome. "processed" means the
 *    notification was consumed; it NEVER means money was received.
 *
 * The body's status is never acted on: processing records the authenticated
 * UTR/amount as an observation and asks the gateway/ledger (reconcile).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { log } from '../log';
import { reconcileYoupiPayment, type YoupiReconcileOutcome } from '../payments/youpi-reconcile';
import { backoffMs, newLeaseOwner } from './job-lease';
import { parseWebhookBody } from './webhook-auth';

export const INBOX_MAX_ATTEMPTS = 8;
export const INBOX_LEASE_MS = 2 * 60_000;
const BATCH = 25;

export interface InboxEvent {
  id: string;
  providerEventId: string | null;
  paymentId: string | null;
  orderId: string | null;
  restaurantId: string | null;
  eventType: string;
  rawPayload: Prisma.JsonValue;
  attempts: number;
}

export interface InboxRunResult {
  claimed: number;
  processed: number;
  retried: number;
  deadLettered: number;
}

/** What the webhook contributes as evidence. Pure; the dedupe key is the delivery. */
export function webhookObservation(ev: InboxEvent) {
  const body = parseWebhookBody(ev.rawPayload);
  return {
    source: 'GATEWAY_WEBHOOK' as const,
    sourceAuthenticated: true,
    verificationMethod: 'HMAC_SHA256_TIMESTAMPED',
    restaurantId: ev.restaurantId,
    gatewayPaymentId: body.gatewayPaymentId,
    attemptKey: body.attemptKey,
    eventType: body.bodyEventType ?? ev.eventType,
    utr: body.utr,
    amountPaise: body.amountPaise,
    dedupeKey: `webhook:${ev.providerEventId ?? ev.id}`,
  };
}

/**
 * Integration seam (owned here so the lead can swap it at integration):
 * record the webhook's UTR/amount via Agent C's `recordObservation()` in
 * pg/reconcile-engine.ts, then reconcile. Until that exists it only reconciles
 * through the gateway status API, exactly as before.
 */
export async function applyWebhookObservation(ev: InboxEvent, paymentId: string): Promise<YoupiReconcileOutcome> {
  // Lead, at integration: `await recordObservation({ ...webhookObservation(ev), paymentId });`
  return reconcileYoupiPayment(paymentId);
}

/** Maps signed-and-stored identifiers to our Payment. Routing hints only, never proof. */
async function resolveLocalPayment(ev: InboxEvent): Promise<{ id: string; providerRef: string | null } | null> {
  const gatewayRef = ev.paymentId;
  const attemptRef = ev.orderId;
  const attempt =
    gatewayRef || attemptRef
      ? await prisma.pgPaymentAttempt.findFirst({
          where: {
            OR: [
              ...(attemptRef ? [{ attemptKey: attemptRef }] : []),
              ...(gatewayRef ? [{ gatewayPaymentId: gatewayRef }] : []),
            ],
          },
          select: { payment: { select: { id: true, providerRef: true } } },
        })
      : null;
  if (attempt) return attempt.payment;
  return (
    (gatewayRef
      ? await prisma.payment.findFirst({
          where: { providerName: 'youpi', providerRef: gatewayRef },
          select: { id: true, providerRef: true },
        })
      : null) ??
    (attemptRef
      ? await prisma.payment.findFirst({
          where: { providerName: 'youpi', providerRef: attemptRef },
          orderBy: { createdAt: 'desc' },
          select: { id: true, providerRef: true },
        })
      : null) ??
    // Old YouPI checkouts used internal Order.id rather than an attempt key.
    (attemptRef
      ? await prisma.payment.findFirst({
          where: { providerName: 'youpi', orderId: attemptRef },
          orderBy: { createdAt: 'desc' },
          select: { id: true, providerRef: true },
        })
      : null)
  );
}

class Retryable extends Error {}

/** Throws Retryable/Error for a non-definitive outcome. */
async function processEvent(ev: InboxEvent): Promise<void> {
  const payment = await resolveLocalPayment(ev);
  if (!payment) throw new Retryable('Unmatched local payment; needs reconciliation');
  if (ev.paymentId && ev.orderId && payment.providerRef === ev.orderId) {
    // The webhook outran the create response: repair the locally seeded attempt
    // ref, never replacing an unrelated gateway ref.
    await prisma.payment.updateMany({
      where: { id: payment.id, providerName: 'youpi', status: 'PENDING', providerRef: ev.orderId },
      data: { providerRef: ev.paymentId },
    });
  }
  const outcome = await applyWebhookObservation(ev, payment.id);
  if (outcome.indeterminate) throw new Retryable('Gateway verification indeterminate; retry scheduled');
}

const RETURNING = Prisma.sql`RETURNING e."id", e."providerEventId", e."paymentId", e."orderId", e."restaurantId",
  e."eventType", e."rawPayload", e."attempts"`;

async function claimDue(owner: string, limit: number, leaseMs: number): Promise<InboxEvent[]> {
  return prisma.$queryRaw<InboxEvent[]>`
    UPDATE "PaymentWebhookEvent" AS e
    SET "leaseOwner" = ${owner}, "leaseExpiresAt" = timezone('utc', now()) + ${leaseMs}::int * interval '1 millisecond',
        "attempts" = e."attempts" + 1
    WHERE e."id" IN (
      SELECT "id" FROM "PaymentWebhookEvent"
      WHERE "provider" = 'youpi' AND "processed" = false AND "deadLetteredAt" IS NULL
        AND COALESCE("nextAttemptAt", "createdAt") <= timezone('utc', now())
        AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < timezone('utc', now()))
      ORDER BY COALESCE("nextAttemptAt", "createdAt")
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED)
    ${RETURNING}`;
}

async function claimOne(id: string, owner: string, leaseMs: number): Promise<InboxEvent | null> {
  const rows = await prisma.$queryRaw<InboxEvent[]>`
    UPDATE "PaymentWebhookEvent" AS e
    SET "leaseOwner" = ${owner}, "leaseExpiresAt" = timezone('utc', now()) + ${leaseMs}::int * interval '1 millisecond',
        "attempts" = e."attempts" + 1
    WHERE e."id" IN (
      SELECT "id" FROM "PaymentWebhookEvent"
      WHERE "id" = ${id} AND "provider" = 'youpi' AND "processed" = false AND "deadLetteredAt" IS NULL
        AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < timezone('utc', now()))
      FOR UPDATE SKIP LOCKED)
    ${RETURNING}`;
  return rows[0] ?? null;
}

function errText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500);
}

async function deadLetter(ev: InboxEvent, owner: string, error: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const r = await tx.paymentWebhookEvent.updateMany({
      where: { id: ev.id, leaseOwner: owner, processed: false },
      data: { deadLetteredAt: new Date(), leaseOwner: null, leaseExpiresAt: null, error },
    });
    if (r.count !== 1) return false;
    const dedupeKey = `WEBHOOK_DEAD_LETTER:${ev.id}`;
    await tx.pgReconException.upsert({
      where: { dedupeKey },
      create: {
        kind: 'WEBHOOK_DEAD_LETTER',
        restaurantId: ev.restaurantId,
        dedupeKey,
        detail: { webhookEventId: ev.id, providerEventId: ev.providerEventId, attempts: ev.attempts, lastError: error },
      },
      update: {},
    });
    return true;
  });
}

type Outcome = 'processed' | 'retried' | 'deadLettered' | 'lost';

async function handleClaimed(ev: InboxEvent, owner: string): Promise<Outcome> {
  if (ev.attempts > INBOX_MAX_ATTEMPTS) {
    // The previous holder died mid-attempt on its last try.
    return (await deadLetter(ev, owner, 'Attempt budget exhausted (worker crashed or lease expired)')) ? 'deadLettered' : 'lost';
  }
  try {
    await processEvent(ev);
  } catch (e) {
    const error = errText(e);
    if (!(e instanceof Retryable)) log.error({ eventId: ev.id, err: error }, 'pg.inbox.process_error');
    if (ev.attempts >= INBOX_MAX_ATTEMPTS) {
      const dl = await deadLetter(ev, owner, error);
      if (dl) log.error({ eventId: ev.id, attempts: ev.attempts }, 'pg.inbox.dead_letter');
      return dl ? 'deadLettered' : 'lost';
    }
    const r = await prisma.paymentWebhookEvent.updateMany({
      where: { id: ev.id, leaseOwner: owner, processed: false },
      data: { nextAttemptAt: new Date(Date.now() + backoffMs(ev.attempts)), leaseOwner: null, leaseExpiresAt: null, error },
    });
    return r.count === 1 ? 'retried' : 'lost';
  }
  const r = await prisma.paymentWebhookEvent.updateMany({
    where: { id: ev.id, leaseOwner: owner, processed: false },
    data: { processed: true, processedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, error: null },
  });
  return r.count === 1 ? 'processed' : 'lost';
}

/** Drains due inbox rows until none are due or `maxMs` elapses. */
export async function runInbox(opts: { leaseMs?: number; batch?: number; maxMs?: number } = {}): Promise<InboxRunResult> {
  const leaseMs = opts.leaseMs ?? INBOX_LEASE_MS;
  const deadline = Date.now() + (opts.maxMs ?? 45_000);
  const owner = newLeaseOwner('inbox');
  const result: InboxRunResult = { claimed: 0, processed: 0, retried: 0, deadLettered: 0 };
  while (Date.now() < deadline) {
    const rows = await claimDue(owner, opts.batch ?? BATCH, leaseMs);
    if (rows.length === 0) break;
    result.claimed += rows.length;
    for (const ev of rows) {
      const o = await handleClaimed(ev, owner);
      if (o !== 'lost') result[o] += 1;
    }
  }
  if (result.retried || result.deadLettered) log.warn({ ...result }, 'pg.inbox.run');
  return result;
}

/**
 * Best-effort immediate processing of one freshly stored event (used inline by
 * the webhook route after commit). Correctness never depends on it: if the
 * claim is lost or this throws, the worker picks the row up.
 */
export async function processInboxEventNow(id: string): Promise<Outcome | 'not_claimed'> {
  const owner = newLeaseOwner('inbox-inline');
  const ev = await claimOne(id, owner, INBOX_LEASE_MS);
  if (!ev) return 'not_claimed';
  return handleClaimed(ev, owner);
}

export async function inboxMetrics(): Promise<{ pending: number; retrying: number; oldestPendingAgeSec: number; deadLettered: number }> {
  const [row] = await prisma.$queryRaw<{ pending: number; retrying: number; lag: number | null; dead: number }[]>`
    SELECT
      count(*) FILTER (WHERE "deadLetteredAt" IS NULL)::int AS pending,
      count(*) FILTER (WHERE "deadLetteredAt" IS NULL AND "attempts" > 0)::int AS retrying,
      EXTRACT(EPOCH FROM (timezone('utc', now()) - min("createdAt") FILTER (WHERE "deadLetteredAt" IS NULL)))::float8 AS lag,
      count(*) FILTER (WHERE "deadLetteredAt" IS NOT NULL)::int AS dead
    FROM "PaymentWebhookEvent"
    WHERE "provider" = 'youpi' AND "processed" = false`;
  return {
    pending: row?.pending ?? 0,
    retrying: row?.retrying ?? 0,
    oldestPendingAgeSec: Math.max(0, Math.round(row?.lag ?? 0)),
    deadLettered: row?.dead ?? 0,
  };
}
