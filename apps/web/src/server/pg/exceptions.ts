/**
 * Reconciliation exceptions (PgReconException): the operator work queue.
 * openException is idempotent by dedupeKey; resolveException records who resolved it.
 */
import { PgExceptionKind, PgExceptionStatus, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { appendFinancialEvent, type Tx } from './ledger';

export interface OpenExceptionInput {
  kind: PgExceptionKind;
  dedupeKey: string;
  restaurantId?: string | null;
  receivingAccountId?: string | null;
  attemptId?: string | null;
  orderId?: string | null;
  bankTransactionId?: string | null;
  amountPaise?: number | null;
  detail?: Prisma.InputJsonValue;
}

/** Open (or return the already-open) exception for `dedupeKey`. Safe inside a transaction. */
export async function openException(
  tx: Tx,
  input: OpenExceptionInput,
): Promise<{ id: string; created: boolean }> {
  const { count } = await tx.pgReconException.createMany({
    data: [
      {
        kind: input.kind,
        dedupeKey: input.dedupeKey,
        restaurantId: input.restaurantId ?? null,
        receivingAccountId: input.receivingAccountId ?? null,
        attemptId: input.attemptId ?? null,
        orderId: input.orderId ?? null,
        bankTransactionId: input.bankTransactionId ?? null,
        amountPaise: input.amountPaise ?? null,
        detail: input.detail,
      },
    ],
    skipDuplicates: true,
  });
  const row = await tx.pgReconException.findUniqueOrThrow({
    where: { dedupeKey: input.dedupeKey },
    select: { id: true },
  });
  if (count > 0) {
    await appendFinancialEvent(tx, {
      kind: 'EXCEPTION_OPENED',
      restaurantId: input.restaurantId,
      attemptId: input.attemptId,
      orderId: input.orderId,
      bankTransactionId: input.bankTransactionId,
      amountPaise: input.amountPaise,
      dedupeKey: `EXCEPTION_OPENED:${row.id}`,
      data: { exceptionId: row.id, kind: input.kind },
    });
  }
  return { id: row.id, created: count > 0 };
}

export interface ResolveExceptionInput {
  exceptionId: string;
  actorId: string;
  resolution: string;
  status?: Extract<PgExceptionStatus, 'ACKNOWLEDGED' | 'RESOLVED'>;
}

/** Acknowledge or resolve an exception. Requires a named actor and a written resolution. */
export async function resolveException(input: ResolveExceptionInput): Promise<{ id: string; status: PgExceptionStatus }> {
  const actorId = input.actorId?.trim();
  const resolution = input.resolution?.trim();
  if (!actorId) throw new Error('resolveException: actorId is required');
  if (!resolution) throw new Error('resolveException: resolution is required');
  const status = input.status ?? PgExceptionStatus.RESOLVED;

  return prisma.$transaction(async (tx) => {
    const ex = await tx.pgReconException.findUnique({ where: { id: input.exceptionId } });
    if (!ex) throw new Error(`resolveException: exception ${input.exceptionId} not found`);
    if (ex.status === PgExceptionStatus.RESOLVED) return { id: ex.id, status: ex.status };
    const updated = await tx.pgReconException.update({
      where: { id: ex.id },
      data: {
        status,
        resolution,
        resolvedById: status === PgExceptionStatus.RESOLVED ? actorId : null,
        resolvedAt: status === PgExceptionStatus.RESOLVED ? new Date() : null,
      },
    });
    await appendFinancialEvent(tx, {
      kind: status === PgExceptionStatus.RESOLVED ? 'EXCEPTION_RESOLVED' : 'EXCEPTION_ACKNOWLEDGED',
      restaurantId: ex.restaurantId,
      attemptId: ex.attemptId,
      orderId: ex.orderId,
      bankTransactionId: ex.bankTransactionId,
      actorId,
      data: { exceptionId: ex.id, kind: ex.kind, resolution },
    });
    return { id: updated.id, status: updated.status };
  });
}
