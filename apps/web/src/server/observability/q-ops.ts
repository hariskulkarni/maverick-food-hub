/**
 * Read side for Jobs, Notifications and Security tabs.
 */
import { prisma } from '../db';
import { ts } from './sql-time';
import { redactText } from './redact';
import { jobSchedules, computeJobHealth, type JobRunLite } from './jobs';
import { notifierConfig, isProductionInstance } from './q-infra';

// ─── Jobs ────────────────────────────────────────────────────────────────────

export async function jobsSnapshot(since: Date) {
  const schedules = jobSchedules();
  const [recent, rangeAgg, queue, staleLocked] = await Promise.all([
    prisma.$queryRaw<Array<JobRunLite & { id: string; job: string; trigger: string; httpStatus: number | null; summary: string | null }>>`
      SELECT id, job, trigger, status, "startedAt", "finishedAt", "durationMs", "httpStatus", summary, error FROM (
        SELECT *, row_number() OVER (PARTITION BY job ORDER BY "startedAt" DESC) AS rn
        FROM "ObsJobRun" WHERE "startedAt" >= (now() AT TIME ZONE 'UTC') - interval '90 days'
      ) x WHERE rn <= 25 ORDER BY job, "startedAt" DESC`,
    prisma.obsJobRun.groupBy({ by: ['job', 'status'], where: { startedAt: { gte: since } }, _count: { _all: true } }),
    prisma.job.groupBy({ by: ['status'], _count: { _all: true } }).catch(() => [] as Array<{ status: string; _count: { _all: number } }>),
    prisma.job.count({ where: { status: 'PROCESSING', lockedAt: { lt: new Date(Date.now() - 15 * 60_000) } } }).catch(() => 0),
  ]);

  const runsByJob = new Map<string, typeof recent>();
  for (const r of recent) {
    const arr = runsByJob.get(r.job) ?? [];
    arr.push(r);
    runsByJob.set(r.job, arr);
  }
  const names = new Set<string>([...schedules.map((s) => s.job), ...runsByJob.keys()]);
  const now = new Date();
  const jobs = [...names].map((job) => {
    const schedule = schedules.find((s) => s.job === job) ?? null;
    const runs = runsByJob.get(job) ?? [];
    const h = computeJobHealth(schedule, runs, now);
    const inRange = rangeAgg.filter((a) => a.job === job);
    const ok = inRange.find((a) => a.status === 'SUCCESS')?._count._all ?? 0;
    const failed = inRange.find((a) => a.status === 'FAILED')?._count._all ?? 0;
    return {
      job,
      cron: schedule?.cron ?? null,
      periodMin: schedule?.periodMin ?? null,
      description: schedule?.description ?? '',
      ...h,
      lastRunAt: h.lastRunAt?.toISOString() ?? null,
      rangeRuns: ok + failed,
      rangeSuccessRate: ok + failed ? ok / (ok + failed) : null,
      runs: runs.map((r) => ({
        id: r.id,
        status: r.status,
        trigger: r.trigger,
        startedAt: new Date(r.startedAt).toISOString(),
        durationMs: r.durationMs,
        httpStatus: r.httpStatus,
        summary: r.summary,
        error: r.error,
      })),
    };
  });
  const order = { OVERDUE: 0, FAILING: 1, NEVER: 2, RUNNING: 3, UNSCHEDULED: 4, OK: 5 } as Record<string, number>;
  jobs.sort((a, b) => (order[a.health] ?? 9) - (order[b.health] ?? 9) || a.job.localeCompare(b.job));
  return {
    jobs,
    queue: {
      byStatus: Object.fromEntries(queue.map((q) => [q.status, q._count._all])),
      staleLocked,
    },
  };
}

// ─── Notifications ───────────────────────────────────────────────────────────

