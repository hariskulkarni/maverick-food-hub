/**
 * Flavrly PG transactional outbox (contract D3/D6, master prompt section 10).
 *
 * Producers call enqueueOutbox(tx, ...) inside the SAME transaction as the state
 * change it describes, so the intent commits or rolls back with it. runOutbox()
 * delivers rows to handlers from outbox-handlers.ts with the same lease /
 * backoff / dead-letter semantics as the inbound inbox (see inbox.ts).
 */
import { openException } from './exceptions';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { log } from '../log';
import { backoffMs, newLeaseOwner } from './job-lease';
import { outboxHandlers, type OutboxHandler } from './outbox-handlers';

export const OUTBOX_MAX_ATTEMPTS = 10;
export const OUTBOX_LEASE_MS = 2 * 60_000;
const BATCH = 25;

export interface OutboxMessage {
  topic: string;
  aggregateId: string;
  /** Logical identity of the side effect; a second enqueue with the same key is a no-op. */
  dedupeKey: string;
  payload: Prisma.InputJsonValue;
}

/**
 * Idempotent enqueue. Uses INSERT ... ON CONFLICT DO NOTHING (createMany
 * skipDuplicates) so a duplicate never raises a unique violation, which would
 * abort the caller's Postgres transaction. Returns true when a row was inserted.
 */
export async function enqueueOutbox(tx: Prisma.TransactionClient, msg: OutboxMessage): Promise<boolean> {
  const r = await tx.pgOutbox.createMany({
    data: [{ topic: msg.topic, aggregateId: msg.aggregateId, dedupeKey: msg.dedupeKey, payload: msg.payload }],
    skipDuplicates: true,
  });
  return r.count === 1;
}

interface OutboxRow {
  id: string;
  topic: string;
  aggregateId: string;
  dedupeKey: string;
  payload: Prisma.JsonValue;
  attempts: number;
}

export interface OutboxRunResult {
  claimed: number;
  done: number;
  retried: number;
  dead: number;
}

async function claimDue(owner: string, limit: number, leaseMs: number): Promise<OutboxRow[]> {
  return prisma.$queryRaw<OutboxRow[]>`
    UPDATE "PgOutbox" AS o
    SET "leaseOwner" = ${owner}, "leaseExpiresAt" = timezone('utc', now()) + ${leaseMs}::int * interval '1 millisecond',
        "attempts" = o."attempts" + 1
    WHERE o."id" IN (
      SELECT "id" FROM "PgOutbox"
      WHERE "status" = 'PENDING' AND "nextAttemptAt" <= timezone('utc', now())
        AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < timezone('utc', now()))
      ORDER BY "nextAttemptAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED)
    RETURNING o."id", o."topic", o."aggregateId", o."dedupeKey", o."payload", o."attempts"`;
}

function errText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500);
}

async function markDead(row: OutboxRow, owner: string, error: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const r = await tx.pgOutbox.updateMany({
      where: { id: row.id, leaseOwner: owner, status: 'PENDING' },
      data: { status: 'DEAD', leaseOwner: null, leaseExpiresAt: null, lastError: error },
    });
    if (r.count !== 1) return false;
    const dedupeKey = `OUTBOX_DEAD_LETTER:${row.id}`;
    await openException(tx, {
        kind: 'OUTBOX_DEAD_LETTER',
        dedupeKey,
        detail: { outboxId: row.id, topic: row.topic, aggregateId: row.aggregateId, attempts: row.attempts, lastError: error },
      });
    return true;
  });
}

async function handle(row: OutboxRow, owner: string, handlers: Record<string, OutboxHandler>): Promise<keyof Omit<OutboxRunResult, 'claimed'> | null> {
  if (row.attempts > OUTBOX_MAX_ATTEMPTS) {
    return (await markDead(row, owner, 'Attempt budget exhausted (worker crashed or lease expired)')) ? 'dead' : null;
  }
  try {
    const handler = handlers[row.topic];
    if (!handler) throw new Error(`No outbox handler registered for topic ${row.topic}`);
    await handler(row.payload, { id: row.id, topic: row.topic, aggregateId: row.aggregateId, attempts: row.attempts });
  } catch (e) {
    const error = errText(e);
    log.error({ outboxId: row.id, topic: row.topic, attempts: row.attempts, err: error }, 'pg.outbox.handler_failed');
    if (row.attempts >= OUTBOX_MAX_ATTEMPTS) return (await markDead(row, owner, error)) ? 'dead' : null;
    const r = await prisma.pgOutbox.updateMany({
      where: { id: row.id, leaseOwner: owner, status: 'PENDING' },
      data: { nextAttemptAt: new Date(Date.now() + backoffMs(row.attempts)), leaseOwner: null, leaseExpiresAt: null, lastError: error },
    });
    return r.count === 1 ? 'retried' : null;
  }
  const r = await prisma.pgOutbox.updateMany({
    where: { id: row.id, leaseOwner: owner, status: 'PENDING' },
    data: { status: 'DONE', doneAt: new Date(), leaseOwner: null, leaseExpiresAt: null, lastError: null },
  });
  return r.count === 1 ? 'done' : null;
}

