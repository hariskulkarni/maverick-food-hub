/**
 * Flavrly PG reconciliation engine (contract D2/D3, master prompt §9-§10).
 *
 * - recordObservation(): gateway/observer evidence. Moves an attempt to OBSERVED at most.
 * - allocateBankCredit(): the ONLY writer of Payment.status = CAPTURED for youpi. One DB
 *   transaction, row locks on attempt -> bank txn -> order, invariant checks, then
 *   PgAllocation + txn ALLOCATED + attempt CAPTURED + Payment CAPTURED + PgFinancialEvent +
 *   PgOutbox(ORDER_RELEASE). Second credit for a paid order -> OVERCOLLECTION; credit for a
 *   dead attempt / cancelled order -> LATE_PAYMENT. Neither releases the order.
 * - tryAllocateForAttempt / tryAllocateBankTxn: find the single candidate and call it.
 * - Manual allocation requires two different users (propose + approve).
 * - recordReversal(): bank reversal of an allocated credit; never touches the order.
 */
import { enqueueOutbox } from './outbox';
import {
  OrderStatus,
  PaymentStatus,
  PgAllocationKind,
  PgAttemptState,
  PgBankSource,
  PgBankTxnStatus,
  PgEvidenceSource,
  PgExceptionKind,
  PgExceptionStatus,
  PgTxnDirection,
  Prisma,
} from '@prisma/client';
import { prisma } from '../db';
import { appendFinancialEvent, type Tx } from './ledger';
import { openException } from './exceptions';
import { normalizeBankReference } from './bank-source';

/** Bank credit must be dated within [attempt.createdAt - 10 min, attempt.createdAt + 48 h]. */
export const MATCH_WINDOW_BEFORE_MS = 10 * 60_000;
export const MATCH_WINDOW_AFTER_MS = 48 * 3_600_000;

const DEAD_ATTEMPT: PgAttemptState[] = [PgAttemptState.FAILED, PgAttemptState.EXPIRED, PgAttemptState.CANCELLED];
const CANCELLED_ORDER: OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.CANCELLED_BY_CUSTOMER,
  OrderStatus.CANCELLED_BY_RESTAURANT,
  OrderStatus.CANCELLED_BY_ADMIN,
  OrderStatus.PAYMENT_FAILED,
];
/** Interactive-transaction limits: allocation waits on row locks under contention. */
export const TX_OPTS = { maxWait: 10_000, timeout: 20_000 } as const;

/** Fork gateways ask for order amount + k paise, k in 0..99 (fork MAX_PAISE_OFFSET). */
export const MAX_GATEWAY_PAISE_OFFSET = 99;

const OBSERVABLE: PgAttemptState[] = [PgAttemptState.CREATED, PgAttemptState.AWAITING_PAYMENT, PgAttemptState.CREATE_UNKNOWN];

