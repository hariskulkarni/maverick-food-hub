/**
 * Dual-control ops actions for Flavrly PG (round-2 audit P1-2, P1-3, P1-4).
 *
 *   propose (SUPER_ADMIN A)  -> append-only PgFinancialEvent `<ACTION>_PROPOSED`
 *   approve (SUPER_ADMIN B)  -> `<ACTION>_APPROVED` + the action, in ONE transaction
 *   reject  (anyone, incl. A) -> `<ACTION>_REJECTED`
 *
 * A proposal is decided exactly once: the decision event carries dedupeKey `<ACTION>_DECIDED:<id>`
 * (unique), so a second approve/reject, or an approve racing a reject, cannot both commit. The
 * approver must differ from the proposer. Routes add an audit() entry for every step.
 *
 * Actions:
 *   LATE_ACCEPT  — accept a LATE_PAYMENT credit for an unpaid, not-cancelled order. Approval only
 *                  opens a RELEASE_HELD exception: the restaurant must still confirm (held-release),
 *                  and the capture itself happens in allocateBankCredit({acceptLate}).
 *   ATTEMPT_VOID — close a stuck CREATED/CREATE_UNKNOWN/REVIEW_REQUIRED attempt that has NO payment
 *                  evidence (observation, UTR, payable, allocation, gateway success). Refused otherwise.
 *   REVERSAL     — book a bank reversal of a credit (recordReversal); order untouched.
 */
import { OrderStatus, PgAllocationKind, PgAttemptState, PgExceptionStatus, type PgFinancialEvent } from '@prisma/client';
import { prisma } from '../db';
import { log } from '../log';
import { appendFinancialEvent, type Tx } from './ledger';
import { openException } from './exceptions';
import { recordReversal, TX_OPTS } from './reconcile-engine';

export type OpsAction = 'LATE_ACCEPT' | 'ATTEMPT_VOID' | 'REVERSAL';
export const OPS_ACTIONS: readonly OpsAction[] = ['LATE_ACCEPT', 'ATTEMPT_VOID', 'REVERSAL'];

export class OpsActionError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}

export interface OpsTarget {
  attemptId?: string;
  bankTransactionId?: string;
}

const VOIDABLE: PgAttemptState[] = [PgAttemptState.CREATED, PgAttemptState.CREATE_UNKNOWN, PgAttemptState.REVIEW_REQUIRED];
const GATEWAY_PAID = new Set(['SUCCESS', 'PAID', 'COMPLETED', 'OBSERVED']);

export const heldLateDedupeKey = (allocationId: string) => `RELEASE_HELD:late:${allocationId}`;

// ───────────────────────────── validation (re-run at approval) ─────────────────────────────

interface Resolved {
  restaurantId: string;
  attemptId: string | null;
  orderId: string | null;
  bankTransactionId: string | null;
  allocationId: string | null;
  amountPaise: number | null;
}

async function validateLateAccept(db: Tx, bankTransactionId: string | undefined): Promise<Resolved> {
  if (!bankTransactionId) throw new OpsActionError('A bank transaction id is required.', 400);
  const alloc = await db.pgAllocation.findUnique({ where: { bankTransactionId } });
  if (!alloc || alloc.reversedAt || alloc.kind !== PgAllocationKind.LATE_PAYMENT || !alloc.attemptId || !alloc.orderId) {
    throw new OpsActionError('Only a live LATE_PAYMENT allocation can be accepted.');
  }
  const attempt = await db.pgPaymentAttempt.findUniqueOrThrow({ where: { id: alloc.attemptId } });
  const order = await db.order.findUnique({ where: { id: alloc.orderId }, select: { status: true } });
  if (!order || (order.status !== OrderStatus.PAYMENT_PENDING && order.status !== OrderStatus.PAYMENT_FAILED)) {
    throw new OpsActionError(`The order is ${order?.status ?? 'missing'}; a cancelled or already-released order cannot take a late payment. Refund it instead.`);
  }
  const paid = await db.pgAllocation.findFirst({ where: { orderId: alloc.orderId, kind: PgAllocationKind.ORDER_PAYMENT, reversedAt: null }, select: { id: true } });
  const captured = await db.payment.findFirst({ where: { orderId: alloc.orderId, status: 'CAPTURED' }, select: { id: true } });
  if (paid || captured) throw new OpsActionError('The order already has a confirmed payment. Refund this credit instead.');
  const refunds = await db.pgRefundRecord.findMany({
    where: { attemptId: attempt.id, allocationKind: PgAllocationKind.LATE_PAYMENT },
    include: { refund: { select: { status: true } } },
  });
  if (refunds.some((r) => r.refund.status !== 'FAILED')) throw new OpsActionError('A refund of this late payment is already in progress.');
  return {
    restaurantId: attempt.restaurantId,
    attemptId: attempt.id,
    orderId: alloc.orderId,
    bankTransactionId,
    allocationId: alloc.id,
    amountPaise: alloc.amountPaise,
  };
}

