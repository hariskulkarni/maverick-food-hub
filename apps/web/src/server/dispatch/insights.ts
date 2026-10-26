/**
 * Dispatch insights — ops KPIs for /platform/dispatch-insights (and the
 * restaurant-scoped card on /admin/reports).
 *
 * All aggregation happens in Postgres (percentile_cont, FILTER) over DELIVERY
 * orders placed inside an IST date range; nothing loads order rows into Node.
 * Milestones prefer OrderEvent and fall back to the legacy columns so history
 * from before the event log still counts:
 *   food ready     FOOD_READY event, else Order.readyAt
 *   released       first INVITED event, else Order.readyAt
 *   assigned       first ASSIGNED event, else RiderAssignment.claimedAt/assignedAt
 *   at restaurant  ARRIVED_RESTAURANT event, else RiderArrival(pickup)
 *   picked up      RiderAssignment.pickedUpAt, else PICKED_UP event, else outForDeliveryAt
 *   promised       Order.estimatedDeliveryAt, else placedAt + promise SLA (JIT setting, default 45 min)
 */
import { OrderStatus, Prisma } from '@prisma/client';
import { cellToLatLng } from 'h3-js';
import { prisma } from '../db';
import { utcTs } from './events';
import { NO_FIX_CELL } from './zones';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
export const MAX_RANGE_DAYS = 92;

export interface InsightFilters {
  from: string; // YYYY-MM-DD (IST)
  to: string; // YYYY-MM-DD (IST, inclusive)
  restaurantId?: string | null;
  city?: string | null;
}

/** Today's IST calendar date as YYYY-MM-DD. */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** IST day boundaries → UTC instants [start, end). Throws a 400 Response on bad input. */
export function istRange(from: string, to: string): { start: Date; end: Date; days: number } {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from) || !re.test(to)) throw Response.json({ error: 'from/to must be YYYY-MM-DD' }, { status: 400 });
  const f = Date.parse(`${from}T00:00:00Z`);
  const t = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(f) || !Number.isFinite(t)) throw Response.json({ error: 'Invalid date' }, { status: 400 });
  if (t < f) throw Response.json({ error: '`to` is before `from`' }, { status: 400 });
  const days = Math.round((t - f) / DAY_MS) + 1;
  if (days > MAX_RANGE_DAYS) throw Response.json({ error: `Range is limited to ${MAX_RANGE_DAYS} days` }, { status: 400 });
  return { start: new Date(f - IST_OFFSET_MS), end: new Date(t + DAY_MS - IST_OFFSET_MS), days };
}

/** Default range: the last 7 IST days including today. */
export function defaultRange(now: Date = new Date()): { from: string; to: string } {
  const to = istToday(now);
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - 6 * DAY_MS).toISOString().slice(0, 10);
  return { from, to };
}

// Every status an order can hold once paid. Listed positively so the planner
// can use the (status, placedAt) index with a ScalarArrayOp scan.
const PAID_STATUSES = Object.values(OrderStatus).filter((s) => s !== 'PAYMENT_PENDING' && s !== 'PAYMENT_FAILED');

const mins = (a: Prisma.Sql, b: Prisma.Sql) => Prisma.sql`(EXTRACT(EPOCH FROM (${a} - ${b})) / 60.0)`;

