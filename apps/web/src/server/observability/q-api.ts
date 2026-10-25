/**
 * Read side for API golden signals (ObsRequestMinute).
 */
import { Prisma } from '@prisma/client';
import { ts } from './sql-time';
import { prisma } from '../db';
import { emptyHist, percentile, HIST_LEN } from './histogram';

export function stepMinutesFor(rangeMin: number): number {
  if (rangeMin <= 60) return 1;
  if (rangeMin <= 1440) return 15;
  return 120;
}

export interface RouteStat {
  route: string;
  method: string;
  kind: string;
  count: number;
  rpm: number;
  s4xx: number;
  s5xx: number;
  s401: number;
  s403: number;
  s429: number;
  errorRate: number; // 5xx / count
  clientErrorRate: number; // 4xx / count
  avgMs: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  maxMs: number;
}

type TotRow = {
  route: string; method: string; kind: string; count: bigint; s4xx: bigint; s5xx: bigint;
  s401: bigint; s403: bigint; s429: bigint; dur: number; mx: number;
};
type HistRow = { route: string; method: string; i: bigint; v: bigint };

export async function routeStats(since: Date, rangeMin: number, opts: { kind?: 'API' | 'PAGE' } = {}): Promise<RouteStat[]> {
  const kindFilter = opts.kind ? Prisma.sql`AND "kind" = ${opts.kind}` : Prisma.empty;
  const [tot, hist] = await Promise.all([
    prisma.$queryRaw<TotRow[]>`
      SELECT "route", "method", MAX("kind") AS kind, SUM("count") AS count, SUM("s4xx") AS s4xx, SUM("s5xx") AS s5xx,
             SUM("s401") AS s401, SUM("s403") AS s403, SUM("s429") AS s429,
             SUM("durSumMs")::float8 AS dur, MAX("durMaxMs")::int AS mx
      FROM "ObsRequestMinute" WHERE "minute" >= ${ts(since)} ${kindFilter}
      GROUP BY "route", "method"`,
    prisma.$queryRaw<HistRow[]>`
      SELECT r."route", r."method", u.i, SUM(u.v) AS v
      FROM "ObsRequestMinute" r, unnest(r."hist") WITH ORDINALITY AS u(v, i)
      WHERE r."minute" >= ${ts(since)} ${kindFilter}
      GROUP BY 1, 2, 3`,
  ]);
  const hists = new Map<string, number[]>();
  for (const h of hist) {
    const k = `${h.method} ${h.route}`;
    const arr = hists.get(k) ?? emptyHist();
    const idx = Number(h.i) - 1;
    if (idx >= 0 && idx < HIST_LEN) arr[idx] += Number(h.v);
    hists.set(k, arr);
  }
  return tot
    .map((t) => {
      const count = Number(t.count);
      const h = hists.get(`${t.method} ${t.route}`) ?? emptyHist();
      const s5xx = Number(t.s5xx);
      const s4xx = Number(t.s4xx);
      return {
        route: t.route,
        method: t.method,
        kind: t.kind,
        count,
        rpm: Math.round((count / Math.max(1, rangeMin)) * 100) / 100,
        s4xx,
        s5xx,
        s401: Number(t.s401),
        s403: Number(t.s403),
        s429: Number(t.s429),
        errorRate: count ? s5xx / count : 0,
        clientErrorRate: count ? s4xx / count : 0,
        avgMs: count ? Math.round(t.dur / count) : null,
        p50: percentile(h, 50, t.mx),
        p95: percentile(h, 95, t.mx),
        p99: percentile(h, 99, t.mx),
        maxMs: t.mx,
      };
    })
    .sort((a, b) => b.count - a.count);
}