/** P1-3: refused when ANY payment evidence exists for the attempt. */
async function validateVoid(db: Tx, attemptId: string | undefined): Promise<Resolved> {
  if (!attemptId) throw new OpsActionError('An attempt id is required.', 400);
  const a = await db.pgPaymentAttempt.findUnique({ where: { id: attemptId } });
  if (!a) throw new OpsActionError('Payment attempt not found.', 404);
  if (!VOIDABLE.includes(a.state)) throw new OpsActionError(`Only CREATED, CREATE_UNKNOWN or REVIEW_REQUIRED attempts can be voided (this one is ${a.state}).`);
  const evidence = await db.pgPaymentEvidence.count({ where: { attemptId: a.id } });
  const allocations = await db.pgAllocation.count({ where: { attemptId: a.id } });
  const reasons: string[] = [];
  if (evidence > 0) reasons.push(`${evidence} payment observation(s)`);
  if (a.observedUtr) reasons.push('an observed UTR');
  if (a.payableAmountPaise != null) reasons.push('a gateway-signed payable amount');
  if (allocations > 0) reasons.push('a bank credit allocation');
  if (a.lastGatewayStatus && GATEWAY_PAID.has(a.lastGatewayStatus.toUpperCase())) reasons.push(`gateway status ${a.lastGatewayStatus}`);
  if (reasons.length > 0) {
    throw new OpsActionError(`This attempt has payment evidence (${reasons.join(', ')}). It cannot be voided; reconcile it instead.`);
  }
  return { restaurantId: a.restaurantId, attemptId: a.id, orderId: a.orderId, bankTransactionId: null, allocationId: null, amountPaise: a.expectedAmountPaise };
}

async function validateReversal(db: Tx, bankTransactionId: string | undefined): Promise<Resolved> {
  if (!bankTransactionId) throw new OpsActionError('A bank transaction id is required.', 400);
  const t = await db.pgBankTransaction.findUnique({
    where: { id: bankTransactionId },
    include: { allocation: true, receivingAccount: { select: { restaurantId: true } } },
  });
  if (!t) throw new OpsActionError('Bank transaction not found.', 404);
  if (t.status === 'REVERSED') throw new OpsActionError('This bank transaction is already reversed.');
  if (t.direction !== 'CREDIT') throw new OpsActionError('Only a credit can be reversed.');
  if (t.status === 'PENDING_APPROVAL') throw new OpsActionError('This manual entry is not approved yet; it cannot be reversed.');
  return {
    restaurantId: t.receivingAccount.restaurantId,
    attemptId: t.allocation?.attemptId ?? null,
    orderId: t.allocation?.orderId ?? null,
    bankTransactionId: t.id,
    allocationId: t.allocation?.id ?? null,
    amountPaise: t.amountPaise,
  };
}

function validate(db: Tx, action: OpsAction, target: OpsTarget): Promise<Resolved> {
  if (action === 'LATE_ACCEPT') return validateLateAccept(db, target.bankTransactionId);
  if (action === 'ATTEMPT_VOID') return validateVoid(db, target.attemptId);
  return validateReversal(db, target.bankTransactionId);
}

