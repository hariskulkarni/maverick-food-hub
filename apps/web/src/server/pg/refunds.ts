/**
 * Flavrly PG refunds for direct-to-merchant UPI (contract D13, master prompt §12).
 *
 * The money sits in the restaurant's own bank account, and the YouPI gateway has
 * no refund API (`provider.refund()` stays UNSUPPORTED). So a refund is a human
 * bank transfer:
 *
 *   requestPgRefund  -> Refund PENDING + PgRefundRecord(MANUAL_BANK, requestedById)
 *   approvePgRefund  -> a DIFFERENT user approves (two-person rule)
 *   completePgRefund -> a human enters the bank's refund reference (UTR/RRN) + evidence;
 *                       only then is the Refund COMPLETED. Nothing here invents a reference.
 *   failPgRefund     -> Refund FAILED + REFUND_FAILED exception for the operator queue.
 *
 * Refundable pots are the bank-confirmed allocations of the attempt, per kind:
 * ORDER -> ORDER_PAYMENT, OVERCOLLECTION -> OVERCOLLECTION, LATE_PAYMENT -> LATE_PAYMENT.
 * Each request takes `SELECT ... FOR UPDATE` on the attempt row, so concurrent
 * requests serialise and the sum of non-FAILED refunds can never exceed the pot.
 *
 * WALLET credit instead of a bank refund is possible only when
 * FLAVRLY_PG_ALLOW_WALLET_REFUND=true AND the admin explicitly picks it.
 */
import {
  OrderStatus,
  PaymentStatus,
  PgAllocationKind,
  PgAttemptState,
  PgExceptionKind,
  PgRefundMethod,
  Prisma,
  RefundDestination,
  RefundStatus,
} from '@prisma/client';
import { prisma } from '../db';
import { audit } from '../audit';
import { log } from '../log';
import { transitionOrder } from '../orders';
import { paiseToInrString } from './money';

type Tx = Prisma.TransactionClient;

export type PgRefundKind = 'ORDER' | 'OVERCOLLECTION' | 'LATE_PAYMENT';
export type PgRefundMethodChoice = 'MANUAL_BANK' | 'WALLET';

export interface PgActor {
  id: string;
  role?: string | null;
}

export class PgRefundError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface PgRefundView {
  refundId: string;
  attemptId: string;
  orderId: string;
  kind: PgRefundKind;
  method: PgRefundMethodChoice;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  approved: boolean;
  amountPaise: number;
  bankReference: string | null;
  /** True when this call matched an earlier identical request/completion (idempotent replay). */
  replay: boolean;
}

const POT: Record<PgRefundKind, PgAllocationKind> = {
  ORDER: PgAllocationKind.ORDER_PAYMENT,
  OVERCOLLECTION: PgAllocationKind.OVERCOLLECTION,
  LATE_PAYMENT: PgAllocationKind.LATE_PAYMENT,
};

/** Same statuses the legacy refund engine accepts for an order refund. */
const ORDER_REFUNDABLE: OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.DELIVERY_FAILED,
  OrderStatus.CANCELLED,
  OrderStatus.CANCELLED_BY_CUSTOMER,
  OrderStatus.CANCELLED_BY_RESTAURANT,
  OrderStatus.CANCELLED_BY_ADMIN,
  OrderStatus.REFUND_PENDING,
  OrderStatus.REFUND_INITIATED,
];
const IN_REFUND_FUNNEL: OrderStatus[] = [OrderStatus.REFUND_PENDING, OrderStatus.REFUND_INITIATED];

const TX_OPTS = { maxWait: 15_000, timeout: 20_000 } as const;

export function walletRefundAllowed(): boolean {
  return process.env.FLAVRLY_PG_ALLOW_WALLET_REFUND === 'true';
}

/** A bank refund reference typed by a human: trimmed, uppercased, 6-35 letters/digits. Null when invalid. */
export function normalizeRefundReference(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toUpperCase();
  return /^[A-Z0-9]{6,35}$/.test(s) ? s : null;
}

