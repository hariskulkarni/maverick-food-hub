/**
 * Flavrly PG reconciliation report (master prompt §13, contract D14).
 *
 * One row per payment attempt of ONE restaurant in [from, to] (attempt.createdAt).
 * All money is integer paise. Flavrly PG is DIRECT_TO_MERCHANT: the restaurant's bank
 * account already holds the money, so there is no PSP fee (0) and no Flavrly payout;
 * platform commission is a receivable from the restaurant.
 *
 * Tenant scope: the caller MUST pass a restaurantId resolved from the signed-in
 * session (merchant) or chosen by a super-admin. Never take it from merchant input.
 */
import { PgAllocationKind, PgEvidenceSource, PgEvidenceStatus, PgExceptionStatus, RefundStatus } from '@prisma/client';
import { prisma } from '../db';
import { computeSettlementLine } from '../settlement';
import { decimalToPaise } from './money';

export type PgRefundState = 'NONE' | 'PENDING' | 'PARTIAL' | 'REFUNDED' | 'FAILED';

export interface PgReconRow {
  orderId: string;
  orderCode: string | null;
  orderStatus: string | null;
  attemptId: string;
  attemptCreatedAt: string;
  gatewayId: string | null; // gateway payment id (attemptKey is shown when the gateway never returned one)
  attemptKey: string;
  merchant: string;
  gatewayMerchantId: string;
  receivingAccount: string; // masked
  utr: string | null;
  expectedAmountPaise: number;
  observedAmountPaise: number | null; // authenticated gateway/observer report; NOT proof of money
  bankConfirmedAmountPaise: number; // live bank allocations, all kinds
  reconStatus: string; // PgAttemptState
  refundStatus: PgRefundState;
  refundedPaise: number; // COMPLETED refunds
  refundPendingPaise: number;
  adjustmentsPaise: number; // overcollection + late-payment money received beyond the order (owed back)
  feesPaise: number; // 0: no PSP on direct UPI
  platformCommissionPaise: number; // receivable from the restaurant (delivered orders only, as in settlement)
  netMerchantValuePaise: number; // bankConfirmed - refunded - fees - commission
  exceptionReason: string | null; // open/acknowledged exceptions
}

export interface PgReconReport {
  restaurantId: string;
  merchant: string;
  settlementMode: 'DIRECT_TO_MERCHANT';
  period: { from: string; to: string };
  rows: PgReconRow[];
  totals: Pick<
    PgReconRow,
    | 'expectedAmountPaise'
    | 'bankConfirmedAmountPaise'
    | 'refundedPaise'
    | 'refundPendingPaise'
    | 'adjustmentsPaise'
    | 'feesPaise'
    | 'platformCommissionPaise'
    | 'netMerchantValuePaise'
  >;
}

const OBSERVATION_SOURCES: PgEvidenceSource[] = [
  PgEvidenceSource.GATEWAY_WEBHOOK,
  PgEvidenceSource.GATEWAY_STATUS,
  PgEvidenceSource.OBSERVER,
];

/** "ab***@okbank / XXXX1234" — never the full VPA or account number. */
export function maskReceivingAccount(vpa: string | null | undefined, last4: string | null | undefined): string {
  const parts: string[] = [];
  if (vpa) {
    const [local, host] = vpa.split('@');
    parts.push(`${local.slice(0, 2)}***${host ? '@' + host : ''}`);
  }
  if (last4) parts.push(`XXXX${last4.slice(-4)}`);
  return parts.join(' / ');
}