async function lockAttempt(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "PgPaymentAttempt" WHERE id = ${id} FOR UPDATE`;
  return tx.pgPaymentAttempt.findUnique({ where: { id }, include: { payment: true } });
}

// ───────────────────────────── observations ─────────────────────────────

export interface ObservationInput {
  attemptId: string;
  source: PgEvidenceSource;
  utr?: string | null;
  amountPaise?: number | null;
  /** Gateway-signed exact payable amount (order amount + fork paise offset, 0..99). */
  payableAmountPaise?: number | null;
  /** True only for HMAC-verified webhooks / merchant-authenticated status reads. */
  authenticated: boolean;
  eventAt?: Date | null;
  dedupeKey: string;
  meta?: Prisma.InputJsonValue;
  verificationMethod?: string;
}

export interface ObservationResult {
  evidenceId: string;
  duplicate: boolean;
  state: PgAttemptState;
  observedUtr: string | null;
}

/** Store evidence; authenticated + exact-amount evidence moves CREATED/AWAITING_PAYMENT -> OBSERVED. Never CAPTURED. */
export async function recordObservation(input: ObservationInput): Promise<ObservationResult> {
  const utr = input.utr ? normalizeBankReference(input.utr) || null : null;
  return prisma.$transaction(async (tx) => {
    const a = await lockAttempt(tx, input.attemptId);
    if (!a) throw new Error(`recordObservation: attempt ${input.attemptId} not found`);
    const amountOk = input.amountPaise == null || input.amountPaise === a.expectedAmountPaise;

    const { count } = await tx.pgPaymentEvidence.createMany({
      data: [
        {
          attemptId: a.id,
          restaurantId: a.restaurantId,
          receivingAccountId: a.receivingAccountId,
          gatewayPaymentId: a.gatewayPaymentId,
          source: input.source,
          utr,
          observedAmountPaise: input.amountPaise ?? null,
          currency: 'INR',
          sourceAuthenticated: input.authenticated,
          verificationMethod: input.verificationMethod ?? (input.authenticated ? 'authenticated' : 'unauthenticated'),
          eventAt: input.eventAt ?? null,
          matchConfidence: amountOk ? (utr ? 'UTR_AND_AMOUNT' : 'AMOUNT_ONLY') : 'AMOUNT_MISMATCH',
          dedupeKey: input.dedupeKey,
          meta: input.meta,
        },
      ],
      skipDuplicates: true,
    });
    const ev = await tx.pgPaymentEvidence.findUniqueOrThrow({ where: { dedupeKey: input.dedupeKey }, select: { id: true } });
    const unchanged = { evidenceId: ev.id, state: a.state, observedUtr: a.observedUtr };
    if (count === 0) return { ...unchanged, duplicate: true };

    await appendFinancialEvent(tx, {
      kind: 'EVIDENCE_RECORDED',
      restaurantId: a.restaurantId,
      attemptId: a.id,
      orderId: a.orderId,
      amountPaise: input.amountPaise ?? null,
      dedupeKey: `EVIDENCE_RECORDED:${ev.id}`,
      data: { source: input.source, authenticated: input.authenticated, hasUtr: !!utr },
    });

    if (!input.authenticated) return { ...unchanged, duplicate: false };
    const payable = input.payableAmountPaise;
    const payableOk =
      payable == null ||
      (payable >= a.expectedAmountPaise &&
        payable <= a.expectedAmountPaise + MAX_GATEWAY_PAISE_OFFSET &&
        (a.payableAmountPaise == null || a.payableAmountPaise === payable));
    if (!amountOk || !payableOk) {
      await openException(tx, {
        kind: PgExceptionKind.AMOUNT_MISMATCH,
        dedupeKey: `AMOUNT_MISMATCH:evidence:${ev.id}`,
        restaurantId: a.restaurantId,
        receivingAccountId: a.receivingAccountId,
        attemptId: a.id,
        orderId: a.orderId,
        amountPaise: input.amountPaise ?? null,
        detail: { expectedPaise: a.expectedAmountPaise, observedPaise: input.amountPaise ?? null, payablePaise: payable ?? null, source: input.source },
      });
      return { ...unchanged, duplicate: false };
    }
    if (utr && a.observedUtr && a.observedUtr !== utr) {
      await openException(tx, {
        kind: PgExceptionKind.AMBIGUOUS_MATCH,
        dedupeKey: `CONFLICTING_UTR:${a.id}:${utr}`,
        restaurantId: a.restaurantId,
        receivingAccountId: a.receivingAccountId,
        attemptId: a.id,
        orderId: a.orderId,
        detail: { reason: 'conflicting_utr_observation', source: input.source },
      });
      return { ...unchanged, duplicate: false };
    }

    const data: Prisma.PgPaymentAttemptUpdateInput = {};
    if (OBSERVABLE.includes(a.state)) data.state = PgAttemptState.OBSERVED;
    // A late observation on a dead attempt still records the UTR so a late bank credit can be
    // identified (and allocated as LATE_PAYMENT), but the attempt state does not change.
    if (utr && !a.observedUtr) data.observedUtr = utr;
    if (input.payableAmountPaise != null && a.payableAmountPaise == null) data.payableAmountPaise = input.payableAmountPaise;
    if (Object.keys(data).length === 0) return { ...unchanged, duplicate: false };
    if (data.observedUtr) {
      // A status SUCCESS that raced ahead of the UTR-bearing webhook opened MISSING_UTR; close it.
      await tx.pgReconException.updateMany({
        where: { dedupeKey: `MISSING_UTR:${a.id}`, status: { not: PgExceptionStatus.RESOLVED } },
        data: { status: PgExceptionStatus.RESOLVED, resolution: 'UTR observed later (automatic)', resolvedAt: new Date() },
      });
    }
    const u = await tx.pgPaymentAttempt.update({ where: { id: a.id }, data });
    await appendFinancialEvent(tx, {
      kind: 'ATTEMPT_OBSERVED',
      restaurantId: a.restaurantId,
      attemptId: a.id,
      orderId: a.orderId,
      dedupeKey: `ATTEMPT_OBSERVED:${ev.id}`,
      data: { from: a.state, to: u.state, utrSet: !!data.observedUtr },
    });
    return { evidenceId: ev.id, duplicate: false, state: u.state, observedUtr: u.observedUtr };
  }, TX_OPTS);
}

// ───────────────────────────── allocation ─────────────────────────────

export type AllocationOutcome =
  | 'CAPTURED'
  | 'OVERCOLLECTION'
  | 'LATE_PAYMENT'
  | 'ALREADY_ALLOCATED'
  | 'REJECTED'
  | 'NO_CANDIDATE'
  | 'AMBIGUOUS'
  | 'NO_UTR';

export interface AllocationResult {
  outcome: AllocationOutcome;
  allocationId?: string;
  reason?: string;
  exceptionId?: string;
}

export interface AllocateInput {
  attemptId: string;
  bankTransactionId: string;
  /** Manual (dual-control) allocation: operator evidence replaces the UTR/time-window match. */
  manual?: { createdById: string; approvedById: string; reason: string };
}

function inWindow(valueAt: Date, createdAt: Date): boolean {
  const t = valueAt.getTime();
  const c = createdAt.getTime();
  return t >= c - MATCH_WINDOW_BEFORE_MS && t <= c + MATCH_WINDOW_AFTER_MS;
}

/**
 * The single writer of Payment.status = CAPTURED for Flavrly PG (contract D3).
 * Idempotent: concurrent calls for the same credit serialize on the row locks and all but one
 * return ALREADY_ALLOCATED; the DB unique indexes are the final backstop.
 */
export async function allocateBankCredit(input: AllocateInput): Promise<AllocationResult> {
  const manual = input.manual;
  if (manual) {
    if (!manual.createdById?.trim() || !manual.approvedById?.trim() || !manual.reason?.trim()) {
      throw new Error('manual allocation requires createdById, approvedById and reason');
    }
    if (manual.createdById === manual.approvedById) {
      throw new Error('manual allocation requires a second approver different from the operator');
    }
  }

  return prisma.$transaction(async (tx) => {
    const a = await lockAttempt(tx, input.attemptId);
    if (!a) throw new Error(`allocateBankCredit: attempt ${input.attemptId} not found`);
    await tx.$queryRaw`SELECT id FROM "PgBankTransaction" WHERE id = ${input.bankTransactionId} FOR UPDATE`;
    const t = await tx.pgBankTransaction.findUnique({ where: { id: input.bankTransactionId } });
    if (!t) throw new Error(`allocateBankCredit: bank transaction ${input.bankTransactionId} not found`);
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${a.orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id: a.orderId }, select: { id: true, status: true } });

    if (t.status === PgBankTxnStatus.ALLOCATED) {
      const existing = await tx.pgAllocation.findUnique({ where: { bankTransactionId: t.id }, select: { id: true } });
      return { outcome: 'ALREADY_ALLOCATED', allocationId: existing?.id, reason: 'bank transaction already allocated' };
    }

    const ctx = {
      restaurantId: a.restaurantId,
      receivingAccountId: a.receivingAccountId,
      attemptId: a.id,
      orderId: a.orderId,
      bankTransactionId: t.id,
      amountPaise: t.amountPaise,
    };
    const reject = async (kind: PgExceptionKind, reason: string, extra: Record<string, unknown> = {}) => {
      const ex = await openException(tx, {
        ...ctx,
        kind,
        dedupeKey: `${kind}:${t.id}:${a.id}`,
        detail: { reason, ...extra } as Prisma.InputJsonValue,
      });
      return { outcome: 'REJECTED' as const, reason, exceptionId: ex.id };
    };

    // ── invariants (master prompt §9 MATCHING INVARIANTS) ──
    if (t.status !== PgBankTxnStatus.UNMATCHED) return reject(PgExceptionKind.AMBIGUOUS_MATCH, `bank transaction is ${t.status}`);
    if (t.source === PgBankSource.MANUAL && !t.approvedById) {
      return reject(PgExceptionKind.AMBIGUOUS_MATCH, 'manual bank entry not approved');
    }
    if (t.receivingAccountId !== a.receivingAccountId) return reject(PgExceptionKind.WRONG_ACCOUNT, 'different receiving account');
    if (t.direction !== PgTxnDirection.CREDIT) return reject(PgExceptionKind.AMBIGUOUS_MATCH, 'not a credit');
    if (t.currency !== 'INR' || a.currency !== 'INR') return reject(PgExceptionKind.AMOUNT_MISMATCH, 'currency is not INR');
    if (t.amountPaise !== (a.payableAmountPaise ?? a.expectedAmountPaise)) {
      return reject(PgExceptionKind.AMOUNT_MISMATCH, 'amount differs from expected', {
        expectedPaise: a.expectedAmountPaise,
        creditPaise: t.amountPaise,
      });
    }
    if (!manual) {
      if (!a.observedUtr) return reject(PgExceptionKind.MISSING_UTR, 'attempt has no observed UTR');
      if (t.bankReference !== a.observedUtr) return reject(PgExceptionKind.AMBIGUOUS_MATCH, 'bank reference differs from observed UTR');
      if (!inWindow(t.valueAt, a.createdAt)) return reject(PgExceptionKind.LATE_PAYMENT, 'credit outside the match time window');
    }

    // ── classify ──
    const live = await tx.pgAllocation.findFirst({
      where: { orderId: a.orderId, kind: PgAllocationKind.ORDER_PAYMENT, reversedAt: null },
      select: { id: true },
    });
    const otherCaptured = await tx.payment.findFirst({
      where: { orderId: a.orderId, id: { not: a.paymentId }, status: PaymentStatus.CAPTURED },
      select: { id: true },
    });
    const late = DEAD_ATTEMPT.includes(a.state) || !order || CANCELLED_ORDER.includes(order.status);
    const kind: PgAllocationKind = late
      ? PgAllocationKind.LATE_PAYMENT
      : live || otherCaptured || a.state === PgAttemptState.CAPTURED
        ? PgAllocationKind.OVERCOLLECTION
        : PgAllocationKind.ORDER_PAYMENT;

    const alloc = await tx.pgAllocation.create({
      data: {
        bankTransactionId: t.id,
        attemptId: a.id,
        orderId: a.orderId,
        kind,
        amountPaise: t.amountPaise,
        createdById: manual?.createdById ?? null,
        approvedById: manual?.approvedById ?? null,
      },
      select: { id: true },
    });
    await tx.pgBankTransaction.update({ where: { id: t.id }, data: { status: PgBankTxnStatus.ALLOCATED } });
    await appendFinancialEvent(tx, {
      kind: `ALLOCATION_${kind}`,
      restaurantId: a.restaurantId,
      attemptId: a.id,
      orderId: a.orderId,
      bankTransactionId: t.id,
      allocationId: alloc.id,
      amountPaise: t.amountPaise,
      actorId: manual?.approvedById ?? null,
      dedupeKey: `ALLOCATION:${alloc.id}`,
      data: {
        bankReference: t.bankReference,
        source: t.source,
        manual: manual ? { createdById: manual.createdById, reason: manual.reason } : null,
      },
    });

    if (kind !== PgAllocationKind.ORDER_PAYMENT) {
      const exKind = kind === PgAllocationKind.LATE_PAYMENT ? PgExceptionKind.LATE_PAYMENT : PgExceptionKind.OVERCOLLECTION;
      const ex = await openException(tx, {
        ...ctx,
        kind: exKind,
        dedupeKey: `${exKind}:${alloc.id}`,
        detail: {
          reason: late ? 'attempt dead or order cancelled' : 'order already has a live payment',
          attemptState: a.state,
          orderStatus: order?.status ?? null,
          refundRequired: true,
        },
      });
      return { outcome: kind, allocationId: alloc.id, exceptionId: ex.id };
    }

    await tx.pgPaymentAttempt.update({ where: { id: a.id }, data: { state: PgAttemptState.CAPTURED } });
    const pay = await tx.payment.updateMany({
      where: { id: a.paymentId, status: { in: [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED] } },
      data: { status: PaymentStatus.CAPTURED },
    });
    if (pay.count !== 1) throw new Error(`allocateBankCredit: payment ${a.paymentId} is ${a.payment.status}, cannot capture`);
    await appendFinancialEvent(tx, {
      kind: 'PAYMENT_CAPTURED',
      restaurantId: a.restaurantId,
      attemptId: a.id,
      orderId: a.orderId,
      bankTransactionId: t.id,
      allocationId: alloc.id,
      amountPaise: t.amountPaise,
      actorId: manual?.approvedById ?? null,
      dedupeKey: `PAYMENT_CAPTURED:${a.paymentId}`,
      data: { paymentId: a.paymentId },
    });
    await enqueueOutbox(tx, {
      topic: 'ORDER_RELEASE',
      aggregateId: a.orderId,
      dedupeKey: `ORDER_RELEASE:${a.orderId}`,
      payload: { orderId: a.orderId, attemptId: a.id, paymentId: a.paymentId },
    });
    return { outcome: 'CAPTURED', allocationId: alloc.id };
  }, TX_OPTS);
}

/** Allocate the (single) bank credit whose reference equals the attempt's observed UTR. */
export async function tryAllocateForAttempt(attemptId: string): Promise<AllocationResult> {
  const a = await prisma.pgPaymentAttempt.findUnique({ where: { id: attemptId } });
  if (!a) throw new Error(`tryAllocateForAttempt: attempt ${attemptId} not found`);
  if (!a.observedUtr) {
    const ex = await openException(prisma, {
      kind: PgExceptionKind.MISSING_UTR,
      dedupeKey: `MISSING_UTR:${a.id}`,
      restaurantId: a.restaurantId,
      receivingAccountId: a.receivingAccountId,
      attemptId: a.id,
      orderId: a.orderId,
      detail: { reason: 'no authenticated UTR observed for attempt', state: a.state },
    });
    return { outcome: 'NO_UTR', exceptionId: ex.id };
  }
  const t = await prisma.pgBankTransaction.findUnique({
    where: {
      receivingAccountId_direction_bankReference: {
        receivingAccountId: a.receivingAccountId,
        direction: PgTxnDirection.CREDIT,
        bankReference: a.observedUtr,
      },
    },
    select: { id: true },
  });
  if (!t) return { outcome: 'NO_CANDIDATE', reason: 'no bank credit with this reference yet' };
  return tryAllocateBankTxn(t.id);
}

/** Find the single attempt this credit belongs to (same account + observed UTR) and allocate. */
export async function tryAllocateBankTxn(bankTransactionId: string): Promise<AllocationResult> {
  const t = await prisma.pgBankTransaction.findUnique({
    where: { id: bankTransactionId },
    include: { receivingAccount: { select: { restaurantId: true } } },
  });
  if (!t) throw new Error(`tryAllocateBankTxn: ${bankTransactionId} not found`);
  if (t.status === PgBankTxnStatus.ALLOCATED) return { outcome: 'ALREADY_ALLOCATED' };
  if (t.status !== PgBankTxnStatus.UNMATCHED || t.direction !== PgTxnDirection.CREDIT) {
    return { outcome: 'NO_CANDIDATE', reason: `bank transaction is ${t.direction}/${t.status}` };
  }
  const candidates = await prisma.pgPaymentAttempt.findMany({
    where: { receivingAccountId: t.receivingAccountId, observedUtr: t.bankReference },
    select: { id: true },
    take: 5,
  });
  if (candidates.length === 0) return { outcome: 'NO_CANDIDATE', reason: 'no attempt observed this reference' };
  if (candidates.length > 1) {
    const ex = await openException(prisma, {
      kind: PgExceptionKind.AMBIGUOUS_MATCH,
      dedupeKey: `AMBIGUOUS_MATCH:${t.id}`,
      restaurantId: t.receivingAccount.restaurantId,
      receivingAccountId: t.receivingAccountId,
      bankTransactionId: t.id,
      amountPaise: t.amountPaise,
      detail: { reason: 'several attempts observed this reference', attemptIds: candidates.map((c) => c.id) },
    });
    return { outcome: 'AMBIGUOUS', exceptionId: ex.id };
  }
  return allocateBankCredit({ attemptId: candidates[0].id, bankTransactionId: t.id });
}

// ───────────────────────────── manual allocation (dual control) ─────────────────────────────

/** Step 1: an operator proposes allocating a credit to an attempt. Stored as an append-only event. */
export async function proposeManualAllocation(input: {
  attemptId: string;
  bankTransactionId: string;
  operatorId: string;
  reason: string;
}): Promise<{ proposalId: string }> {
  if (!input.operatorId?.trim() || !input.reason?.trim()) throw new Error('operatorId and reason are required');
  const [a, t] = await Promise.all([
    prisma.pgPaymentAttempt.findUnique({ where: { id: input.attemptId } }),
    prisma.pgBankTransaction.findUnique({ where: { id: input.bankTransactionId } }),
  ]);
  if (!a || !t) throw new Error('proposeManualAllocation: attempt or bank transaction not found');
  if (a.receivingAccountId !== t.receivingAccountId) throw new Error('proposeManualAllocation: different receiving account');
  const ev = await appendFinancialEvent(prisma, {
    kind: 'MANUAL_ALLOCATION_PROPOSED',
    restaurantId: a.restaurantId,
    attemptId: a.id,
    orderId: a.orderId,
    bankTransactionId: t.id,
    amountPaise: t.amountPaise,
    actorId: input.operatorId,
    data: { reason: input.reason },
  });
  return { proposalId: ev.id };
}

/** Step 2: a DIFFERENT user approves; the allocation then runs through allocateBankCredit. */
export async function approveManualAllocation(input: { proposalId: string; approverId: string }): Promise<AllocationResult> {
  const p = await prisma.pgFinancialEvent.findUnique({ where: { id: input.proposalId } });
  if (!p || p.kind !== 'MANUAL_ALLOCATION_PROPOSED' || !p.attemptId || !p.bankTransactionId || !p.actorId) {
    throw new Error('approveManualAllocation: proposal not found');
  }
  const reason = String((p.data as { reason?: unknown } | null)?.reason ?? '');
  return allocateBankCredit({
    attemptId: p.attemptId,
    bankTransactionId: p.bankTransactionId,
    manual: { createdById: p.actorId, approvedById: input.approverId, reason },
  });
}

// ───────────────────────────── reversal ─────────────────────────────

/** Bank reversed a credit: mark allocation reversed + txn REVERSED, open REVERSAL exception. Order untouched. */
export async function recordReversal(input: {
  bankTransactionId: string;
  reason: string;
  actorId: string;
}): Promise<{ reversed: boolean; exceptionId?: string }> {
  if (!input.actorId?.trim() || !input.reason?.trim()) throw new Error('recordReversal: actorId and reason are required');
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PgBankTransaction" WHERE id = ${input.bankTransactionId} FOR UPDATE`;
    const t = await tx.pgBankTransaction.findUnique({
      where: { id: input.bankTransactionId },
      include: { allocation: true, receivingAccount: { select: { restaurantId: true } } },
    });
    if (!t) throw new Error(`recordReversal: ${input.bankTransactionId} not found`);
    if (t.status === PgBankTxnStatus.REVERSED) return { reversed: false };
    const now = new Date();
    if (t.allocation && !t.allocation.reversedAt) {
      await tx.pgAllocation.update({
        where: { id: t.allocation.id },
        data: { reversedAt: now, reversalReason: input.reason },
      });
    }
    await tx.pgBankTransaction.update({ where: { id: t.id }, data: { status: PgBankTxnStatus.REVERSED } });
    await appendFinancialEvent(tx, {
      kind: 'BANK_TXN_REVERSED',
      restaurantId: t.receivingAccount.restaurantId,
      attemptId: t.allocation?.attemptId ?? null,
      orderId: t.allocation?.orderId ?? null,
      bankTransactionId: t.id,
      allocationId: t.allocation?.id ?? null,
      amountPaise: t.amountPaise,
      actorId: input.actorId,
      dedupeKey: `BANK_TXN_REVERSED:${t.id}`,
      data: { reason: input.reason, allocationKind: t.allocation?.kind ?? null },
    });
    const ex = await openException(tx, {
      kind: PgExceptionKind.REVERSAL,
      dedupeKey: `REVERSAL:${t.id}`,
      restaurantId: t.receivingAccount.restaurantId,
      receivingAccountId: t.receivingAccountId,
      attemptId: t.allocation?.attemptId ?? null,
      orderId: t.allocation?.orderId ?? null,
      bankTransactionId: t.id,
      amountPaise: t.amountPaise,
      detail: { reason: input.reason, allocationKind: t.allocation?.kind ?? null, orderUntouched: true },
    });
    return { reversed: true, exceptionId: ex.id };
  }, TX_OPTS);
}