function timelineCte(f: InsightFilters, slaMin: number): Prisma.Sql {
  const { start, end } = istRange(f.from, f.to);
  const restaurant = f.restaurantId ? Prisma.sql`AND b."restaurantId" = ${f.restaurantId}` : Prisma.empty;
  const city = f.city ? Prisma.sql`AND lower(b.city) = lower(${f.city})` : Prisma.empty;
  const statuses = Prisma.join(PAID_STATUSES.map((s) => Prisma.sql`${s}::"OrderStatus"`));
  return Prisma.sql`
    base AS (
      SELECT o.id, o."placedAt", o."acceptedAt", o."readyAt", o."outForDeliveryAt", o."deliveredAt",
             o."estimatedDeliveryAt", b."restaurantId", b.city
      FROM "Order" o
      JOIN "Branch" b ON b.id = o."branchId"
      WHERE o.status IN (${statuses})
        AND o."placedAt" >= ${utcTs(start)} AND o."placedAt" < ${utcTs(end)}
        AND o."fulfillmentType" = 'DELIVERY'
        ${restaurant} ${city}
    ),
    ev AS (
      SELECT e."orderId",
             min(e.at) FILTER (WHERE e.type = 'FOOD_READY') AS food_ready_any,
             min(e.at) FILTER (WHERE e.type = 'FOOD_READY' AND e.source <> 'RIDER') AS food_ready_tap,
             min(e.at) FILTER (WHERE e.type = 'INVITED') AS invited,
             min(e.at) FILTER (WHERE e.type = 'ASSIGNED') AS assigned,
             min(e.at) FILTER (WHERE e.type = 'ARRIVED_RESTAURANT') AS arrived_rest,
             min(e.at) FILTER (WHERE e.type = 'PICKED_UP') AS picked
      FROM "OrderEvent" e
      WHERE e."orderId" IN (SELECT id FROM base)
      GROUP BY e."orderId"
    ),
    arr AS (
      SELECT "orderId", min(at) AS at FROM "RiderArrival"
      WHERE phase = 'pickup' AND "orderId" IN (SELECT id FROM base)
      GROUP BY "orderId"
    ),
    bi AS (
      SELECT "orderId", bool_or(status = 'ACCEPTED') AS batched FROM "BatchInvitation"
      WHERE "orderId" IN (SELECT id FROM base)
      GROUP BY "orderId"
    ),
    t AS (
      SELECT base.id, base."restaurantId", base."placedAt", base."acceptedAt", base."deliveredAt",
             to_char((base."placedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS ist_day,
             COALESCE(ev.food_ready_any, base."readyAt") AS ready_at,
             (ev.food_ready_tap IS NOT NULL OR (ev.food_ready_any IS NULL AND base."readyAt" IS NOT NULL)) AS ready_tapped,
             COALESCE(ev.invited, base."readyAt") AS released_at,
             COALESCE(ev.assigned, ra."claimedAt", ra."assignedAt") AS assigned_at,
             COALESCE(ev.arrived_rest, arr.at) AS arrived_rest_at,
             COALESCE(ra."pickedUpAt", ev.picked, base."outForDeliveryAt") AS picked_at,
             COALESCE(base."estimatedDeliveryAt", base."placedAt" + make_interval(mins => ${slaMin}::int)) AS promised_at,
             p."predictedPrepMin" AS predicted_prep,
             ra.id IS NOT NULL AS has_rider,
             COALESCE(bi.batched, false) AS batched
      FROM base
      LEFT JOIN ev ON ev."orderId" = base.id
      LEFT JOIN "RiderAssignment" ra ON ra."orderId" = base.id
      LEFT JOIN arr ON arr."orderId" = base.id
      LEFT JOIN bi ON bi."orderId" = base.id
      LEFT JOIN "OrderDispatchPlan" p ON p."orderId" = base.id
    )`;
}

const assignMin = Prisma.sql`GREATEST(0, ${mins(Prisma.sql`assigned_at`, Prisma.sql`released_at`)})`;
const waitMin = Prisma.sql`GREATEST(0, ${mins(Prisma.sql`picked_at`, Prisma.sql`COALESCE(arrived_rest_at, assigned_at)`)})`;
const foodWaitMin = Prisma.sql`GREATEST(0, ${mins(Prisma.sql`picked_at`, Prisma.sql`ready_at`)})`;
const prepErr = Prisma.sql`(${mins(Prisma.sql`ready_at`, Prisma.sql`"acceptedAt"`)} - predicted_prep)`;