export async function buildPgReconciliationReport(input: { restaurantId: string; from: Date; to: Date }): Promise<PgReconReport> {
  const { restaurantId, from, to } = input;
  if (!restaurantId) throw new Error('buildPgReconciliationReport: restaurantId is required');
  if (!(from instanceof Date) || !(to instanceof Date) || isNaN(+from) || isNaN(+to) || from > to) {
    throw new Error('buildPgReconciliationReport: invalid period');
  }

  const restaurant = await prisma.restaurant.findUniqueOrThrow({
    where: { id: restaurantId },
    select: { id: true, name: true, commissionPct: true, paymentFeePct: true },
  });

  const attempts = await prisma.pgPaymentAttempt.findMany({
    where: { restaurantId, createdAt: { gte: from, lte: to } },
    orderBy: { createdAt: 'asc' },
    include: {
      receivingAccount: { select: { vpa: true, accountLast4: true } },
      allocations: { where: { reversedAt: null }, include: { bankTransaction: { select: { bankReference: true } } } },
      evidence: {
        where: { source: { in: OBSERVATION_SOURCES }, sourceAuthenticated: true, status: { not: PgEvidenceStatus.REJECTED } },
        orderBy: { processedAt: 'desc' },
        select: { observedAmountPaise: true, utr: true },
      },
    },
  });
  const attemptIds = attempts.map((a) => a.id);
  const orderIds = [...new Set(attempts.map((a) => a.orderId))];

  const [orders, refunds, exceptions] = await Promise.all([
    prisma.order.findMany({
      // branch filter is defence in depth: an attempt can only point at this tenant's orders.
      where: { id: { in: orderIds }, branch: { restaurantId } },
      select: {
        id: true, code: true, status: true, placedAt: true, paymentMethod: true, fulfillmentType: true,
        subtotal: true, packagingFee: true, deliveryFee: true, discountAmount: true, signupBonusApplied: true, taxAmount: true,
      },
    }),
    prisma.pgRefundRecord.findMany({
      where: { attemptId: { in: attemptIds } },
      select: { attemptId: true, amountPaise: true, refund: { select: { status: true } } },
    }),
    prisma.pgReconException.findMany({
      where: { restaurantId, attemptId: { in: attemptIds }, status: { not: PgExceptionStatus.RESOLVED } },
      orderBy: { createdAt: 'asc' },
      select: { attemptId: true, kind: true, detail: true },
    }),
  ]);
  const orderById = new Map(orders.map((o) => [o.id, o]));

  const rows: PgReconRow[] = attempts.map((a) => {
    const order = orderById.get(a.orderId) ?? null;
    const live = a.allocations;
    const orderPaid = live.some((x) => x.kind === PgAllocationKind.ORDER_PAYMENT);
    const bankConfirmed = live.reduce((s, x) => s + x.amountPaise, 0);
    const adjustments = live.filter((x) => x.kind !== PgAllocationKind.ORDER_PAYMENT).reduce((s, x) => s + x.amountPaise, 0);

    const mine = refunds.filter((r) => r.attemptId === a.id);
    const refunded = mine.filter((r) => r.refund.status === RefundStatus.COMPLETED).reduce((s, r) => s + r.amountPaise, 0);
    const refundPending = mine.filter((r) => r.refund.status === RefundStatus.PENDING).reduce((s, r) => s + r.amountPaise, 0);
    const anyFailed = mine.some((r) => r.refund.status === RefundStatus.FAILED);
    const refundStatus: PgRefundState =
      refundPending > 0 ? 'PENDING'
        : refunded > 0 && refunded >= bankConfirmed ? 'REFUNDED'
          : refunded > 0 ? 'PARTIAL'
            : anyFailed ? 'FAILED'
              : 'NONE';

    let commission = 0;
    if (order && orderPaid) {
      const line = computeSettlementLine(
        {
          id: order.id, code: order.code, placedAt: order.placedAt, status: order.status,
          paymentMethod: order.paymentMethod, fulfillmentType: order.fulfillmentType, discountConstruct: '',
          subtotal: Number(order.subtotal), packagingFee: Number(order.packagingFee), deliveryFee: Number(order.deliveryFee),
          discountAmount: Number(order.discountAmount), signupBonusApplied: Number(order.signupBonusApplied), taxAmount: Number(order.taxAmount),
          directToMerchant: true,
        },
        { commissionPct: restaurant.commissionPct, paymentFeePct: restaurant.paymentFeePct },
      );
      // Same rupee figure the settlement report shows, converted exactly (D12).
      commission = decimalToPaise(line.commission.toFixed(2));
    }
    const fees = 0;

    const ex = exceptions.filter((e) => e.attemptId === a.id);
    const exceptionReason = ex.length
      ? ex.map((e) => {
          const reason = (e.detail as { reason?: unknown } | null)?.reason;
          return typeof reason === 'string' ? `${e.kind}: ${reason}` : e.kind;
        }).join('; ')
      : null;

    const orderAlloc = live.find((x) => x.kind === PgAllocationKind.ORDER_PAYMENT);
    return {
      orderId: a.orderId,
      orderCode: order?.code ?? null,
      orderStatus: order?.status ?? null,
      attemptId: a.id,
      attemptCreatedAt: a.createdAt.toISOString(),
      gatewayId: a.gatewayPaymentId,
      attemptKey: a.attemptKey,
      merchant: restaurant.name,
      gatewayMerchantId: a.gatewayMerchantId,
      receivingAccount: maskReceivingAccount(a.receivingAccount.vpa, a.receivingAccount.accountLast4),
      utr: orderAlloc?.bankTransaction.bankReference ?? a.observedUtr ?? null,
      expectedAmountPaise: a.expectedAmountPaise,
      observedAmountPaise: a.evidence.find((e) => e.observedAmountPaise != null)?.observedAmountPaise ?? null,
      bankConfirmedAmountPaise: bankConfirmed,
      reconStatus: a.state,
      refundStatus,
      refundedPaise: refunded,
      refundPendingPaise: refundPending,
      adjustmentsPaise: adjustments,
      feesPaise: fees,
      platformCommissionPaise: commission,
      netMerchantValuePaise: bankConfirmed - refunded - fees - commission,
      exceptionReason,
    };
  });

  const total = (k: keyof PgReconReport['totals']) => rows.reduce((s, r) => s + r[k], 0);
  return {
    restaurantId,
    merchant: restaurant.name,
    settlementMode: 'DIRECT_TO_MERCHANT',
    period: { from: from.toISOString(), to: to.toISOString() },
    rows,
    totals: {
      expectedAmountPaise: total('expectedAmountPaise'),
      bankConfirmedAmountPaise: total('bankConfirmedAmountPaise'),
      refundedPaise: total('refundedPaise'),
      refundPendingPaise: total('refundPendingPaise'),
      adjustmentsPaise: total('adjustmentsPaise'),
      feesPaise: total('feesPaise'),
      platformCommissionPaise: total('platformCommissionPaise'),
      netMerchantValuePaise: total('netMerchantValuePaise'),
    },
  };
}