export async function notificationsSnapshot(since: Date) {
  const [byChannel, byTemplate, reasons, mockEvents, cfg] = await Promise.all([
    prisma.notificationLog.groupBy({ by: ['channel', 'status'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.notificationLog.groupBy({
      by: ['template', 'status'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.$queryRaw<Array<{ channel: string; reason: string; n: bigint; last: Date }>>`
      SELECT channel::text AS channel, LEFT(COALESCE(error, 'unknown'), 160) AS reason, COUNT(*) AS n, MAX("createdAt") AS last
      FROM "NotificationLog" WHERE status = 'FAILED' AND "createdAt" >= ${ts(since)}
      GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 15`,
    prisma.obsEventMinute.groupBy({ by: ['dim1', 'dim2'], where: { kind: 'notify', minute: { gte: since } }, _sum: { count: true } }),
    Promise.resolve(notifierConfig()),
  ]);

  const channels = ['SMS', 'EMAIL', 'WHATSAPP', 'PUSH'].map((ch) => {
    const n = (st: string) => byChannel.find((r) => r.channel === ch && r.status === st)?._count._all ?? 0;
    const sent = n('SENT');
    const failed = n('FAILED');
    const queued = n('QUEUED');
    const mock = mockEvents.filter((e) => e.dim1 === ch && e.dim2.startsWith('mock')).reduce((a, e) => a + (e._sum.count ?? 0), 0);
    const live = mockEvents.filter((e) => e.dim1 === ch && e.dim2.startsWith('live')).reduce((a, e) => a + (e._sum.count ?? 0), 0);
    return {
      channel: ch,
      provider: cfg[ch],
      sent,
      failed,
      queued,
      failureRate: sent + failed ? failed / (sent + failed) : null,
      mockSends: mock,
      liveSends: live,
    };
  });

  const tmpl = new Map<string, { template: string; sent: number; failed: number; queued: number }>();
  for (const r of byTemplate) {
    const key = r.template ?? '(none)';
    const row = tmpl.get(key) ?? { template: key, sent: 0, failed: 0, queued: 0 };
    if (r.status === 'SENT') row.sent += r._count._all;
    else if (r.status === 'FAILED') row.failed += r._count._all;
    else row.queued += r._count._all;
    tmpl.set(key, row);
  }

  const prod = isProductionInstance();
  const mockInProd = channels
    .filter((c) => (c.provider === 'mock' && (c.sent > 0 || c.mockSends > 0)) || c.mockSends > 0)
    .map((c) => c.channel);

  return {
    production: prod,
    channels,
    templates: [...tmpl.values()].sort((a, b) => b.sent + b.failed - (a.sent + a.failed)).slice(0, 25),
    failureReasons: reasons.map((r) => ({ channel: r.channel, reason: redactText(r.reason, 160), count: Number(r.n), lastAt: r.last.toISOString() })),
    mock: {
      channelsUsingMock: mockInProd,
      // Only an alert-worthy problem on the real production instance; the demo runs mock on purpose.
      problem: prod && mockInProd.length > 0,
    },
  };
}

// ─── Security ────────────────────────────────────────────────────────────────

export async function securitySnapshot(since: Date) {
  const [authActions, failReasons, saActions, saRecent, denied, rateLimited, webhookRejects, webhookErrors, unauth] = await Promise.all([
    prisma.auditLog.groupBy({ by: ['action'], where: { createdAt: { gte: since }, action: { startsWith: 'auth.' } }, _count: { _all: true } }),
    prisma.$queryRaw<Array<{ reason: string | null; n: bigint }>>`
      SELECT "after"->>'reason' AS reason, COUNT(*) AS n FROM "AuditLog"
      WHERE action = 'auth.login.failed' AND "createdAt" >= ${ts(since)} GROUP BY 1 ORDER BY 2 DESC`,
    prisma.auditLog.groupBy({
      by: ['action'],
      where: { createdAt: { gte: since }, actorRole: 'SUPER_ADMIN' },
      _count: { _all: true },
      orderBy: { _count: { action: 'desc' } },
      take: 20,
    }),
    prisma.auditLog.findMany({
      where: { createdAt: { gte: since }, actorRole: 'SUPER_ADMIN' },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: { id: true, action: true, entityType: true, entityId: true, actorId: true, createdAt: true },
    }),
    prisma.obsEventMinute.groupBy({ by: ['dim1', 'dim2'], where: { kind: 'denied', minute: { gte: since } }, _sum: { count: true } }),
    prisma.$queryRaw<Array<{ route: string; n: bigint }>>`
      SELECT route, SUM(s429) AS n FROM "ObsRequestMinute" WHERE minute >= ${ts(since)} AND s429 > 0 GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
    prisma.obsEventMinute.groupBy({
      by: ['kind', 'dim1', 'dim2'],
      where: { kind: { in: ['webhook_reject', 'webhook_sig'] }, minute: { gte: since } },
      _sum: { count: true },
    }),
    prisma.paymentWebhookEvent.groupBy({ by: ['provider'], where: { createdAt: { gte: since }, error: { not: null } }, _count: { _all: true } }),
    prisma.$queryRaw<Array<{ n: bigint | null }>>`SELECT SUM(s401) AS n FROM "ObsRequestMinute" WHERE minute >= ${ts(since)}`,
  ]);
  const count = (a: string) => authActions.find((r) => r.action === a)?._count._all ?? 0;
  const like = (re: RegExp) => authActions.filter((r) => re.test(r.action)).reduce((s, r) => s + r._count._all, 0);
  const totpFailures = failReasons.filter((r) => (r.reason ?? '').startsWith('totp')).reduce((s, r) => s + Number(r.n), 0);
  return {
    logins: {
      failed: count('auth.login.failed'),
      lockouts: count('auth.login.locked'),
      breakGlass: count('auth.login.breakglass'),
      unregistered: count('auth.login.unregistered'),
      reasons: failReasons.map((r) => ({ reason: r.reason ?? 'unknown', count: Number(r.n) })),
    },
    twoFactor: {
      failures: totpFailures,
      // Authenticator resets (super-admin reset / legacy reset-on-password-reset),
      // not recovery-code sign-ins, which are counted separately.
      resets: like(/^auth\.totp\.(reset|cleared)/),
      recoveryCodesUsed: count('auth.totp.recovery_code_used'),
    },
    passwordResets: like(/^auth\.password\./),
    superAdmin: {
      byAction: saActions.map((r) => ({ action: r.action, count: r._count._all })),
      recent: saRecent.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    },
    denials: denied
      .map((d) => ({ route: d.dim1, role: d.dim2, count: d._sum.count ?? 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30),
    unauthenticated401: Number(unauth[0]?.n ?? 0),
    rateLimited: rateLimited.map((r) => ({ route: r.route, count: Number(r.n) })),
    webhooks: {
      rejects: webhookRejects.map((w) => ({ kind: w.kind, source: w.dim1, detail: w.dim2, count: w._sum.count ?? 0 })),
      processingErrors: webhookErrors.map((w) => ({ provider: w.provider, count: w._count._all })),
    },
  };
}
