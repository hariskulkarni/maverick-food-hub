/**
 * Read models for the Flavrly PG merchant page (tenant-scoped) and the platform ops page
 * (super-admin, cross-tenant). Read-only; every mutation goes through the engine/ingest/
 * exception modules. Nothing here returns secrets, raw narration (only bank-source's
 * redacted `narrationRedacted`), or raw bank account numbers.
 */
import { PgAttemptState, PgBankTxnStatus, PgExceptionStatus, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { normalizeBankReference } from './bank-source';
import { decimalToPaise } from './money';
import { inboxMetrics } from './inbox';
import { outboxMetrics } from './outbox';
import { OPS_ACTIONS, openProposals } from './ops-actions';

export const ATTEMPT_BUCKETS = {
  awaiting: [PgAttemptState.CREATED, PgAttemptState.CREATE_UNKNOWN, PgAttemptState.AWAITING_PAYMENT],
  observed: [PgAttemptState.OBSERVED, PgAttemptState.BANK_VERIFIED],
  captured: [PgAttemptState.CAPTURED],
  review: [PgAttemptState.REVIEW_REQUIRED],
  failed: [PgAttemptState.FAILED, PgAttemptState.EXPIRED, PgAttemptState.CANCELLED],
  refunds: [PgAttemptState.REFUND_PENDING, PgAttemptState.REFUNDED],
} as const;
export type AttemptBucket = keyof typeof ATTEMPT_BUCKETS;

/** Observed (gateway says paid) but no bank credit yet for longer than this = needs attention. */
export const OBSERVED_STALE_MS = 30 * 60_000;

function amountQueryPaise(q: string): number | null {
  const s = q.replace(/₹|INR|Rs\.?|,|\s/gi, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  const p = decimalToPaise(s);
  return p > 0 ? p : null;
}

export interface MerchantDashboardOpts {
  q?: string;
  bucket?: AttemptBucket;
}

export async function loadMerchantPgDashboard(restaurantId: string, opts: MerchantDashboardOpts = {}) {
  const q = (opts.q ?? '').trim().slice(0, 64);
  const now = Date.now();

  const accounts = await prisma.pgReceivingAccount.findMany({
    where: { restaurantId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      vpa: true,
      status: true,
      ifsc: true,
      accountLast4: true,
      legalEntityName: true,
      disabledForNewAt: true,
      verifiedAt: true,
      createdAt: true,
    },
  });
  const accountIds = accounts.map((a) => a.id);

  // Search: order code (contains), UTR (exact, normalized) or amount (exact paise).
  const attemptOr: Prisma.PgPaymentAttemptWhereInput[] = [];
  const creditOr: Prisma.PgBankTransactionWhereInput[] = [];
  if (q) {
    const ref = normalizeBankReference(q);
    attemptOr.push({ observedUtr: ref });
    creditOr.push({ bankReference: ref });
    const paise = amountQueryPaise(q);
    if (paise !== null) {
      attemptOr.push({ expectedAmountPaise: paise });
      creditOr.push({ amountPaise: paise });
    }
    const orders = await prisma.order.findMany({
      where: { code: { contains: q, mode: 'insensitive' }, branch: { restaurantId } },
      select: { id: true },
      take: 50,
    });
    if (orders.length) attemptOr.push({ orderId: { in: orders.map((o) => o.id) } });
  }

  const attemptWhere: Prisma.PgPaymentAttemptWhereInput = {
    restaurantId,
    ...(q ? { OR: attemptOr } : {}),
    ...(opts.bucket ? { state: { in: [...ATTEMPT_BUCKETS[opts.bucket]] } } : {}),
  };

  const [stateGroups, attempts, unmatchedCredits, exceptions, imports, staleObserved, lastWebhook, releaseRows, refunds] =
    await Promise.all([
      prisma.pgPaymentAttempt.groupBy({ by: ['state'], where: { restaurantId }, _count: { _all: true } }),
      prisma.pgPaymentAttempt.findMany({
        where: attemptWhere,
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          orderId: true,
          state: true,
          expectedAmountPaise: true,
          observedUtr: true,
          reviewReason: true,
          createdAt: true,
          updatedAt: true,
          receivingAccountId: true,
        },
      }),
      accountIds.length
        ? prisma.pgBankTransaction.findMany({
            where: {
              receivingAccountId: { in: accountIds },
              direction: 'CREDIT',
              status: { in: [PgBankTxnStatus.UNMATCHED, PgBankTxnStatus.REVIEW_REQUIRED] },
              ...(q ? { OR: creditOr } : {}),
            },
            orderBy: { valueAt: 'desc' },
            take: 50,
            select: {
              id: true,
              amountPaise: true,
              bankReference: true,
              valueAt: true,
              source: true,
              status: true,
              narrationRedacted: true,
            },
          })
        : Promise.resolve([]),
      prisma.pgReconException.findMany({
        where: { restaurantId, status: { not: PgExceptionStatus.RESOLVED } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, kind: true, status: true, orderId: true, amountPaise: true, createdAt: true },
      }),
      accountIds.length
        ? prisma.pgStatementImport.findMany({
            where: { receivingAccountId: { in: accountIds } },
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: {
              id: true,
              fileName: true,
              rowCount: true,
              insertedCount: true,
              duplicateCount: true,
              rejectedCount: true,
              status: true,
              createdAt: true,
            },
          })
        : Promise.resolve([]),
      prisma.pgPaymentAttempt.count({
        where: { restaurantId, state: PgAttemptState.OBSERVED, updatedAt: { lt: new Date(now - OBSERVED_STALE_MS) } },
      }),
      prisma.pgPaymentEvidence.findFirst({
        where: { restaurantId, source: 'GATEWAY_WEBHOOK' },
        orderBy: { processedAt: 'desc' },
        select: { processedAt: true },
      }),
      prisma.$queryRaw<{ pending: number; dead: number }[]>`
        SELECT
          count(*) FILTER (WHERE o."status" = 'PENDING')::int AS pending,
          count(*) FILTER (WHERE o."status" = 'DEAD')::int AS dead
        FROM "PgOutbox" o
        WHERE o."topic" = 'ORDER_RELEASE'
          AND o."status" IN ('PENDING', 'DEAD')
          AND o."aggregateId" IN (SELECT a."orderId" FROM "PgPaymentAttempt" a WHERE a."restaurantId" = ${restaurantId})`,
      prisma.pgRefundRecord.findMany({
        where: { refund: { status: 'PENDING', order: { branch: { restaurantId } } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          refundId: true,
          method: true,
          amountPaise: true,
          destinationRef: true,
          requestedById: true,
          approvedById: true,
          createdAt: true,
          refund: { select: { orderId: true, reason: true } },
        },
      }),
    ]);

  // Paid orders held for this restaurant's confirmation (stale release / accepted late payment).
  const held = await prisma.pgReconException.findMany({
    where: { restaurantId, kind: 'RELEASE_HELD', status: PgExceptionStatus.OPEN },
    orderBy: { createdAt: 'asc' },
    take: 50,
    select: { id: true, orderId: true, amountPaise: true, detail: true, createdAt: true },
  });

  const orderCodes = new Map(
    (
      await prisma.order.findMany({
        where: {
          id: {
            in: [
              ...new Set([
                ...held.flatMap((x) => (x.orderId ? [x.orderId] : [])),
                ...attempts.map((a) => a.orderId),
                ...exceptions.flatMap((e) => (e.orderId ? [e.orderId] : [])),
                ...refunds.map((r) => r.refund.orderId),
              ]),
            ],
          },
        },
        select: { id: true, code: true },
      })
    ).map((o) => [o.id, o.code]),
  );

  const counts = Object.fromEntries(Object.keys(ATTEMPT_BUCKETS).map((k) => [k, 0])) as Record<AttemptBucket, number>;
  for (const g of stateGroups) {
    for (const [bucket, states] of Object.entries(ATTEMPT_BUCKETS) as [AttemptBucket, readonly PgAttemptState[]][]) {
      if (states.includes(g.state)) counts[bucket] += g._count._all;
    }
  }

  return {
    accounts,
    counts,
    attempts: attempts.map((a) => ({ ...a, orderCode: orderCodes.get(a.orderId) ?? null })),
    unmatchedCredits,
    exceptions: exceptions.map((e) => ({ ...e, orderCode: e.orderId ? (orderCodes.get(e.orderId) ?? null) : null })),
    imports,
    refunds: refunds.map((r) => ({
      refundId: r.refundId,
      method: r.method,
      amountPaise: r.amountPaise,
      destinationRef: r.destinationRef,
      requestedById: r.requestedById,
      approvedById: r.approvedById,
      reason: r.refund.reason,
      createdAt: r.createdAt,
      orderCode: orderCodes.get(r.refund.orderId) ?? null,
    })),
    heldOrders: held.map((x) => ({
      exceptionId: x.id,
      orderId: x.orderId,
      orderCode: x.orderId ? (orderCodes.get(x.orderId) ?? null) : null,
      amountPaise: x.amountPaise,
      reason: ((x.detail ?? {}) as { reason?: string }).reason === 'late_payment_accepted' ? ('late_payment_accepted' as const) : ('stale_release' as const),
      createdAt: x.createdAt,
    })),
    health: {
      staleObserved,
      lastWebhookAt: lastWebhook?.processedAt ?? null,
      releasePending: releaseRows[0]?.pending ?? 0,
      releaseDead: releaseRows[0]?.dead ?? 0,
    },
  };
}

export type MerchantPgDashboard = Awaited<ReturnType<typeof loadMerchantPgDashboard>>;

// ───────────────────────────── platform (super admin) ─────────────────────────────

export async function loadPlatformPgOps() {
  const now = Date.now();
  const staleBefore = new Date(now - OBSERVED_STALE_MS);
  const dayBefore = new Date(now - 24 * 3_600_000);
  const pendingStates = [
    PgAttemptState.CREATED,
    PgAttemptState.CREATE_UNKNOWN,
    PgAttemptState.AWAITING_PAYMENT,
    PgAttemptState.OBSERVED,
  ];

  const [exceptions, pendingEntries, proposals, inbox, outbox, stale30m, stale24h, deadOutbox, unmatchedCredits, accounts] =
    await Promise.all([
      prisma.pgReconException.findMany({
        where: { status: { not: PgExceptionStatus.RESOLVED } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.pgBankTransaction.findMany({
        where: { status: PgBankTxnStatus.PENDING_APPROVAL },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          receivingAccountId: true,
          direction: true,
          amountPaise: true,
          bankReference: true,
          valueAt: true,
          enteredById: true,
          narrationRedacted: true,
          createdAt: true,
        },
      }),
      prisma.pgFinancialEvent.findMany({
        where: { kind: 'MANUAL_ALLOCATION_PROPOSED', createdAt: { gt: new Date(now - 30 * 24 * 3_600_000) } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      inboxMetrics(),
      outboxMetrics(),
      prisma.pgPaymentAttempt.groupBy({
        by: ['state'],
        where: { state: { in: pendingStates }, updatedAt: { lt: staleBefore } },
        _count: { _all: true },
      }),
      prisma.pgPaymentAttempt.count({ where: { state: { in: pendingStates }, updatedAt: { lt: dayBefore } } }),
      prisma.pgOutbox.findMany({
        where: { status: 'DEAD' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, topic: true, aggregateId: true, attempts: true, lastError: true, createdAt: true },
      }),
      prisma.pgBankTransaction.count({ where: { direction: 'CREDIT', status: PgBankTxnStatus.UNMATCHED } }),
      prisma.pgReceivingAccount.findMany({
        orderBy: { createdAt: 'desc' },
        select: { id: true, restaurantId: true, vpa: true, status: true },
      }),
    ]);

  const [opsOpen, decisions, deadInbox] = await Promise.all([
    Promise.all(OPS_ACTIONS.map((a) => openProposals(a, 50))).then((l) => l.flat()),
    prisma.pgFinancialEvent.findMany({
      where: { dedupeKey: { in: proposals.map((p) => `MANUAL_ALLOCATION_DECIDED:${p.id}`) } },
      select: { dedupeKey: true, kind: true },
    }),
    prisma.$queryRaw<{ id: string; providerEventId: string | null; eventType: string; attempts: number; error: string | null; createdAt: Date; redacted: boolean }[]>`
      SELECT "id", "providerEventId", "eventType", "attempts", "error", "createdAt",
             COALESCE(jsonb_exists("rawPayload", 'redacted'), false) AS redacted
      FROM "PaymentWebhookEvent"
      WHERE "provider" = 'youpi' AND "processed" = false AND "deadLetteredAt" IS NOT NULL
      ORDER BY "createdAt" DESC LIMIT 50`,
  ]);
  const decidedKind = new Map(decisions.map((d) => [d.dedupeKey, d.kind]));

  const proposalTxnIds = [...new Set(proposals.map((p) => p.bankTransactionId).filter((x): x is string => !!x))];
  const txnStatus = new Map(
    (
      await prisma.pgBankTransaction.findMany({ where: { id: { in: proposalTxnIds } }, select: { id: true, status: true } })
    ).map((t) => [t.id, t.status]),
  );
  const restaurantIds = [
    ...new Set([
      ...accounts.map((a) => a.restaurantId),
      ...exceptions.flatMap((e) => (e.restaurantId ? [e.restaurantId] : [])),
      ...opsOpen.flatMap((p) => (p.restaurantId ? [p.restaurantId] : [])),
    ]),
  ];
  const names = new Map(
    (await prisma.restaurant.findMany({ where: { id: { in: restaurantIds } }, select: { id: true, name: true } })).map((r) => [
      r.id,
      r.name,
    ]),
  );
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  return {
    exceptions: exceptions.map((e) => ({
      id: e.id,
      kind: e.kind,
      status: e.status,
      restaurantId: e.restaurantId,
      restaurantName: e.restaurantId ? (names.get(e.restaurantId) ?? e.restaurantId) : null,
      attemptId: e.attemptId,
      orderId: e.orderId,
      bankTransactionId: e.bankTransactionId,
      amountPaise: e.amountPaise,
      detail: e.detail,
      resolution: e.resolution,
      createdAt: e.createdAt,
    })),
    pendingEntries: pendingEntries.map((t) => {
      const acc = accountById.get(t.receivingAccountId);
      return { ...t, restaurantName: acc ? (names.get(acc.restaurantId) ?? acc.restaurantId) : null, vpa: acc?.vpa ?? null };
    }),
    proposals: proposals.map((p) => ({
      id: p.id,
      attemptId: p.attemptId,
      bankTransactionId: p.bankTransactionId,
      orderId: p.orderId,
      amountPaise: p.amountPaise,
      proposedById: p.actorId,
      reason: String((p.data as { reason?: unknown } | null)?.reason ?? ''),
      createdAt: p.createdAt,
      bankTxnStatus: p.bankTransactionId ? (txnStatus.get(p.bankTransactionId) ?? null) : null,
      decision:
        decidedKind.get(`MANUAL_ALLOCATION_DECIDED:${p.id}`) === 'MANUAL_ALLOCATION_REJECTED'
          ? ('REJECTED' as const)
          : decidedKind.has(`MANUAL_ALLOCATION_DECIDED:${p.id}`)
            ? ('APPROVED' as const)
            : null,
    })),
    opsProposals: opsOpen.map((p) => ({
      id: p.id,
      action: p.kind.replace(/_PROPOSED$/, ''),
      attemptId: p.attemptId,
      bankTransactionId: p.bankTransactionId,
      orderId: p.orderId,
      amountPaise: p.amountPaise,
      proposedById: p.actorId,
      reason: String((p.data as { reason?: unknown } | null)?.reason ?? ''),
      restaurantName: p.restaurantId ? (names.get(p.restaurantId) ?? p.restaurantId) : null,
      createdAt: p.createdAt,
    })),
    deadInbox,
    inbox,
    outbox,
    stale: {
      over30m: Object.fromEntries(stale30m.map((g) => [g.state, g._count._all])) as Partial<Record<PgAttemptState, number>>,
      over24h: stale24h,
    },
    deadOutbox,
    unmatchedCredits,
    accounts: accounts.map((a) => ({ ...a, restaurantName: names.get(a.restaurantId) ?? a.restaurantId })),
  };
}

export type PlatformPgOps = Awaited<ReturnType<typeof loadPlatformPgOps>>;

/** Shape of a read model after JSON serialization across the server/client boundary. */
export type Jsonified<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Jsonified<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonified<T[K]> }
      : T;