export interface SeriesPoint {
  t: string;
  count: number;
  s4xx: number;
  s5xx: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

/** Time series for all API traffic, or one route (route + optional method). */
export async function series(
  since: Date,
  rangeMin: number,
  filter: { route?: string | null; method?: string | null; kind?: 'API' | 'PAGE' } = {},
): Promise<SeriesPoint[]> {
  const step = stepMinutesFor(rangeMin);
  const interval = `${step} minutes`;
  const conds: Prisma.Sql[] = [Prisma.sql`"minute" >= ${ts(since)}`];
  if (filter.route) conds.push(Prisma.sql`"route" = ${filter.route}`);
  if (filter.method) conds.push(Prisma.sql`"method" = ${filter.method}`);
  if (filter.kind) conds.push(Prisma.sql`"kind" = ${filter.kind}`);
  const where = Prisma.join(conds, ' AND ');
  const [tot, hist] = await Promise.all([
    prisma.$queryRaw<Array<{ b: Date; count: bigint; s4xx: bigint; s5xx: bigint; mx: number }>>`
      SELECT date_bin(${interval}::interval, "minute", TIMESTAMP '2000-01-01') AS b,
             SUM("count") AS count, SUM("s4xx") AS s4xx, SUM("s5xx") AS s5xx, MAX("durMaxMs")::int AS mx
      FROM "ObsRequestMinute" WHERE ${where} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<Array<{ b: Date; i: bigint; v: bigint }>>`
      SELECT date_bin(${interval}::interval, r."minute", TIMESTAMP '2000-01-01') AS b, u.i, SUM(u.v) AS v
      FROM "ObsRequestMinute" r, unnest(r."hist") WITH ORDINALITY AS u(v, i)
      WHERE ${where} GROUP BY 1, 2`,
  ]);
  const hists = new Map<number, number[]>();
  for (const h of hist) {
    const k = new Date(h.b).getTime();
    const arr = hists.get(k) ?? emptyHist();
    const idx = Number(h.i) - 1;
    if (idx >= 0 && idx < HIST_LEN) arr[idx] += Number(h.v);
    hists.set(k, arr);
  }
  // Fill gaps so charts show true zero-traffic periods.
  const byT = new Map(tot.map((r) => [new Date(r.b).getTime(), r]));
  const out: SeriesPoint[] = [];
  const stepMs = step * 60_000;
  const epoch = Date.UTC(2000, 0, 1);
  let t = since.getTime() - ((since.getTime() - epoch) % stepMs);
  const end = Date.now();
  for (; t <= end; t += stepMs) {
    const r = byT.get(t);
    const h = hists.get(t) ?? emptyHist();
    out.push({
      t: new Date(t).toISOString(),
      count: r ? Number(r.count) : 0,
      s4xx: r ? Number(r.s4xx) : 0,
      s5xx: r ? Number(r.s5xx) : 0,
      p50: r ? percentile(h, 50, r.mx) : null,
      p95: r ? percentile(h, 95, r.mx) : null,
      p99: r ? percentile(h, 99, r.mx) : null,
    });
  }
  return out;
}

/** Totals across all routes in a window (used by overview + alert rules). */
export async function windowTotals(since: Date, kind: 'API' | 'PAGE' | null = 'API') {
  const kindFilter = kind ? Prisma.sql`AND r."kind" = ${kind}` : Prisma.empty;
  const [tot, hist] = await Promise.all([
    prisma.$queryRaw<Array<{ count: bigint | null; s4xx: bigint | null; s5xx: bigint | null; mx: number | null }>>`
      SELECT SUM("count") AS count, SUM("s4xx") AS s4xx, SUM("s5xx") AS s5xx, MAX("durMaxMs")::int AS mx
      FROM "ObsRequestMinute" r WHERE r."minute" >= ${ts(since)} ${kindFilter}`,
    prisma.$queryRaw<Array<{ i: bigint; v: bigint }>>`
      SELECT u.i, SUM(u.v) AS v FROM "ObsRequestMinute" r, unnest(r."hist") WITH ORDINALITY AS u(v, i)
      WHERE r."minute" >= ${ts(since)} ${kindFilter} GROUP BY 1`,
  ]);
  const h = emptyHist();
  for (const r of hist) {
    const idx = Number(r.i) - 1;
    if (idx >= 0 && idx < HIST_LEN) h[idx] += Number(r.v);
  }
  const t = tot[0] ?? { count: 0n, s4xx: 0n, s5xx: 0n, mx: 0 };
  const count = Number(t.count ?? 0);
  return {
    count,
    s4xx: Number(t.s4xx ?? 0),
    s5xx: Number(t.s5xx ?? 0),
    errorRate: count ? Number(t.s5xx ?? 0) / count : 0,
    p50: percentile(h, 50, t.mx ?? undefined),
    p95: percentile(h, 95, t.mx ?? undefined),
    p99: percentile(h, 99, t.mx ?? undefined),
  };
}
