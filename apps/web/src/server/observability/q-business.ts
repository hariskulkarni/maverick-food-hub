/**
 * Business-health read side: orders, payments, stuck orders, refunds, reviews,
 * support, riders, SOS. Read-only over existing tables.
 */
import { Prisma } from '@prisma/client';
import { ts } from './sql-time';
import { prisma } from '../db';
import { stepMinutesFor } from './q-api';
import { runHealthProviders } from './providers';

/** Stuck-order thresholds (minutes). Shared with the alert rules. */
export const STUCK = {
  PAYMENT_PENDING: 15,
  RECEIVED_NOT_ACCEPTED: 10,
  READY_NO_RIDER: 15,
  OUT_FOR_DELIVERY: 90,
} as const;

export interface StuckSummary {
  key: keyof typeof STUCK;
  label: string;
  thresholdMin: number;
  count: number;
  oldestMin: number | null;
  sample: Array<{ id: string; code: string; status: string; ageMin: number }>;
}

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000);
const ageMin = (d: Date | null | undefined) => (d ? Math.round((Date.now() - new Date(d).getTime()) / 60_000) : 0);

export async function stuckOrders(): Promise<StuckSummary[]> {
  const now = new Date();
  const defs: Array<{ key: keyof typeof STUCK; label: string; where: Prisma.OrderWhereInput; ts: 'placedAt' | 'readyAt' | 'outForDeliveryAt' }> = [
    {
      key: 'PAYMENT_PENDING',
      label: 'Payment pending',
      where: { status: 'PAYMENT_PENDING', placedAt: { lt: minsAgo(STUCK.PAYMENT_PENDING) } },
      ts: 'placedAt',
    },
    {
      key: 'RECEIVED_NOT_ACCEPTED',
      label: 'Received, not accepted by restaurant',
      where: {
        status: 'RECEIVED',
        placedAt: { lt: minsAgo(STUCK.RECEIVED_NOT_ACCEPTED) },
        OR: [{ scheduledFor: null }, { scheduledFor: { lt: now } }],
      },
      ts: 'placedAt',
    },
    {
      key: 'READY_NO_RIDER',
      label: 'Ready, no rider assigned',
      where: { status: 'READY', fulfillmentType: 'DELIVERY', readyAt: { lt: minsAgo(STUCK.READY_NO_RIDER) } } as Prisma.OrderWhereInput,
      ts: 'readyAt',
    },
    {
      key: 'OUT_FOR_DELIVERY',
      label: 'Out for delivery too long',
      where: { status: { in: ['OUT_FOR_DELIVERY', 'PICKED_UP'] }, outForDeliveryAt: { lt: minsAgo(STUCK.OUT_FOR_DELIVERY) } },
      ts: 'outForDeliveryAt',
    },
  ];
  return Promise.all(
    defs.map(async (d) => {
      const [count, sample] = await Promise.all([
        prisma.order.count({ where: d.where }),
        prisma.order.findMany({
          where: d.where,
          orderBy: { [d.ts]: 'asc' },
          take: 5,
          select: { id: true, code: true, status: true, placedAt: true, readyAt: true, outForDeliveryAt: true },
        }),
      ]);
      return {
        key: d.key,
        label: d.label,
        thresholdMin: STUCK[d.key],
        count,
        oldestMin: sample[0] ? ageMin(sample[0][d.ts]) : null,
        sample: sample.map((o) => ({ id: o.id, code: o.code, status: o.status, ageMin: ageMin(o[d.ts]) })),
      };
    }),
  );
}