// ── CSV export ──

const CSV_COLUMNS: [keyof PgReconRow, string][] = [
  ['orderId', 'Order ID'],
  ['orderCode', 'Order code'],
  ['orderStatus', 'Order status'],
  ['attemptId', 'Payment attempt ID'],
  ['attemptCreatedAt', 'Attempt created (UTC)'],
  ['gatewayId', 'Gateway ID'],
  ['attemptKey', 'Gateway order ref'],
  ['merchant', 'Merchant'],
  ['gatewayMerchantId', 'Gateway merchant ID'],
  ['receivingAccount', 'Receiving account (masked)'],
  ['utr', 'UTR'],
  ['expectedAmountPaise', 'Expected (paise)'],
  ['observedAmountPaise', 'Observed (paise)'],
  ['bankConfirmedAmountPaise', 'Bank-confirmed (paise)'],
  ['reconStatus', 'Reconciliation status'],
  ['refundStatus', 'Refund status'],
  ['refundedPaise', 'Refunded (paise)'],
  ['refundPendingPaise', 'Refund pending (paise)'],
  ['adjustmentsPaise', 'Adjustments: over/late collection (paise)'],
  ['feesPaise', 'Fees (paise)'],
  ['platformCommissionPaise', 'Platform commission receivable (paise)'],
  ['netMerchantValuePaise', 'Net merchant value (paise)'],
  ['exceptionReason', 'Exception reason'],
];

/** One CSV cell: RFC 4180 quoting, and text starting with = + - @ (or tab/CR) is prefixed with ' so spreadsheets never evaluate it. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV (CRLF line endings, header row). Amounts stay integer paise. */
export function pgReconciliationCsv(report: PgReconReport): string {
  const lines = [CSV_COLUMNS.map(([, h]) => csvCell(h)).join(',')];
  for (const r of report.rows) lines.push(CSV_COLUMNS.map(([k]) => csvCell(r[k])).join(','));
  return lines.join('\r\n') + '\r\n';
}