/** Shared aggregate column list (used for summary, per-day and per-restaurant). */
const AGG = Prisma.sql`
  count(*)::int AS orders,
  count(*) FILTER (WHERE "deliveredAt" IS NOT NULL)::int AS delivered,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY ${assignMin}) FILTER (WHERE assigned_at IS NOT NULL AND released_at IS NOT NULL)::float8 AS assign_p50,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY ${assignMin}) FILTER (WHERE assigned_at IS NOT NULL AND released_at IS NOT NULL)::float8 AS assign_p90,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY ${waitMin}) FILTER (WHERE picked_at IS NOT NULL AND COALESCE(arrived_rest_at, assigned_at) IS NOT NULL)::float8 AS wait_p50,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY ${waitMin}) FILTER (WHERE picked_at IS NOT NULL AND COALESCE(arrived_rest_at, assigned_at) IS NOT NULL)::float8 AS wait_p90,
  count(*) FILTER (WHERE picked_at IS NOT NULL AND arrived_rest_at IS NOT NULL)::int AS wait_from_arrival,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY ${foodWaitMin}) FILTER (WHERE picked_at IS NOT NULL AND ready_at IS NOT NULL)::float8 AS food_wait_p50,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY ${foodWaitMin}) FILTER (WHERE picked_at IS NOT NULL AND ready_at IS NOT NULL)::float8 AS food_wait_p90,
  avg(abs(${prepErr})) FILTER (WHERE ready_tapped AND predicted_prep IS NOT NULL AND ready_at IS NOT NULL AND "acceptedAt" IS NOT NULL)::float8 AS prep_mae,
  avg(${prepErr}) FILTER (WHERE ready_tapped AND predicted_prep IS NOT NULL AND ready_at IS NOT NULL AND "acceptedAt" IS NOT NULL)::float8 AS prep_bias,
  count(*) FILTER (WHERE ready_tapped AND predicted_prep IS NOT NULL AND ready_at IS NOT NULL AND "acceptedAt" IS NOT NULL)::int AS prep_samples,
  count(*) FILTER (WHERE "deliveredAt" IS NOT NULL AND "deliveredAt" <= promised_at)::int AS on_time,
  count(*) FILTER (WHERE ready_at IS NOT NULL)::int AS ready_total,
  count(*) FILTER (WHERE ready_at IS NOT NULL AND ready_tapped)::int AS ready_tapped,
  count(*) FILTER (WHERE has_rider)::int AS with_rider,
  count(*) FILTER (WHERE batched)::int AS batched`;

interface AggRow {
  orders: number; delivered: number;
  assign_p50: number | null; assign_p90: number | null;
  wait_p50: number | null; wait_p90: number | null; wait_from_arrival: number;
  food_wait_p50: number | null; food_wait_p90: number | null;
  prep_mae: number | null; prep_bias: number | null; prep_samples: number;
  on_time: number; ready_total: number; ready_tapped: number; with_rider: number; batched: number;
}

export interface KpiBlock {
  orders: number;
  delivered: number;
  assignmentLatencyMin: { p50: number | null; p90: number | null };
  riderWaitAtRestaurantMin: { p50: number | null; p90: number | null; fromArrivalShare: number | null };
  foodWaitingForRiderMin: { p50: number | null; p90: number | null };
  prepError: { maeMin: number | null; biasMin: number | null; samples: number };
  onTimePct: number | null;
  readyTapRatePct: number | null;
  batchRatePct: number | null;
}

const r1 = (n: number | null | undefined) => (n == null || !Number.isFinite(Number(n)) ? null : Math.round(Number(n) * 10) / 10);
const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

export function toKpiBlock(r: AggRow): KpiBlock {
  const n = (v: unknown) => Number(v ?? 0);
  const withWait = n(r.wait_from_arrival);
  return {
    orders: n(r.orders),
    delivered: n(r.delivered),
    assignmentLatencyMin: { p50: r1(r.assign_p50), p90: r1(r.assign_p90) },
    riderWaitAtRestaurantMin: { p50: r1(r.wait_p50), p90: r1(r.wait_p90), fromArrivalShare: pct(withWait, n(r.with_rider)) },
    foodWaitingForRiderMin: { p50: r1(r.food_wait_p50), p90: r1(r.food_wait_p90) },
    prepError: { maeMin: r1(r.prep_mae), biasMin: r1(r.prep_bias), samples: n(r.prep_samples) },
    onTimePct: pct(n(r.on_time), n(r.delivered)),
    readyTapRatePct: pct(n(r.ready_tapped), n(r.ready_total)),
    batchRatePct: pct(n(r.batched), n(r.with_rider)),
  };
}