/** Drains due outbox rows until none are due or `maxMs` elapses. `handlers` is injectable for tests. */
export async function runOutbox(
  opts: { leaseMs?: number; batch?: number; maxMs?: number; handlers?: Record<string, OutboxHandler> } = {},
): Promise<OutboxRunResult> {
  const leaseMs = opts.leaseMs ?? OUTBOX_LEASE_MS;
  const handlers = opts.handlers ?? outboxHandlers;
  const deadline = Date.now() + (opts.maxMs ?? 45_000);
  const owner = newLeaseOwner('outbox');
  const result: OutboxRunResult = { claimed: 0, done: 0, retried: 0, dead: 0 };
  while (Date.now() < deadline) {
    const rows = await claimDue(owner, opts.batch ?? BATCH, leaseMs);
    if (rows.length === 0) break;
    result.claimed += rows.length;
    for (const row of rows) {
      const o = await handle(row, owner, handlers);
      if (o) result[o] += 1;
    }
  }
  if (result.retried || result.dead) log.warn({ ...result }, 'pg.outbox.run');
  return result;
}

export async function outboxMetrics(): Promise<{ backlog: number; retrying: number; oldestPendingAgeSec: number; dead: number }> {
  const [row] = await prisma.$queryRaw<{ backlog: number; retrying: number; lag: number | null; dead: number }[]>`
    SELECT
      count(*) FILTER (WHERE "status" = 'PENDING')::int AS backlog,
      count(*) FILTER (WHERE "status" = 'PENDING' AND "attempts" > 0)::int AS retrying,
      EXTRACT(EPOCH FROM (timezone('utc', now()) - min("createdAt") FILTER (WHERE "status" = 'PENDING')))::float8 AS lag,
      count(*) FILTER (WHERE "status" = 'DEAD')::int AS dead
    FROM "PgOutbox"
    WHERE "status" IN ('PENDING', 'DEAD')`;
  return {
    backlog: row?.backlog ?? 0,
    retrying: row?.retrying ?? 0,
    oldestPendingAgeSec: Math.max(0, Math.round(row?.lag ?? 0)),
    dead: row?.dead ?? 0,
  };
}

/**
 * P1-5: an operator puts a DEAD outbox message back in the queue (attempts reset, due now). The
 * handler re-verifies everything (ORDER_RELEASE only releases CAPTURED money), so this cannot move
 * money by itself. Audited by the route; the ledger keeps an OUTBOX_REQUEUED event and the
 * OUTBOX_DEAD_LETTER exception is resolved with the actor.
 */
export async function requeueDeadOutbox(input: { id: string; actorId: string }): Promise<{ requeued: boolean }> {
  if (!input.actorId?.trim()) throw new Error('A signed-in operator is required.');
  return prisma.$transaction(async (tx) => {
    const row = await tx.pgOutbox.findUnique({ where: { id: input.id } });
    if (!row) throw new Error('Outbox message not found.');
    if (row.status !== 'DEAD') throw new Error(`Only a dead message can be requeued (this one is ${row.status}).`);
    const r = await tx.pgOutbox.updateMany({
      where: { id: row.id, status: 'DEAD' },
      data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), leaseOwner: null, leaseExpiresAt: null },
    });
    if (r.count !== 1) return { requeued: false };
    const { appendFinancialEvent } = await import('./ledger');
    await appendFinancialEvent(tx, {
      kind: 'OUTBOX_REQUEUED',
      orderId: row.topic === 'ORDER_RELEASE' ? row.aggregateId : null,
      actorId: input.actorId,
      data: { outboxId: row.id, topic: row.topic, previousAttempts: row.attempts, lastError: row.lastError },
    });
    await tx.pgReconException.updateMany({
      where: { dedupeKey: `OUTBOX_DEAD_LETTER:${row.id}`, status: { not: 'RESOLVED' } },
      data: { status: 'RESOLVED', resolution: 'Requeued by operator', resolvedById: input.actorId, resolvedAt: new Date() },
    });
    return { requeued: true };
  });
}
