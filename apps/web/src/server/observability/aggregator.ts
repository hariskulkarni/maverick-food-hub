/**
 * In-process, per-minute aggregation of request metrics and generic event
 * counters, flushed to Postgres as one multi-row upsert per table per flush.
 *
 * Cost per request: one Map lookup + a handful of integer increments. Nothing
 * per-request ever touches the database. Flushes merge into existing rows with
 * ON CONFLICT … DO UPDATE (counts add, histograms add element-wise), so several
 * processes — or several flushes within one minute — combine correctly.
 */
import { Prisma } from '@prisma/client';
import { ts } from './sql-time';
import { emptyHist, addToHist, HIST_LEN } from './histogram';
import type { RouteKind } from './routes';

/** Max distinct (method, route) series per minute before folding into "other". */
export const ROUTE_CARDINALITY_CAP = 400;
/** Max distinct event series per minute. */
export const EVENT_CARDINALITY_CAP = 2000;

export interface RequestBucket {
  minute: number; // epoch ms, truncated to minute
  method: string;
  route: string;
  kind: RouteKind;
  count: number;
  s2xx: number;
  s3xx: number;
  s4xx: number;
  s5xx: number;
  s401: number;
  s403: number;
  s429: number;
  durSumMs: number;
  durMaxMs: number;
  hist: number[];
}

export interface EventBucket {
  minute: number;
  kind: string;
  dim1: string;
  dim2: string;
  count: number;
}

interface State {
  req: Map<string, RequestBucket>;
  evt: Map<string, EventBucket>;
  seriesPerMinute: Map<number, number>;
}

declare global {
  // eslint-disable-next-line no-var
  var __obsAgg: State | undefined;
}

function state(): State {
  if (!global.__obsAgg) global.__obsAgg = { req: new Map(), evt: new Map(), seriesPerMinute: new Map() };
  return global.__obsAgg;
}

export function minuteOf(ts: number): number {
  return ts - (ts % 60_000);
}

export function recordRequest(i: {
  method: string;
  route: string;
  kind: RouteKind;
  status: number;
  durationMs: number;
  at?: number;
}): void {
  const s = state();
  const minute = minuteOf(i.at ?? Date.now());
  const method = i.method.toUpperCase().slice(0, 10);
  let route = i.route.slice(0, 200);
  let key = `${minute}|${method}|${route}`;
  let b = s.req.get(key);
  if (!b) {
    const n = s.seriesPerMinute.get(minute) ?? 0;
    if (n >= ROUTE_CARDINALITY_CAP) {
      route = 'other';
      key = `${minute}|${method}|${route}`;
      b = s.req.get(key);
    } else {
      s.seriesPerMinute.set(minute, n + 1);
    }
  }
  if (!b) {
    b = {
      minute, method, route, kind: i.kind,
      count: 0, s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0, s401: 0, s403: 0, s429: 0,
      durSumMs: 0, durMaxMs: 0, hist: emptyHist(),
    };
    s.req.set(key, b);
  }
  const st = i.status;
  const d = Math.max(0, i.durationMs);
  b.count += 1;
  if (st >= 500) b.s5xx += 1;
  else if (st >= 400) b.s4xx += 1;
  else if (st >= 300) b.s3xx += 1;
  else b.s2xx += 1;
  if (st === 401) b.s401 += 1;
  if (st === 403) b.s403 += 1;
  if (st === 429) b.s429 += 1;
  b.durSumMs += d;
  if (d > b.durMaxMs) b.durMaxMs = Math.round(d);
  addToHist(b.hist, d);
}

/** Increment a generic counter, e.g. incEvent('denied', '/api/x', 'ADMIN'). */
export function incEvent(kind: string, dim1 = '', dim2 = '', by = 1, at?: number): void {
  const s = state();
  const minute = minuteOf(at ?? Date.now());
  const k = `${minute}|${kind}|${dim1}|${dim2}`;
  const b = s.evt.get(k);
  if (b) {
    b.count += by;
    return;
  }
  if (s.evt.size >= EVENT_CARDINALITY_CAP) return; // drop rather than grow unbounded
  s.evt.set(k, { minute, kind: kind.slice(0, 40), dim1: dim1.slice(0, 200), dim2: dim2.slice(0, 120), count: by });
}

/** Take everything accumulated so far (the in-memory state is reset). */
export function drain(): { req: RequestBucket[]; evt: EventBucket[] } {
  const s = state();
  const out = { req: [...s.req.values()], evt: [...s.evt.values()] };
  s.req.clear();
  s.evt.clear();
  s.seriesPerMinute.clear();
  return out;
}

