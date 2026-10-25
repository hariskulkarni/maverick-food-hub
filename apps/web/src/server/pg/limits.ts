/**
 * Flavrly PG limits (contract D9), keyed by RECEIVING ACCOUNT, not tenant.
 *
 * reserveLimit() runs inside the attempt-creation transaction AFTER the caller has locked the
 * receiving-account row (lockReceivingAccount), so the pending-count and velocity checks cannot
 * be raced by another starter on the same account. The daily counter is additionally guarded by
 * a conditional increment (WHERE reserved < limit), which is atomic on its own.
 *
 * releaseLimit() is only for attempts that provably never became payable (definitive create
 * rejection, or a gateway lookup proving no session exists). Never release while a remote
 * session may still be paid.
 */

import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export type PgLimitCode = 'AMOUNT_CAP' | 'DAILY_CAP' | 'PENDING_CAP' | 'CUSTOMER_VELOCITY';

export class PgLimitError extends Error {
  code: PgLimitCode;
  constructor(code: PgLimitCode, message: string) {
    super(message);
    this.name = 'PgLimitError';
    this.code = code;
  }
}

export type PgLimitConfig = {
  dailyLimit: number;
  maxAmountPaise: number;
  maxPendingPerAccount: number;
  customerMaxPending: number;
  customerWindowMinutes: number;
};

/** India business day (IST, UTC+05:30) as a UTC-midnight Date for the @db.Date column. */
export function istDay(now: Date = new Date()): Date {
  const t = new Date(now.getTime() + 330 * 60_000);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
}