// ── Ledger/exception writes. Local until Agent C's pg/ledger.ts + pg/exceptions.ts merge;
//    same shape as appendFinancialEvent / openException so the lead can swap them 1:1. ──

async function appendEvent(
  tx: Tx,
  e: { kind: string; restaurantId: string; attemptId: string; orderId: string; refundId: string; amountPaise: number; actorId: string; dedupeKey: string; data?: Prisma.InputJsonValue },
): Promise<void> {
  await tx.pgFinancialEvent.createMany({ data: [e], skipDuplicates: true });
}

async function openRefundFailedException(
  tx: Tx,
  e: { restaurantId: string; attemptId: string; orderId: string; amountPaise: number; refundId: string; reason: string },
): Promise<void> {
  await tx.pgReconException.upsert({
    where: { dedupeKey: `${PgExceptionKind.REFUND_FAILED}:${e.refundId}` },
    update: {},
    create: {
      kind: PgExceptionKind.REFUND_FAILED,
      dedupeKey: `${PgExceptionKind.REFUND_FAILED}:${e.refundId}`,
      restaurantId: e.restaurantId,
      attemptId: e.attemptId,
      orderId: e.orderId,
      amountPaise: e.amountPaise,
      detail: { refundId: e.refundId, reason: e.reason },
    },
  });
}

// ── helpers ──

async function lockAttempt(tx: Tx, attemptId: string) {
  await tx.$queryRaw`SELECT id FROM "PgPaymentAttempt" WHERE id = ${attemptId} FOR UPDATE`;
  return tx.pgPaymentAttempt.findUnique({ where: { id: attemptId } });
}

interface RefundMeta {
  pgKind: PgRefundKind;
  method: PgRefundMethodChoice;
  idempotencyKey: string | null;
}

function metaOf(providerData: Prisma.JsonValue | null): RefundMeta | null {
  const d = providerData as Record<string, unknown> | null;
  if (!d || d.rail !== 'DIRECT_TO_MERCHANT' || typeof d.pgKind !== 'string') return null;
  return {
    pgKind: d.pgKind as PgRefundKind,
    method: (d.method as PgRefundMethodChoice) ?? 'MANUAL_BANK',
    idempotencyKey: typeof d.idempotencyKey === 'string' ? d.idempotencyKey : null,
  };
}

async function potPaise(tx: Tx, attemptId: string, kind: PgRefundKind): Promise<number> {
  const agg = await tx.pgAllocation.aggregate({
    where: { attemptId, kind: POT[kind], reversedAt: null },
    _sum: { amountPaise: true },
  });
  return agg._sum.amountPaise ?? 0;
}

/** All PG refund records on the attempt with their Refund row and parsed meta. */
async function refundsOfAttempt(tx: Tx, attemptId: string) {
  const recs = await tx.pgRefundRecord.findMany({ where: { attemptId }, include: { refund: true } });
  return recs.map((r) => ({ rec: r, meta: metaOf(r.refund.providerData) })).filter((x) => x.meta);
}

function view(
  rec: { refundId: string; attemptId: string | null; amountPaise: number; approvedById: string | null; bankReference: string | null },
  refund: { orderId: string; status: RefundStatus },
  meta: RefundMeta,
  replay = false,
): PgRefundView {
  return {
    refundId: rec.refundId,
    attemptId: rec.attemptId ?? '',
    orderId: refund.orderId,
    kind: meta.pgKind,
    method: meta.method,
    status: refund.status,
    approved: !!rec.approvedById,
    amountPaise: rec.amountPaise,
    bankReference: rec.bankReference,
    replay,
  };
}

/** Best-effort order refund-funnel move, same convention as legacy refundOrder(). */
async function advanceOrder(orderId: string, next: OrderStatus, actorId: string, note: string) {
  try {
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
    if (!order || order.status === next) return;
    if (next !== OrderStatus.REFUND_PENDING && !IN_REFUND_FUNNEL.includes(order.status)) {
      await transitionOrder(orderId, OrderStatus.REFUND_PENDING, { actorId, note });
    }
    await transitionOrder(orderId, next, { actorId, note });
  } catch (e) {
    log.error({ err: (e as Error).message, orderId }, 'pg refund: order status advance failed (refund row is the source of truth)');
  }
}