/** Put drained buckets back (flush failed) — merged so nothing is double counted. */
export function restore(d: { req: RequestBucket[]; evt: EventBucket[] }): void {
  const s = state();
  for (const r of d.req) {
    const key = `${r.minute}|${r.method}|${r.route}`;
    const b = s.req.get(key);
    if (!b) {
      s.req.set(key, r);
      continue;
    }
    b.count += r.count; b.s2xx += r.s2xx; b.s3xx += r.s3xx; b.s4xx += r.s4xx; b.s5xx += r.s5xx;
    b.s401 += r.s401; b.s403 += r.s403; b.s429 += r.s429; b.durSumMs += r.durSumMs;
    b.durMaxMs = Math.max(b.durMaxMs, r.durMaxMs);
    for (let i = 0; i < HIST_LEN; i++) b.hist[i] += r.hist[i] ?? 0;
  }
  for (const e of d.evt) {
    const k = `${e.minute}|${e.kind}|${e.dim1}|${e.dim2}`;
    const b = s.evt.get(k);
    if (b) b.count += e.count;
    else s.evt.set(k, e);
  }
}

export function requestUpsertSql(rows: RequestBucket[]): Prisma.Sql {
  const values = rows.map(
    (r) => Prisma.sql`(${ts(r.minute)}, ${r.method}, ${r.route}, ${r.kind}, ${r.count}, ${r.s2xx}, ${r.s3xx}, ${r.s4xx}, ${r.s5xx}, ${r.s401}, ${r.s403}, ${r.s429}, ${r.durSumMs}, ${r.durMaxMs}, ${r.hist}::int[])`,
  );
  return Prisma.sql`
    INSERT INTO "ObsRequestMinute" ("minute","method","route","kind","count","s2xx","s3xx","s4xx","s5xx","s401","s403","s429","durSumMs","durMaxMs","hist")
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("minute","method","route") DO UPDATE SET
      "count" = "ObsRequestMinute"."count" + EXCLUDED."count",
      "s2xx" = "ObsRequestMinute"."s2xx" + EXCLUDED."s2xx",
      "s3xx" = "ObsRequestMinute"."s3xx" + EXCLUDED."s3xx",
      "s4xx" = "ObsRequestMinute"."s4xx" + EXCLUDED."s4xx",
      "s5xx" = "ObsRequestMinute"."s5xx" + EXCLUDED."s5xx",
      "s401" = "ObsRequestMinute"."s401" + EXCLUDED."s401",
      "s403" = "ObsRequestMinute"."s403" + EXCLUDED."s403",
      "s429" = "ObsRequestMinute"."s429" + EXCLUDED."s429",
      "durSumMs" = "ObsRequestMinute"."durSumMs" + EXCLUDED."durSumMs",
      "durMaxMs" = GREATEST("ObsRequestMinute"."durMaxMs", EXCLUDED."durMaxMs"),
      "hist" = ARRAY(
        SELECT COALESCE(a, 0) + COALESCE(b, 0)
        FROM unnest("ObsRequestMinute"."hist", EXCLUDED."hist") AS u(a, b)
      )`;
}

export function eventUpsertSql(rows: EventBucket[]): Prisma.Sql {
  const values = rows.map((e) => Prisma.sql`(${ts(e.minute)}, ${e.kind}, ${e.dim1}, ${e.dim2}, ${e.count})`);
  return Prisma.sql`
    INSERT INTO "ObsEventMinute" ("minute","kind","dim1","dim2","count")
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("minute","kind","dim1","dim2") DO UPDATE SET
      "count" = "ObsEventMinute"."count" + EXCLUDED."count"`;
}

const CHUNK = 500;

/**
 * Write everything accumulated so far. Never throws; on failure the buckets are
 * restored (so the next flush retries them), bounded by the cardinality caps.
 */
export async function flushAggregates(): Promise<{ requests: number; events: number }> {
  const d = drain();
  if (!d.req.length && !d.evt.length) return { requests: 0, events: 0 };
  try {
    const { prisma } = await import('../db');
    for (let i = 0; i < d.req.length; i += CHUNK) await prisma.$executeRaw(requestUpsertSql(d.req.slice(i, i + CHUNK)));
    for (let i = 0; i < d.evt.length; i += CHUNK) await prisma.$executeRaw(eventUpsertSql(d.evt.slice(i, i + CHUNK)));
    return { requests: d.req.length, events: d.evt.length };
  } catch {
    // Drop anything older than 10 minutes instead of retrying forever.
    const cutoff = minuteOf(Date.now()) - 10 * 60_000;
    restore({ req: d.req.filter((r) => r.minute >= cutoff), evt: d.evt.filter((e) => e.minute >= cutoff) });
    return { requests: 0, events: 0 };
  }
}