const targetKey = (r: Resolved, action: OpsAction) => (action === 'ATTEMPT_VOID' ? r.attemptId : r.bankTransactionId);

// ───────────────────────────── propose / decide ─────────────────────────────

export async function proposeOpsAction(input: { action: OpsAction; target: OpsTarget; actorId: string; reason: string }): Promise<{ proposalId: string }> {
  const actorId = input.actorId?.trim();
  const reason = input.reason?.trim();
  if (!OPS_ACTIONS.includes(input.action)) throw new OpsActionError('Unknown action.', 400);
  if (!actorId) throw new OpsActionError('A signed-in requester is required.', 401);
  if (!reason) throw new OpsActionError('A reason is required.', 400);
  const r = await validate(prisma, input.action, input.target);
  // One undecided proposal per action + target.
  const open = await openProposals(input.action);
  if (open.some((p) => (input.action === 'ATTEMPT_VOID' ? p.attemptId : p.bankTransactionId) === targetKey(r, input.action))) {
    throw new OpsActionError('An undecided proposal for this already exists. Approve or reject it first.');
  }
  const ev = await appendFinancialEvent(prisma, {
    kind: `${input.action}_PROPOSED`,
    restaurantId: r.restaurantId,
    attemptId: r.attemptId,
    orderId: r.orderId,
    bankTransactionId: r.bankTransactionId,
    allocationId: r.allocationId,
    amountPaise: r.amountPaise,
    actorId,
    data: { reason },
  });
  return { proposalId: ev.id };
}

/** Proposals of `action` with no decision yet (newest first). */
export async function openProposals(action: OpsAction, take = 100): Promise<PgFinancialEvent[]> {
  const proposals = await prisma.pgFinancialEvent.findMany({ where: { kind: `${action}_PROPOSED` }, orderBy: { createdAt: 'desc' }, take });
  if (proposals.length === 0) return [];
  const decided = new Set(
    (
      await prisma.pgFinancialEvent.findMany({
        where: { dedupeKey: { in: proposals.map((p) => `${action}_DECIDED:${p.id}`) } },
        select: { dedupeKey: true },
      })
    ).map((d) => d.dedupeKey),
  );
  return proposals.filter((p) => !decided.has(`${action}_DECIDED:${p.id}`));
}

export interface DecideResult {
  decision: 'APPROVED' | 'REJECTED';
  action: OpsAction;
  proposalId: string;
  detail?: Record<string, unknown>;
}