async function resolveAttemptId(input: { orderId?: string; attemptId?: string; kind: PgRefundKind }): Promise<string> {
  if (input.attemptId) return input.attemptId;
  if (!input.orderId) throw new PgRefundError('orderId or attemptId is required.');
  const allocs = await prisma.pgAllocation.findMany({
    where: { orderId: input.orderId, kind: POT[input.kind], reversedAt: null, attemptId: { not: null } },
    select: { attemptId: true },
  });
  const ids = [...new Set(allocs.map((a) => a.attemptId!))];
  if (ids.length === 0) {
    throw new PgRefundError(
      `No bank-confirmed ${POT[input.kind]} money exists for this order, so there is nothing to refund. ` +
        'A gateway "success" alone is not proof the restaurant received the money.',
      409,
    );
  }
  if (ids.length > 1) throw new PgRefundError('Several payment attempts hold money for this order; pass attemptId.', 409);
  return ids[0];
}

// ── public API ──

export interface RequestPgRefundInput {
  orderId?: string;
  attemptId?: string;
  amountPaise: number;
  reason: string;
  actor: PgActor;
  kind: PgRefundKind;
  /** Default MANUAL_BANK. WALLET only if FLAVRLY_PG_ALLOW_WALLET_REFUND=true and chosen explicitly. */
  method?: PgRefundMethodChoice;
  /** Masked customer VPA / account the refund should go to (never the full account number). */
  destinationRef?: string | null;
  /** Same key on a re-submit returns the first refund instead of creating another. */
  idempotencyKey?: string | null;
  /** Tenant guard for merchant-scoped callers: the attempt must belong to this restaurant. */
  scopeRestaurantId?: string;
}