export interface DailyRow extends KpiBlock { day: string }
export interface RestaurantRow extends KpiBlock { restaurantId: string; name: string }
export interface ZoneHeatRow { h3Cell: string; lat: number | null; lng: number | null; openOrders: number; idleRiders: number; busyRiders: number; gap: number }

export interface DispatchInsights {
  range: { from: string; to: string; days: number };
  summary: KpiBlock;
  inviteAcceptance: { invited: number; accepted: number; declined: number; expired: number; ratePct: number | null };
  ordersPerRiderHour: { value: number | null; riderHours: number; note: string };
  unassignedOver5MinLive: number;
  daily: DailyRow[];
  restaurants: RestaurantRow[];
  zones: { bucketAt: string | null; latest: ZoneHeatRow[] };
}

/** Summary / daily / per-restaurant KPIs for a filter. */
export async function getDispatchInsights(f: InsightFilters, opts: { slaMin: number; includeRestaurants?: boolean; includeZones?: boolean; now?: Date } ): Promise<DispatchInsights> {
  const now = opts.now ?? new Date();
  const { start, end, days } = istRange(f.from, f.to);
  const cte = timelineCte(f, opts.slaMin);
  const restaurantFilter = f.restaurantId ? Prisma.sql`AND b."restaurantId" = ${f.restaurantId}` : Prisma.empty;
  const cityFilter = f.city ? Prisma.sql`AND lower(b.city) = lower(${f.city})` : Prisma.empty;

  const [summaryRows, dailyRows, restRows, inviteRows, riderHourRows, unassignedRows] = await Promise.all([
    prisma.$queryRaw<AggRow[]>(Prisma.sql`WITH ${cte} SELECT ${AGG} FROM t`),
    prisma.$queryRaw<(AggRow & { ist_day: string })[]>(Prisma.sql`WITH ${cte} SELECT ist_day, ${AGG} FROM t GROUP BY ist_day ORDER BY ist_day`),
    opts.includeRestaurants === false
      ? Promise.resolve([] as (AggRow & { restaurantId: string; name: string })[])
      : prisma.$queryRaw<(AggRow & { restaurantId: string; name: string })[]>(Prisma.sql`
          WITH ${cte}
          SELECT t."restaurantId" AS "restaurantId", min(r.name) AS name, ${AGG}
          FROM t JOIN "Restaurant" r ON r.id = t."restaurantId"
          GROUP BY t."restaurantId" ORDER BY count(*) DESC LIMIT 50`),
    prisma.$queryRaw<{ status: string; n: number }[]>(Prisma.sql`
      SELECT bi.status::text AS status, count(*)::int AS n
      FROM "BatchInvitation" bi
      JOIN "Order" o ON o.id = bi."orderId"
      JOIN "Branch" b ON b.id = o."branchId"
      WHERE bi."invitedAt" >= ${utcTs(start)} AND bi."invitedAt" < ${utcTs(end)} ${restaurantFilter} ${cityFilter}
      GROUP BY bi.status`),
    prisma.$queryRaw<{ rider_hours: number | null }[]>(Prisma.sql`
      SELECT (sum("idleRiders" + "busyRiders") * 5.0 / 60.0)::float8 AS rider_hours
      FROM "ZoneSupplyDemand" WHERE "bucketAt" >= ${utcTs(start)} AND "bucketAt" < ${utcTs(end)}`),
    prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT count(*)::int AS n
      FROM "Order" o
      JOIN "Branch" b ON b.id = o."branchId"
      LEFT JOIN "RiderAssignment" ra ON ra."orderId" = o.id
      LEFT JOIN "OrderDispatchPlan" p ON p."orderId" = o.id
      WHERE ra.id IS NULL
        AND o."fulfillmentType" = 'DELIVERY'
        AND o.status IN ('READY'::"OrderStatus", 'ACCEPTED'::"OrderStatus", 'PREPARING'::"OrderStatus")
        AND (
          (o.status = 'READY' AND COALESCE(p."releasedAt", o."readyAt") < ${utcTs(new Date(now.getTime() - 5 * 60_000))})
          OR (o.status <> 'READY' AND p."releasedAt" IS NOT NULL AND p."releasedAt" < ${utcTs(new Date(now.getTime() - 5 * 60_000))})
        )
        ${restaurantFilter} ${cityFilter}`),
  ]);

  const summary = toKpiBlock(summaryRows[0] ?? ({} as AggRow));
  const inv = Object.fromEntries(inviteRows.map((r) => [r.status, Number(r.n)]));
  const accepted = inv.ACCEPTED ?? 0, declined = inv.DECLINED ?? 0, expired = inv.EXPIRED ?? 0;
  const invited = inviteRows.reduce((s, r) => s + Number(r.n), 0);
  const riderHours = Math.round(Number(riderHourRows[0]?.rider_hours ?? 0) * 10) / 10;

  const zones = opts.includeZones === false ? { bucketAt: null, latest: [] } : await latestZoneHeat();

  return {
    range: { from: f.from, to: f.to, days },
    summary,
    inviteAcceptance: { invited, accepted, declined, expired, ratePct: pct(accepted, accepted + declined + expired) },
    ordersPerRiderHour: {
      value: riderHours > 0 ? Math.round((summary.delivered / riderHours) * 100) / 100 : null,
      riderHours,
      note: f.restaurantId || f.city
        ? 'Rider-hours are platform-wide (riders are not tied to a city/restaurant); delivered orders follow the filter.'
        : 'Rider-hours from the 5-minute zone snapshots (online riders × 5 min).',
    },
    unassignedOver5MinLive: Number(unassignedRows[0]?.n ?? 0),
    daily: dailyRows.map((r) => ({ day: r.ist_day, ...toKpiBlock(r) })),
    restaurants: restRows.map((r) => ({ restaurantId: r.restaurantId, name: r.name, ...toKpiBlock(r) })),
    zones,
  };
}

/** Latest zone snapshot, worst supply gap first (max 40 cells). */
export async function latestZoneHeat(): Promise<{ bucketAt: string | null; latest: ZoneHeatRow[] }> {
  const last = await prisma.zoneSupplyDemand.findFirst({ orderBy: { bucketAt: 'desc' }, select: { bucketAt: true } });
  if (!last) return { bucketAt: null, latest: [] };
  const rows = await prisma.zoneSupplyDemand.findMany({ where: { bucketAt: last.bucketAt }, take: 500 });
  const out = rows.map((r) => {
    let lat: number | null = null, lng: number | null = null;
    if (r.h3Cell !== NO_FIX_CELL) {
      try { [lat, lng] = cellToLatLng(r.h3Cell); } catch { /* malformed cell id */ }
    }
    return {
      h3Cell: r.h3Cell,
      lat: lat == null ? null : Math.round(lat * 10000) / 10000,
      lng: lng == null ? null : Math.round(lng * 10000) / 10000,
      openOrders: r.openOrders,
      idleRiders: r.idleRiders,
      busyRiders: r.busyRiders,
      gap: r.openOrders - r.idleRiders,
    };
  });
  out.sort((a, b) => b.gap - a.gap || b.openOrders - a.openOrders);
  return { bucketAt: last.bucketAt.toISOString(), latest: out.slice(0, 40) };
}

export const CSV_HEADERS = [
  'day', 'orders', 'delivered', 'assign_p50_min', 'assign_p90_min', 'rider_wait_p50_min', 'rider_wait_p90_min',
  'food_wait_p50_min', 'food_wait_p90_min', 'prep_mae_min', 'prep_bias_min', 'prep_samples', 'on_time_pct', 'ready_tap_pct', 'batch_pct',
];

export function csvRows(daily: DailyRow[]): unknown[][] {
  return daily.map((d) => [
    d.day, d.orders, d.delivered, d.assignmentLatencyMin.p50, d.assignmentLatencyMin.p90,
    d.riderWaitAtRestaurantMin.p50, d.riderWaitAtRestaurantMin.p90, d.foodWaitingForRiderMin.p50, d.foodWaitingForRiderMin.p90,
    d.prepError.maeMin, d.prepError.biasMin, d.prepError.samples, d.onTimePct, d.readyTapRatePct, d.batchRatePct,
  ]);
}