export async function decideOpsAction(input: { proposalId: string; actorId: string; decision: 'APPROVE' | 'REJECT'; note?: string }): Promise<DecideResult> {
  const actorId = input.actorId?.trim();
  if (!actorId) throw new OpsActionError('A signed-in approver is required.', 401);
  const out = await prisma.$transaction(async (tx) => {
    const p = await tx.pgFinancialEvent.findUnique({ where: { id: input.proposalId } });
    const action = p?.kind.replace(/_PROPOSED$/, '') as OpsAction | undefined;
    if (!p || !action || !p.kind.endsWith('_PROPOSED') || !OPS_ACTIONS.includes(action) || !p.actorId) {
      throw new OpsActionError('Proposal not found.', 404);
    }
    if (input.decision === 'APPROVE' && p.actorId === actorId) {
      throw new OpsActionError('A second super admin must approve this; you proposed it.', 403);
    }
    const decision = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const { count } = await tx.pgFinancialEvent.createMany({
      data: [
        {
          kind: `${action}_${decision}`,
          restaurantId: p.restaurantId,
          attemptId: p.attemptId,
          orderId: p.orderId,
          bankTransactionId: p.bankTransactionId,
          allocationId: p.allocationId,
          amountPaise: p.amountPaise,
          actorId,
          dedupeKey: `${action}_DECIDED:${p.id}`,
          data: { proposalId: p.id, requestedById: p.actorId, note: input.note?.trim() || null },
        },
      ],
      skipDuplicates: true,
    });
    if (count === 0) throw new OpsActionError('This proposal was already decided.');
    if (decision === 'REJECTED') return { decision, action, proposalId: p.id } as DecideResult;

    const reason = String((p.data as { reason?: unknown } | null)?.reason ?? '');
    const target: OpsTarget = { attemptId: p.attemptId ?? undefined, bankTransactionId: p.bankTransactionId ?? undefined };
    if (action === 'LATE_ACCEPT') {
      const r = await validateLateAccept(tx, target.bankTransactionId);
      const ex = await openException(tx, {
        kind: 'RELEASE_HELD',
        dedupeKey: heldLateDedupeKey(r.allocationId!),
        restaurantId: r.restaurantId,
        attemptId: r.attemptId,
        orderId: r.orderId,
        bankTransactionId: r.bankTransactionId,
        amountPaise: r.amountPaise,
        detail: { reason: 'late_payment_accepted', proposalId: p.id, requestedById: p.actorId, approvedById: actorId, note: reason },
      });
      return { decision, action, proposalId: p.id, detail: { heldExceptionId: ex.id } } as DecideResult;
    }
    if (action === 'ATTEMPT_VOID') {
      await tx.$queryRaw`SELECT id FROM "PgPaymentAttempt" WHERE id = ${target.attemptId} FOR UPDATE`;
      const r = await validateVoid(tx, target.attemptId);
      const a = await tx.pgPaymentAttempt.findUniqueOrThrow({ where: { id: r.attemptId! } });
      await tx.pgPaymentAttempt.update({
        where: { id: a.id },
        data: { state: PgAttemptState.CANCELLED, reviewReason: `voided by ops: ${reason}`.slice(0, 500) },
      });
      await tx.payment.updateMany({
        where: { id: a.paymentId, status: { in: ['PENDING', 'AUTHORIZED'] } },
        data: { status: 'FAILED', errorMessage: 'Payment attempt voided by operations (no payment evidence).' },
      });
      await tx.pgReconException.updateMany({
        where: { attemptId: a.id, kind: { in: ['CREATE_UNKNOWN', 'RECEIVER_MISMATCH', 'STALE_PENDING'] }, status: { not: PgExceptionStatus.RESOLVED } },
        data: { status: PgExceptionStatus.RESOLVED, resolution: `Attempt voided (dual control): ${reason}`.slice(0, 2000), resolvedById: actorId, resolvedAt: new Date() },
      });
      await appendFinancialEvent(tx, {
        kind: 'ATTEMPT_VOIDED',
        restaurantId: a.restaurantId,
        attemptId: a.id,
        orderId: a.orderId,
        actorId,
        dedupeKey: `ATTEMPT_VOIDED:${a.id}`,
        data: { from: a.state, requestedById: p.actorId, reason },
      });
      return { decision, action, proposalId: p.id, detail: { orderId: a.orderId, from: a.state } } as DecideResult;
    }
    const rev = await recordReversal({ bankTransactionId: target.bankTransactionId!, reason, actorId, requestedById: p.actorId }, tx);
    return { decision, action, proposalId: p.id, detail: { ...rev } } as DecideResult;
  }, TX_OPTS);

  // A voided attempt may have been the order's last live one: settle the order now (else the sweep does).
  if (out.action === 'ATTEMPT_VOID' && out.decision === 'APPROVED' && typeof out.detail?.orderId === 'string') {
    const orderId = out.detail.orderId;
    try {
      const live = await prisma.pgPaymentAttempt.count({
        where: { orderId, state: { in: ['CREATED', 'CREATE_UNKNOWN', 'AWAITING_PAYMENT', 'OBSERVED', 'BANK_VERIFIED', 'CAPTURED', 'REVIEW_REQUIRED'] } },
      });
      if (live === 0) {
        const { markOrderPaymentFailed } = await import('../payments/reconcile');
        await markOrderPaymentFailed(orderId, 'Flavrly PG payment attempt voided by operations');
      }
    } catch (e) {
      log.warn({ orderId, err: (e as Error).message }, 'pg.void.order_settle_failed');
    }
  }
  return out;
}