export async function requestPgRefund(input: RequestPgRefundInput): Promise<PgRefundView> {
  const actorId = input.actor?.id?.trim();
  if (!actorId) throw new PgRefundError('A signed-in requester is required.', 401);
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new PgRefundError('Refund amount must be a positive whole number of paise.');
  }
  const reason = input.reason?.trim();
  if (!reason) throw new PgRefundError('A refund reason is required.');
  if (!POT[input.kind]) throw new PgRefundError('Unknown refund kind.');
  const method: PgRefundMethodChoice = input.method ?? 'MANUAL_BANK';
  if (method !== 'MANUAL_BANK' && method !== 'WALLET') throw new PgRefundError('Unknown refund method.');
  if (method === 'WALLET' && !walletRefundAllowed()) {
    throw new PgRefundError(
      'Wallet credit is not allowed for direct-UPI (Flavrly PG) payments: the money is in the restaurant\'s bank account. ' +
        'Request a manual bank refund instead.',
      403,
    );
  }
  const idempotencyKey = input.idempotencyKey?.trim() || null;
  const attemptId = await resolveAttemptId(input);

  const out = await prisma.$transaction(async (tx) => {
    const a = await lockAttempt(tx, attemptId);
    if (!a || (input.scopeRestaurantId && a.restaurantId !== input.scopeRestaurantId)) {
      throw new PgRefundError('Payment attempt not found.', 404);
    }
    if (input.orderId && a.orderId !== input.orderId) throw new PgRefundError('Attempt does not belong to this order.');

    const existing = await refundsOfAttempt(tx, a.id);
    if (idempotencyKey) {
      const hit = existing.find((x) => x.meta!.idempotencyKey === idempotencyKey);
      if (hit) {
        if (hit.rec.amountPaise !== input.amountPaise || hit.meta!.pgKind !== input.kind) {
          throw new PgRefundError('This idempotency key was already used for a different refund.', 409);
        }
        return { v: view(hit.rec, hit.rec.refund, hit.meta!, true), a };
      }
    }

    if (input.kind === 'ORDER') {
      const order = await tx.order.findUnique({ where: { id: a.orderId }, select: { status: true } });
      if (!order) throw new PgRefundError('Order not found.', 404);
      if (!ORDER_REFUNDABLE.includes(order.status)) {
        throw new PgRefundError(`Order in status ${order.status} cannot be refunded; cancel it first.`);
      }
    }

    const pot = await potPaise(tx, a.id, input.kind);
    if (pot <= 0) {
      throw new PgRefundError(`No bank-confirmed ${POT[input.kind]} money on this attempt, so there is nothing to refund.`, 409);
    }
    const used = existing
      .filter((x) => x.meta!.pgKind === input.kind && x.rec.refund.status !== RefundStatus.FAILED)
      .reduce((s, x) => s + x.rec.amountPaise, 0);
    if (used + input.amountPaise > pot) {
      throw new PgRefundError(
        `Refund exceeds the refundable ${POT[input.kind]} balance (${paiseToInrString(Math.max(0, pot - used))} INR left).`,
        409,
      );
    }

    const meta: RefundMeta = { pgKind: input.kind, method, idempotencyKey };
    const refund = await tx.refund.create({
      data: {
        orderId: a.orderId,
        paymentId: a.paymentId,
        amount: paiseToInrString(input.amountPaise),
        reason,
        destination: method === 'WALLET' ? RefundDestination.WALLET : RefundDestination.ORIGINAL_PAYMENT,
        // PENDING = recorded, NOT sent. Completion needs a human-entered bank reference.
        status: RefundStatus.PENDING,
        createdById: actorId,
        providerData: { provider: 'youpi', rail: 'DIRECT_TO_MERCHANT', manual: true, ...meta },
      },
    });
    const rec = await tx.pgRefundRecord.create({
      data: {
        refundId: refund.id,
        attemptId: a.id,
        method: method === 'WALLET' ? PgRefundMethod.WALLET : PgRefundMethod.MANUAL_BANK,
        amountPaise: input.amountPaise,
        destinationRef: input.destinationRef?.trim() || null,
        requestedById: actorId,
      },
    });
    await appendEvent(tx, {
      kind: 'REFUND_REQUESTED',
      restaurantId: a.restaurantId,
      attemptId: a.id,
      orderId: a.orderId,
      refundId: refund.id,
      amountPaise: input.amountPaise,
      actorId,
      dedupeKey: `REFUND_REQUESTED:${refund.id}`,
      data: { kind: input.kind, method, reason },
    });
    return { v: view(rec, refund, meta), a };
  }, TX_OPTS);

  if (!out.v.replay) {
    if (input.kind === 'ORDER') await advanceOrder(out.a.orderId, OrderStatus.REFUND_PENDING, actorId, reason);
    await audit('order.refund', {
      actorId,
      actorRole: input.actor.role ?? undefined,
      entityType: 'Refund',
      entityId: out.v.refundId,
      after: { stage: 'pg.requested', ...out.v },
    }).catch(() => {});
  }
  return out.v;
}

/** Load + lock a PG refund for a state change. */
async function loadForUpdate(tx: Tx, refundId: string, scopeRestaurantId?: string) {
  const first = await tx.pgRefundRecord.findUnique({ where: { refundId }, select: { attemptId: true } });
  if (!first?.attemptId) throw new PgRefundError('Flavrly PG refund not found.', 404);
  const a = await lockAttempt(tx, first.attemptId);
  if (!a || (scopeRestaurantId && a.restaurantId !== scopeRestaurantId)) throw new PgRefundError('Flavrly PG refund not found.', 404);
  const rec = await tx.pgRefundRecord.findUniqueOrThrow({ where: { refundId }, include: { refund: true } });
  const meta = metaOf(rec.refund.providerData);
  if (!meta) throw new PgRefundError('Flavrly PG refund not found.', 404);
  return { a, rec, meta };
}

