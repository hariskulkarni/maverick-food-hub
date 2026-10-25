import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({ exec: vi.fn() }));
vi.mock('@/server/db', () => ({ prisma: { $executeRaw: h.exec } }));

import { recordRequest, incEvent, drain, restore, flushAggregates, requestUpsertSql, eventUpsertSql, ROUTE_CARDINALITY_CAP, minuteOf } from '@/server/observability/aggregator';
import { HIST_LEN } from '@/server/observability/histogram';

const T = Date.UTC(2026, 9, 25, 10, 0, 30);

beforeEach(() => {
  drain();
  h.exec.mockReset();
});

describe('per-minute aggregation', () => {
  it('folds requests into one bucket per (minute, method, route) with status classes', () => {
    recordRequest({ method: 'get', route: '/api/a', kind: 'API', status: 200, durationMs: 12, at: T });
    recordRequest({ method: 'GET', route: '/api/a', kind: 'API', status: 503, durationMs: 800, at: T + 5000 });
    recordRequest({ method: 'GET', route: '/api/a', kind: 'API', status: 403, durationMs: 3, at: T + 6000 });
    recordRequest({ method: 'GET', route: '/api/a', kind: 'API', status: 429, durationMs: 1, at: T + 7000 });
    recordRequest({ method: 'GET', route: '/api/a', kind: 'API', status: 200, durationMs: 5, at: T + 61_000 }); // next minute
    const { req } = drain();
    expect(req).toHaveLength(2);
    const b = req.find((r) => r.minute === minuteOf(T))!;
    expect(b).toMatchObject({ method: 'GET', count: 4, s2xx: 1, s4xx: 2, s5xx: 1, s403: 1, s429: 1, durMaxMs: 800 });
    expect(b.hist).toHaveLength(HIST_LEN);
    expect(b.hist.reduce((a, c) => a + c, 0)).toBe(4);
  });

  it('folds new routes into "other" past the cardinality cap', () => {
    for (let i = 0; i < ROUTE_CARDINALITY_CAP + 25; i++) recordRequest({ method: 'GET', route: `/r/${i}`, kind: 'PAGE', status: 200, durationMs: 1, at: T });
    const { req } = drain();
    expect(req.length).toBe(ROUTE_CARDINALITY_CAP + 1);
    expect(req.find((r) => r.route === 'other')?.count).toBe(25);
  });

  it('restore() merges a failed flush back without double counting', () => {
    recordRequest({ method: 'GET', route: '/api/a', kind: 'API', status: 200, durationMs: 10, at: T });
    incEvent('denied', '/api/a', 'ADMIN', 1, T);
    const d = drain();
    recordRequest({ method: 'GET', route: '/api/a', kind: 'API', status: 500, durationMs: 10, at: T });
    incEvent('denied', '/api/a', 'ADMIN', 2, T);
    restore(d);
    const after = drain();
    expect(after.req[0]).toMatchObject({ count: 2, s2xx: 1, s5xx: 1 });
    expect(after.evt[0].count).toBe(3);
  });

  it('builds a merging upsert (counts add, histograms add element-wise)', () => {
    recordRequest({ method: 'GET', route: '/api/a', kind: 'API', status: 200, durationMs: 10, at: T });
    const sql = requestUpsertSql(drain().req);
    expect(sql.sql).toContain('ON CONFLICT ("minute","method","route") DO UPDATE');
    expect(sql.sql).toContain('unnest("ObsRequestMinute"."hist", EXCLUDED."hist")');
    incEvent('notify', 'SMS', 'mock:SENT', 1, T);
    expect(eventUpsertSql(drain().evt).sql).toContain('ON CONFLICT ("minute","kind","dim1","dim2")');
  });

  it('flush writes once per table and restores on DB failure', async () => {
    recordRequest({ method: 'GET', route: '/api/a', kind: 'API', status: 200, durationMs: 10 });
    incEvent('x');
    h.exec.mockResolvedValue(1);
    expect(await flushAggregates()).toEqual({ requests: 1, events: 1 });
    expect(h.exec).toHaveBeenCalledTimes(2);
    recordRequest({ method: 'GET', route: '/api/a', kind: 'API', status: 200, durationMs: 10 });
    h.exec.mockRejectedValue(new Error('db down'));
    expect(await flushAggregates()).toEqual({ requests: 0, events: 0 });
    expect(drain().req).toHaveLength(1); // kept for the next flush
  });
});
