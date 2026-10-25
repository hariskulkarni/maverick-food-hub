/**
 * Runs every observability read/write path against a REAL Postgres (raw SQL:
 * histogram merge upserts, unnest/date_bin queries, pg_stat_* reads).
 * Opt-in: set OBS_TEST_DATABASE_URL to a disposable, migrated database.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const URL_ = process.env.OBS_TEST_DATABASE_URL;
vi.hoisted(() => {
  if (process.env.OBS_TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.OBS_TEST_DATABASE_URL;
});
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe.skipIf(!URL_)('observability against Postgres', () => {
  let prisma: typeof import('@/server/db').prisma;

  beforeAll(async () => {
    prisma = (await import('@/server/db')).prisma;
    await prisma.$executeRawUnsafe('TRUNCATE "ObsRequestMinute","ObsEventMinute","ObsJobRun","ObsAlert","ObsAlertMute","ObsErrorLog"');
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('flushes and merges per-minute aggregates; reads percentiles back', async () => {
    const agg = await import('@/server/observability/aggregator');
    const at = Date.now() - 30_000;
    for (let i = 0; i < 50; i++) agg.recordRequest({ method: 'GET', route: '/api/t', kind: 'API', status: 200, durationMs: 40, at });
    await agg.flushAggregates();
    for (let i = 0; i < 50; i++) agg.recordRequest({ method: 'GET', route: '/api/t', kind: 'API', status: i < 5 ? 500 : 200, durationMs: 900, at });
    agg.incEvent('denied', '/api/t', 'ADMIN', 3, at);
    await agg.flushAggregates();
    agg.incEvent('denied', '/api/t', 'ADMIN', 2, at);
    await agg.flushAggregates();

    const row = await prisma.obsRequestMinute.findFirst({ where: { route: '/api/t' } });
    expect(row).toMatchObject({ count: 100, s5xx: 5, s2xx: 95 });
    expect(row!.hist.reduce((a, b) => a + b, 0)).toBe(100);
    const ev = await prisma.obsEventMinute.findFirst({ where: { kind: 'denied' } });
    expect(ev?.count).toBe(5);

    const q = await import('@/server/observability/q-api');
    const since = new Date(Date.now() - 3_600_000);
    const stats = await q.routeStats(since, 60);
    const t = stats.find((s) => s.route === '/api/t')!;
    expect(t.errorRate).toBeCloseTo(0.05);
    expect(t.p50).toBeGreaterThan(25);
    expect(t.p95).toBeGreaterThan(750);
    const series = await q.series(since, 60, { route: '/api/t' });
    expect(series.reduce((a, p) => a + p.count, 0)).toBe(100);
    const tot = await q.windowTotals(since);
    expect(tot.count).toBeGreaterThanOrEqual(100);
  });

  it('every tab snapshot executes against the real schema', async () => {
    const since = new Date(Date.now() - 86_400_000);
    const [{ jobsSnapshot, notificationsSnapshot, securitySnapshot }, { businessHealth }, { infraSnapshot }, { overviewSnapshot }] = await Promise.all([
      import('@/server/observability/q-ops'),
      import('@/server/observability/q-business'),
      import('@/server/observability/q-infra'),
      import('@/server/observability/overview'),
    ]);
    const jobs = await jobsSnapshot(since);
    expect(jobs.jobs.find((j) => j.job === 'obs-alerts')).toBeTruthy();
    expect((await notificationsSnapshot(since)).channels).toHaveLength(4);
    expect((await securitySnapshot(since)).denials[0]).toMatchObject({ route: '/api/t', role: 'ADMIN' });
    const biz = await businessHealth(since, 1440);
    expect(biz.stuck).toHaveLength(4);
    const infra = await infraSnapshot();
    expect(infra.db.connections?.max).toBeGreaterThan(0);
    expect(infra.db.tables.length).toBeGreaterThan(0);
    const ov = await overviewSnapshot(since, 1440);
    expect(ov.score).toBeGreaterThanOrEqual(0);
  });

  it('job runs, alert lifecycle (fire → keep → resolve), retention', async () => {
    const jobs = await import('@/server/observability/jobs');
    const id = await jobs.recordJobStart('kyc-expiry', 'CRON');
    await jobs.recordJobFinish(id, { ok: false, startedAt: Date.now() - 50, httpStatus: 500, error: 'boom' });
    expect(await prisma.obsJobRun.findUnique({ where: { id: id! } })).toMatchObject({ status: 'FAILED', httpStatus: 500, error: 'boom' });

    const { runAlertEvaluation } = await import('@/server/observability/alerts');
    const signals = {
      api5m: { count: 100, errorRate: 0.1, p95: 100 }, jobs: [], stuck: [], notify30m: [], db: null, disk: null,
      mockInProduction: [], probesDown: [], sos: { open: 0, oldestMin: null }, collectingForMin: 10,
    };
    const r1 = await runAlertEvaluation({ signals, notify: false });
    expect(r1.fired).toBe(1);
    const r2 = await runAlertEvaluation({ signals, notify: false });
    expect(r2.fired).toBe(0);
    expect(await prisma.obsAlert.count({ where: { state: 'FIRING' } })).toBe(1);
    const r3 = await runAlertEvaluation({ signals: { ...signals, api5m: { count: 100, errorRate: 0, p95: 100 } }, notify: false });
    expect(r3.resolved).toBe(1);

    await prisma.obsRequestMinute.create({ data: { minute: new Date(Date.now() - 31 * 86_400_000), method: 'GET', route: '/old', hist: [] } });
    await prisma.obsJobRun.create({ data: { job: 'x', status: 'RUNNING', startedAt: new Date(Date.now() - 3 * 3_600_000) } });
    const { runRetention } = await import('@/server/observability/retention');
    const ret = await runRetention();
    expect(ret.deleted.requestMinutes).toBe(1);
    expect(ret.staleRunsClosed).toBe(1);
    expect(await prisma.obsProbe.findUnique({ where: { target: 'db:table-sizes' } })).toBeTruthy();
  });

  it('records redacted errors and dedupes them', async () => {
    const { recordError } = await import('@/server/observability/store');
    await recordError({ source: 'x', message: 'fail for user a@b.com id cm1abcdefghijklmnopqrstu' });
    await recordError({ source: 'x', message: 'fail for user c@d.com id cm2abcdefghijklmnopqrstu' });
    const rows = await prisma.obsErrorLog.findMany({ where: { source: 'x' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
    expect(rows[0].message).not.toContain('@');
  });
});