export async function approvePgRefund(input: { refundId: string; actor: PgActor; scopeRestaurantId?: string }): Promise<PgRefundView> {
  const actorId = input.actor?.id?.trim();
  if (!actorId) throw new PgRefundError('A signed-in approver is required.', 401);
  const out = await prisma.$transaction(async (tx) => {
    const { a, rec, meta } = await loadForUpdate(tx, input.refundId, input.scopeRestaurantId);
    if (rec.refund.status !== RefundStatus.PENDING) throw new PgRefundError(`Refund is already ${rec.refund.status}.`, 409);
    if (rec.approvedById) return view(rec, rec.refund, meta, true);
    if (rec.requestedById === actorId) {
      throw new PgRefundError('A refund must be approved by a different person than the one who requested it.', 403);
    }
    const upd = await tx.pgRefundRecord.update({ where: { id: rec.id }, data: { approvedById: actorId } });
    await appendEvent(tx, {
      kind: 'REFUND_APPROVED',
      restaurantId: a.restaurantId,
      attemptId: a.id,
      orderId: a.orderId,
      refundId: rec.refundId,
      amountPaise: rec.amountPaise,
      actorId,
      dedupeKey: `REFUND_APPROVED:${rec.refundId}`,
    });
    return view(upd, rec.refund, meta);
  }, TX_OPTS);
  if (!out.replay) {
    await audit('order.refund', { actorId, actorRole: input.actor.role ?? undefined, entityType: 'Refund', entityId: out.refundId, after: { stage: 'pg.approved', ...out } }).catch(() => {});
  }
  return out;
}

export interface CompletePgRefundInput {
  refundId: string;
  /** The bank's refund UTR/RRN, typed by the person who made the transfer. Required for MANUAL_BANK. */
  bankReference?: string | null;
  /** Redacted proof: what was checked and where the proof lives. Never raw statements/secrets. */
  evidence: { note: string; attachmentRef?: string | null };
  actor: PgActor;
  scopeRestaurantId?: string;
}

export async function completePgRefund(input: CompletePgRefundInput): Promise<PgRefundView> {
  const actorId = input.actor?.id?.trim();
  if (!actorId) throw new PgRefundError('A signed-in user is required.', 401);
  const note = input.evidence?.note?.trim();
  if (!note) throw new PgRefundError('Describe the refund evidence (what was checked, where the proof is).');

  const out = await prisma.$transaction(async (tx) => {
    const { a, rec, meta } = await loadForUpdate(tx, input.refundId, input.scopeRestaurantId);
    const bankReference = meta.method === 'MANUAL_BANK' ? normalizeRefundReference(input.bankReference) : null;
    if (meta.method === 'MANUAL_BANK' && !bankReference) {
      throw new PgRefundError('Enter the bank refund reference (UTR/RRN): 6-35 letters or digits, exactly as the bank shows it.');
    }
    if (rec.refund.status === RefundStatus.COMPLETED) {
      if (rec.bankReference === bankReference) return { v: view(rec, rec.refund, meta, true), fullOrder: false };
      throw new PgRefundError('Refund is already completed with a different bank reference.', 409);
    }
    if (rec.refund.status === RefundStatus.FAILED) throw new PgRefundError('Refund has failed; request a new one.', 409);
    if (!rec.approvedById) throw new PgRefundError('Refund needs approval by a second person before it can be completed.', 409);
    if (bankReference) {
      const reused = await tx.pgRefundRecord.findFirst({ where: { bankReference, id: { not: rec.id } }, select: { refundId: true } });
      if (reused) throw new PgRefundError('That bank reference is already recorded on another refund.', 409);
    }

    if (meta.method === 'WALLET') {
      const order = await tx.order.findUniqueOrThrow({ where: { id: a.orderId }, select: { customerId: true, code: true } });
      const amount = paiseToInrString(rec.amountPaise);
      const wallet = await tx.wallet.upsert({
        where: { userId: order.customerId },
        update: { balance: { increment: amount } },
        create: { userId: order.customerId, balance: amount },
      });
      await tx.walletTransaction.create({
        data: { walletId: wallet.id, orderId: a.orderId, type: 'REFUND', amount, note: `Refund for order ${order.code ?? a.orderId}` },
      });
    }

    const refund = await tx.refund.update({
      where: { id: rec.refundId },
      data: { status: RefundStatus.COMPLETED, providerRef: bankReference },
    });
    const upd = await tx.pgRefundRecord.update({
      where: { id: rec.id },
      data: {
        bankReference,
        completedById: actorId,
        completedAt: new Date(),
        evidence: { note, attachmentRef: input.evidence.attachmentRef?.trim() || null },
      },
    });

    let fullOrder = false;
    if (meta.pgKind === 'ORDER') {
      const pot = await potPaise(tx, a.id, 'ORDER');
      const done = (await refundsOfAttempt(tx, a.id))
        .filter((x) => x.meta!.pgKind === 'ORDER' && x.rec.refund.status === RefundStatus.COMPLETED)
        .reduce((s, x) => s + x.rec.amountPaise, 0);
      fullOrder = done >= pot;
      await tx.pgPaymentAttempt.update({
        where: { id: a.id },
        data: { state: fullOrder ? PgAttemptState.REFUNDED : PgAttemptState.REFUND_PENDING },
      });
      if (fullOrder) {
        await tx.payment.updateMany({
          where: { id: a.paymentId, status: PaymentStatus.CAPTURED },
          data: { status: PaymentStatus.REFUNDED },
        });
      }
    }
    await appendEvent(tx, {
      kind: 'REFUND_COMPLETED',
      restaurantId: a.restaurantId,
      attemptId: a.id,
      orderId: a.orderId,
      refundId: rec.refundId,
      amountPaise: rec.amountPaise,
      actorId,
      dedupeKey: `REFUND_COMPLETED:${rec.refundId}`,
      data: { kind: meta.pgKind, method: meta.method, bankReference, fullOrder },
    });
    return { v: view(upd, refund, meta), fullOrder };
  }, TX_OPTS);

  if (!out.v.replay) {
    if (out.v.kind === 'ORDER') {
      await advanceOrder(out.v.orderId, out.fullOrder ? OrderStatus.REFUNDED : OrderStatus.REFUND_INITIATED, actorId, 'Manual bank refund completed');
    }
    await audit('order.refund', { actorId, actorRole: input.actor.role ?? undefined, entityType: 'Refund', entityId: out.v.refundId, after: { stage: 'pg.completed', ...out.v } }).catch(() => {});
  }
  return out.v;
}