export async function businessHealth(since: Date, rangeMin: number) {
  const step = stepMinutesFor(rangeMin);
  const interval = `${step} minutes`;
  const [
    orderSeries,
    ordersByStatus,
    payments,
    stuck,
    refundsPending,
    refundOldest,
    lastReviewSync,
    replyFailures24h,
    tickets,
    urgentOpen,
    oldestTicket,
    riderTickets,
    ridersOnline,
    ridersTotal,
    heartbeatBuckets,
    sosOpen,
    providers,
  ] = await Promise.all([
    prisma.$queryRaw<Array<{ b: Date; n: bigint }>>`
      SELECT date_bin(${interval}::interval, "placedAt", TIMESTAMP '2000-01-01') AS b, COUNT(*) AS n
      FROM "Order" WHERE "placedAt" >= ${ts(since)} GROUP BY 1 ORDER BY 1`.catch(() => []),
    prisma.order.groupBy({ by: ['status'], where: { placedAt: { gte: since } }, _count: { _all: true } }).catch(() => []),
    prisma.$queryRaw<Array<{ method: string; provider: string | null; status: string; n: bigint }>>`
      SELECT "method"::text AS method, "providerName" AS provider, "status"::text AS status, COUNT(*) AS n
      FROM "Payment" WHERE "createdAt" >= ${ts(since)} GROUP BY 1, 2, 3`.catch(() => []),
    stuckOrders().catch(() => [] as StuckSummary[]),
    prisma.refund.count({ where: { status: 'PENDING' } }).catch(() => 0),
    prisma.refund.findFirst({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }).catch(() => null),
    prisma.googleReview.aggregate({ _max: { syncedAt: true }, _count: { _all: true } }).catch(() => ({ _max: { syncedAt: null as Date | null }, _count: { _all: 0 } })),
    prisma.reviewReply.count({ where: { state: 'FAILED', updatedAt: { gte: minsAgo(1440) } } }).catch(() => 0),
    prisma.supportTicket.groupBy({ by: ['status'], where: { status: { in: ['OPEN', 'IN_PROGRESS'] } }, _count: { _all: true } }).catch(() => []),
    prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] }, priority: 'URGENT' } }).catch(() => 0),
    prisma.supportTicket.findFirst({ where: { status: 'OPEN' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }).catch(() => null),
    prisma.riderSupportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING_ON_RIDER'] } } }).catch(() => 0),
    prisma.riderProfile.count({ where: { isOnline: true } }).catch(() => 0),
    prisma.riderProfile.count().catch(() => 0),
    prisma.$queryRaw<Array<{ fresh: bigint; stale: bigint; dead: bigint; nohb: bigint; locfresh: bigint; locstale: bigint }>>`
      SELECT
        COUNT(*) FILTER (WHERE h."lastSeenAt" >= (now() AT TIME ZONE 'UTC') - interval '2 minutes') AS fresh,
        COUNT(*) FILTER (WHERE h."lastSeenAt" < (now() AT TIME ZONE 'UTC') - interval '2 minutes' AND h."lastSeenAt" >= (now() AT TIME ZONE 'UTC') - interval '10 minutes') AS stale,
        COUNT(*) FILTER (WHERE h."lastSeenAt" < (now() AT TIME ZONE 'UTC') - interval '10 minutes') AS dead,
        COUNT(*) FILTER (WHERE h."riderId" IS NULL) AS nohb,
        COUNT(*) FILTER (WHERE h."lastLocationAt" >= (now() AT TIME ZONE 'UTC') - interval '2 minutes') AS locfresh,
        COUNT(*) FILTER (WHERE h."lastLocationAt" IS NULL OR h."lastLocationAt" < (now() AT TIME ZONE 'UTC') - interval '2 minutes') AS locstale
      FROM "RiderProfile" p LEFT JOIN "RiderHeartbeat" h ON h."riderId" = p."id"
      WHERE p."isOnline" = true`.catch(() => []),
    prisma.sosAlert.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { triggeredAt: 'asc' },
      take: 10,
      select: { id: true, riderId: true, triggeredAt: true },
    }).catch(() => []),
    runHealthProviders(),
  ]);

  // Payment success/failure by provider.
  const byProvider = new Map<string, { provider: string; method: string; success: number; failed: number; pending: number; refunded: number }>();
  for (const p of payments) {
    const provider = (p.provider || p.method || 'unknown').toLowerCase();
    const row = byProvider.get(provider) ?? { provider, method: p.method, success: 0, failed: 0, pending: 0, refunded: 0 };
    const n = Number(p.n);
    if (p.status === 'CAPTURED' || p.status === 'AUTHORIZED') row.success += n;
    else if (p.status === 'FAILED') row.failed += n;
    else if (p.status === 'REFUNDED') row.refunded += n;
    else row.pending += n;
    byProvider.set(provider, row);
  }
  const paymentRows = [...byProvider.values()].map((r) => {
    const decided = r.success + r.failed;
    return { ...r, successRate: decided ? r.success / decided : null };
  });

  const totalOrders = ordersByStatus.reduce((a, r) => a + r._count._all, 0);
  const hb = heartbeatBuckets[0];
  const reviewSyncAt = lastReviewSync._max.syncedAt;

  return {
    orders: {
      total: totalOrders,
      perMin: Math.round((totalOrders / Math.max(1, rangeMin)) * 100) / 100,
      byStatus: Object.fromEntries(ordersByStatus.map((r) => [r.status, r._count._all])),
      series: orderSeries.map((r) => ({ t: new Date(r.b).toISOString(), count: Number(r.n) })),
    },
    payments: paymentRows,
    stuck,
    refunds: { pending: refundsPending, oldestPendingMin: refundOldest ? ageMin(refundOldest.createdAt) : null },
    reviews: {
      lastSyncAt: reviewSyncAt?.toISOString() ?? null,
      minutesSinceSync: reviewSyncAt ? ageMin(reviewSyncAt) : null,
      totalReviews: lastReviewSync._count._all,
      replyFailures24h,
    },
    support: {
      open: Object.fromEntries(tickets.map((t) => [t.status, t._count._all])),
      urgentOpen,
      oldestOpenMin: oldestTicket ? ageMin(oldestTicket.createdAt) : null,
      riderTicketsOpen: riderTickets,
    },
    riders: {
      online: ridersOnline,
      offline: Math.max(0, ridersTotal - ridersOnline),
      total: ridersTotal,
      heartbeat: {
        fresh: Number(hb?.fresh ?? 0),
        stale: Number(hb?.stale ?? 0),
        dead: Number(hb?.dead ?? 0),
        none: Number(hb?.nohb ?? 0),
      },
      location: { fresh: Number(hb?.locfresh ?? 0), stale: Number(hb?.locstale ?? 0) },
    },
    sos: {
      open: sosOpen.length,
      oldestMin: sosOpen[0] ? ageMin(sosOpen[0].triggeredAt) : null,
      alerts: sosOpen.map((s) => ({ id: s.id, riderId: s.riderId, ageMin: ageMin(s.triggeredAt) })),
    },
    providers,
  };
}