/** Serialises attempt creation per receiving account for the rest of the transaction. */
export async function lockReceivingAccount(tx: Tx, receivingAccountId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "PgReceivingAccount" WHERE id = ${receivingAccountId} FOR UPDATE`;
  if (rows.length !== 1) throw new Error('Flavrly PG receiving account not found');
}

/** Attempts that hold (or may hold) a payable session right now. */
export function livePendingWhere(now: Date): Prisma.PgPaymentAttemptWhereInput {
  return {
    OR: [
      { state: { in: ['CREATED', 'CREATE_UNKNOWN'] } },
      { state: 'AWAITING_PAYMENT', OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    ],
  };
}

/**
 * Read-only dry run of reserveLimit() (P0-2): lets checkout refuse BEFORE an order is committed.
 * Not a reservation: the real, locked check still runs in createPgAttempt.
 */
export async function precheckLimit(
  db: Tx,
  args: { receivingAccountId: string; amountPaise: number; limits: PgLimitConfig; customerId: string; now?: Date },
): Promise<void> {
  const { receivingAccountId, amountPaise, limits } = args;
  const now = args.now ?? new Date();
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new PgLimitError('AMOUNT_CAP', 'Flavrly PG amount must be a positive integer number of paise');
  }
  if (amountPaise > limits.maxAmountPaise) {
    throw new PgLimitError('AMOUNT_CAP', `Direct UPI payments are limited to ₹${Math.floor(limits.maxAmountPaise / 100)} per order. Choose another payment method.`);
  }
  const since = new Date(now.getTime() - limits.customerWindowMinutes * 60_000);
  const orders = await db.order.findMany({
    where: { customerId: args.customerId, createdAt: { gte: new Date(now.getTime() - 24 * 3600_000) } },
    select: { id: true },
  });
  if (orders.length > 0) {
    const mine = await db.pgPaymentAttempt.count({
      where: { orderId: { in: orders.map((o) => o.id) }, createdAt: { gte: since }, ...livePendingWhere(now) },
    });
    if (mine >= limits.customerMaxPending) {
      throw new PgLimitError('CUSTOMER_VELOCITY', 'Too many pending payment attempts; please complete or wait for the previous one');
    }
  }
  const pending = await db.pgPaymentAttempt.count({ where: { receivingAccountId, ...livePendingWhere(now) } });
  if (pending >= limits.maxPendingPerAccount) {
    throw new PgLimitError('PENDING_CAP', 'Too many Flavrly PG payments are pending on this account; try again shortly');
  }
  const usage = await db.pgAccountDailyUsage.findUnique({
    where: { receivingAccountId_day: { receivingAccountId, day: istDay(now) } },
    select: { reserved: true },
  });
  if ((usage?.reserved ?? 0) >= limits.dailyLimit) {
    throw new PgLimitError('DAILY_CAP', 'Flavrly PG daily transaction cap reached for this account');
  }
}

export async function reserveLimit(
  tx: Tx,
  args: {
    attemptId: string;
    receivingAccountId: string;
    amountPaise: number;
    limits: PgLimitConfig;
    /** Order.customerId (User.phone is unique, so this also covers the customer's phone). */
    customerId: string;
    now?: Date;
  },
): Promise<void> {
  const { attemptId, receivingAccountId, amountPaise, limits } = args;
  const now = args.now ?? new Date();

  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new PgLimitError('AMOUNT_CAP', 'Flavrly PG amount must be a positive integer number of paise');
  }
  if (amountPaise > limits.maxAmountPaise) {
    throw new PgLimitError('AMOUNT_CAP', 'Flavrly PG max transaction amount exceeded');
  }

  // Per-customer velocity FIRST, so one customer cannot exhaust the account's capacity (T-11).
  const since = new Date(now.getTime() - limits.customerWindowMinutes * 60_000);
  const orders = await tx.order.findMany({
    where: { customerId: args.customerId, createdAt: { gte: new Date(now.getTime() - 24 * 3600_000) } },
    select: { id: true },
  });
  if (orders.length > 0) {
    const mine = await tx.pgPaymentAttempt.count({
      where: { orderId: { in: orders.map((o) => o.id) }, id: { not: attemptId }, createdAt: { gte: since }, ...livePendingWhere(now) },
    });
    if (mine >= limits.customerMaxPending) {
      throw new PgLimitError('CUSTOMER_VELOCITY', 'Too many pending payment attempts; please complete or wait for the previous one');
    }
  }

  const pending = await tx.pgPaymentAttempt.count({
    where: { receivingAccountId, id: { not: attemptId }, ...livePendingWhere(now) },
  });
  if (pending >= limits.maxPendingPerAccount) {
    throw new PgLimitError('PENDING_CAP', 'Too many Flavrly PG payments are pending on this account; try again shortly');
  }

  const day = istDay(now);
  await tx.pgAccountDailyUsage.createMany({ data: [{ receivingAccountId, day, reserved: 0 }], skipDuplicates: true });
  const inc = await tx.pgAccountDailyUsage.updateMany({
    where: { receivingAccountId, day, reserved: { lt: limits.dailyLimit } },
    data: { reserved: { increment: 1 } },
  });
  if (inc.count === 0) throw new PgLimitError('DAILY_CAP', 'Flavrly PG daily transaction cap reached for this account');

  await tx.pgLimitReservation.create({ data: { attemptId, receivingAccountId, day, amountPaise } });
}

/** Returns true when this call released the slot (idempotent). */
export async function releaseLimit(tx: Tx, attemptId: string): Promise<boolean> {
  const r = await tx.pgLimitReservation.findUnique({ where: { attemptId } });
  if (!r || r.state !== 'RESERVED') return false;
  const upd = await tx.pgLimitReservation.updateMany({
    where: { attemptId, state: 'RESERVED' },
    data: { state: 'RELEASED' },
  });
  if (upd.count === 0) return false;
  await tx.pgAccountDailyUsage.updateMany({
    where: { receivingAccountId: r.receivingAccountId, day: r.day, reserved: { gt: 0 } },
    data: { reserved: { decrement: 1 } },
  });
  return true;
}

/** Marks the reservation as permanently used (e.g. on capture). Idempotent. */
export async function consumeLimit(tx: Tx, attemptId: string): Promise<boolean> {
  const upd = await tx.pgLimitReservation.updateMany({
    where: { attemptId, state: 'RESERVED' },
    data: { state: 'CONSUMED' },
  });
  return upd.count > 0;
}