export async function failPgRefund(input: { refundId: string; reason: string; actor: PgActor; scopeRestaurantId?: string }): Promise<PgRefundView> {
  const actorId = input.actor?.id?.trim();
  if (!actorId) throw new PgRefundError('A signed-in user is required.', 401);
  const reason = input.reason?.trim();
  if (!reason) throw new PgRefundError('A failure reason is required.');
  const out = await prisma.$transaction(async (tx) => {
    const { a, rec, meta } = await loadForUpdate(tx, input.refundId, input.scopeRestaurantId);
    if (rec.refund.status === RefundStatus.FAILED) return view(rec, rec.refund, meta, true);
    if (rec.refund.status === RefundStatus.COMPLETED) throw new PgRefundError('A completed refund cannot be marked failed; book a reversal instead.', 409);
    const refund = await tx.refund.update({ where: { id: rec.refundId }, data: { status: RefundStatus.FAILED } });
    const upd = await tx.pgRefundRecord.update({ where: { id: rec.id }, data: { failureReason: reason } });
    await appendEvent(tx, {
      kind: 'REFUND_FAILED',
      restaurantId: a.restaurantId,
      attemptId: a.id,
      orderId: a.orderId,
      refundId: rec.refundId,
      amountPaise: rec.amountPaise,
      actorId,
      dedupeKey: `REFUND_FAILED:${rec.refundId}`,
      data: { reason },
    });
    await openRefundFailedException(tx, {
      restaurantId: a.restaurantId,
      attemptId: a.id,
      orderId: a.orderId,
      amountPaise: rec.amountPaise,
      refundId: rec.refundId,
      reason,
    });
    return view(upd, refund, meta);
  }, TX_OPTS);
  if (!out.replay) {
    await audit('order.refund', { actorId, actorRole: input.actor.role ?? undefined, entityType: 'Refund', entityId: out.refundId, after: { stage: 'pg.failed', ...out, reason } }).catch(() => {});
  }
  return out;
}
