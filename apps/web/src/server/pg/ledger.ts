/**
 * Append-only financial event log (PgFinancialEvent). The table rejects UPDATE/DELETE
 * via a trigger (migration 20261024000100); this module only ever inserts.
 */
import { Prisma } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

export interface FinancialEventInput {
  kind: string;
  restaurantId?: string | null;
  attemptId?: string | null;
  orderId?: string | null;
  bankTransactionId?: string | null;
  allocationId?: string | null;
  refundId?: string | null;
  amountPaise?: number | null;
  actorId?: string | null;
  /** When set, a second append with the same key is a no-op (returns the first event). */
  dedupeKey?: string | null;
  data?: Prisma.InputJsonValue;
}

/** Append one event inside the caller's transaction. Idempotent when `dedupeKey` is given. */
export async function appendFinancialEvent(tx: Tx, e: FinancialEventInput): Promise<{ id: string }> {
  const data = {
    kind: e.kind,
    restaurantId: e.restaurantId ?? null,
    attemptId: e.attemptId ?? null,
    orderId: e.orderId ?? null,
    bankTransactionId: e.bankTransactionId ?? null,
    allocationId: e.allocationId ?? null,
    refundId: e.refundId ?? null,
    amountPaise: e.amountPaise ?? null,
    actorId: e.actorId ?? null,
    dedupeKey: e.dedupeKey ?? null,
    data: e.data,
  };
  if (!e.dedupeKey) return tx.pgFinancialEvent.create({ data, select: { id: true } });
  // INSERT ... ON CONFLICT DO NOTHING: safe under concurrency, never aborts the transaction.
  await tx.pgFinancialEvent.createMany({ data: [data], skipDuplicates: true });
  return tx.pgFinancialEvent.findUniqueOrThrow({ where: { dedupeKey: e.dedupeKey }, select: { id: true } });
}
