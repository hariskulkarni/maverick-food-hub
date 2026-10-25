/**
 * prep_stats v0 — per-restaurant prep-time percentiles and the prediction used
 * by JIT dispatch.
 *
 *   actual prep = food ready − accepted
 *     food ready = the FOOD_READY event, else Order.readyAt (historic orders:
 *     READY is the kitchen's "food ready" mark). Orders whose FOOD_READY was
 *     only implied by a rider pickup (source RIDER) are excluded — that is not
 *     a kitchen signal.
 *
 * Nightly job computes P50/P60/P90 with SQL percentile_cont over the last 28
 * days, per restaurant × IST hour-of-day (accepted hour) plus an all-hours row
 * (hourBucket = -1). Prediction = P60 of the hour bucket when it has ≥ 30
 * samples, else the all-hours P60 when that has ≥ 30, else the restaurant's
 * quoted prep time (largest MenuItem.prepTimeMin on the order, default 20).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { utcTs } from './events';

export const PREP_MIN_SAMPLES = 30;
export const PREP_WINDOW_DAYS = 28;
export const DEFAULT_QUOTED_PREP_MIN = 20;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export type PrepSource = 'hour' | 'all' | 'quoted';

export interface PrepStatRow {
  hourBucket: number;
  samples: number;
  p60Min: number;
}

export interface PrepPrediction {
  minutes: number;
  source: PrepSource;
  samples: number;
  quotedMin: number;
}

/** IST hour of day (0..23) for an instant. */
export function istHour(d: Date): number {
  return new Date(d.getTime() + IST_OFFSET_MS).getUTCHours();
}

/** Quoted prep for an order = the slowest item's prepTimeMin (default 20). */
export function quotedPrepMinutes(itemPrepTimes: Array<number | null | undefined>): number {
  const valid = itemPrepTimes.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0);
  return valid.length ? Math.max(...valid) : DEFAULT_QUOTED_PREP_MIN;
}

/** Pure: pick the prediction from the stored stats. */
export function choosePrediction(stats: PrepStatRow[], hour: number, quotedMin: number, minSamples = PREP_MIN_SAMPLES): PrepPrediction {
  const byHour = stats.find((s) => s.hourBucket === hour);
  if (byHour && byHour.samples >= minSamples) {
    return { minutes: round1(byHour.p60Min), source: 'hour', samples: byHour.samples, quotedMin };
  }
  const all = stats.find((s) => s.hourBucket === -1);
  if (all && all.samples >= minSamples) {
    return { minutes: round1(all.p60Min), source: 'all', samples: all.samples, quotedMin };
  }
  return { minutes: quotedMin, source: 'quoted', samples: Math.max(byHour?.samples ?? 0, all?.samples ?? 0), quotedMin };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Predict prep minutes for an order (uses its accepted hour, or now). */
export async function predictPrepMinutes(orderId: string): Promise<PrepPrediction & { restaurantId: string; acceptedAt: Date | null }> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      acceptedAt: true,
      branch: { select: { restaurantId: true } },
      items: { select: { menuItem: { select: { prepTimeMin: true } } } },
    },
  });
  const restaurantId = order.branch.restaurantId;
  const quoted = quotedPrepMinutes(order.items.map((i) => i.menuItem?.prepTimeMin));
  const hour = istHour(order.acceptedAt ?? new Date());
  const stats = await prisma.restaurantPrepStat.findMany({
    where: { restaurantId, hourBucket: { in: [hour, -1] } },
    select: { hourBucket: true, samples: true, p60Min: true },
  });
  return { ...choosePrediction(stats, hour, quoted), restaurantId, acceptedAt: order.acceptedAt };
}

interface StatSqlRow {
  rid: string;
  hr: number | null;
  n: number;
  p50: number;
  p60: number;
  p90: number;
}

/** Nightly: recompute RestaurantPrepStat from the last 28 days. Replaces the table contents atomically. */
export async function computePrepStats(now: Date = new Date()): Promise<{ restaurants: number; rows: number }> {
  const since = new Date(now.getTime() - PREP_WINDOW_DAYS * 86_400_000);
  // placedAt bound lets the planner use the (status, placedAt) / placedAt paths;
  // acceptedAt is always ≥ placedAt so it never drops a sample.
  const rows = await prisma.$queryRaw<StatSqlRow[]>(Prisma.sql`
    WITH samples AS (
      SELECT b."restaurantId" AS rid,
             EXTRACT(HOUR FROM ((o."acceptedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata'))::int AS hr,
             EXTRACT(EPOCH FROM (COALESCE(fe.at, o."readyAt") - o."acceptedAt")) / 60.0 AS mins
      FROM "Order" o
      JOIN "Branch" b ON b.id = o."branchId"
      LEFT JOIN LATERAL (
        SELECT e.at, e.source FROM "OrderEvent" e
        WHERE e."orderId" = o.id AND e.type = 'FOOD_READY'
        ORDER BY e.at ASC LIMIT 1
      ) fe ON true
      WHERE o."placedAt" >= ${utcTs(new Date(since.getTime() - 86_400_000))}
        AND o."acceptedAt" >= ${utcTs(since)}
        AND o."acceptedAt" IS NOT NULL
        AND COALESCE(fe.at, o."readyAt") IS NOT NULL
        AND (fe.source IS NULL OR fe.source <> 'RIDER')
    )
    SELECT rid, hr, count(*)::int AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY mins)::float8 AS p50,
           percentile_cont(0.6) WITHIN GROUP (ORDER BY mins)::float8 AS p60,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY mins)::float8 AS p90
    FROM samples
    WHERE mins BETWEEN 1 AND 120
    GROUP BY GROUPING SETS ((rid, hr), (rid))
  `);
  const data = rows.map((r) => ({
    restaurantId: r.rid,
    hourBucket: r.hr == null ? -1 : Number(r.hr),
    samples: Number(r.n),
    p50Min: round1(Number(r.p50)),
    p60Min: round1(Number(r.p60)),
    p90Min: round1(Number(r.p90)),
    computedAt: now,
  }));
  await prisma.$transaction([prisma.restaurantPrepStat.deleteMany({}), prisma.restaurantPrepStat.createMany({ data })]);
  return { restaurants: new Set(data.map((d) => d.restaurantId)).size, rows: data.length };
}
