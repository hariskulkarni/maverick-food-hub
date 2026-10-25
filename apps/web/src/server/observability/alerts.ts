/**
 * Alert rules + evaluator (run every minute by the obs-alerts job).
 *
 *   evaluateRules(signals)  — PURE: signals in, alert candidates out (unit-tested).
 *   runAlertEvaluation()    — gathers signals from the DB, reconciles candidates
 *                             with ObsAlert rows (fire / keep / resolve), and sends
 *                             debounced e-mail (+ SMS for CRITICAL) to super-admins.
 *
 * Mutes suppress NOTIFICATIONS only — a muted alert still shows as firing.
 */
import { prisma } from '../db';
import { ts } from './sql-time';
import { windowTotals } from './q-api';
import { stuckOrders, type StuckSummary } from './q-business';
import { dbConnections, diskFree, notifierConfig, isProductionInstance } from './q-infra';
import { jobSchedules, computeJobHealth, overdueAfterMin, type JobHealth } from './jobs';

export type Severity = 'CRITICAL' | 'WARNING';

export interface AlertCandidate {
  rule: string;
  ruleKey: string;
  severity: Severity;
  title: string;
  detail: string;
  value: number | null;
  threshold: number | null;
}

const RULE_P95 = 'api_p95_latency';

export const THRESHOLDS = {
  minRequests: 20,
  errorRateWarn: 0.02,
  errorRateCrit: 0.05,
  p95WarnMs: Number(process.env.OBS_P95_WARN_MS) || 1500,
  p95CritMs: Number(process.env.OBS_P95_CRIT_MS) || 4000,
  notifyFailMin: 5,
  notifyFailWarn: 0.2,
  notifyFailCrit: 0.5,
  dbConnWarn: 0.8,
  dbConnCrit: 0.9,
  diskFreeWarnPct: 15,
  diskFreeCritPct: 7,
  sosAckMin: 2,
} as const;

export interface AlertSignals {
  api5m: { count: number; errorRate: number; p95: number | null } | null;
  jobs: Array<{ job: string; health: JobHealth; minutesSinceLastRun: number | null; periodMin: number | null; consecutiveFailures: number; lastError: string | null }>;
  stuck: Array<Pick<StuckSummary, 'key' | 'label' | 'count' | 'oldestMin' | 'thresholdMin'>>;
  notify30m: Array<{ channel: string; sent: number; failed: number }>;
  db: { total: number; max: number } | null;
  disk: { freePct: number; freeGB: number; path: string } | null;
  mockInProduction: string[]; // channels
  probesDown: Array<{ target: string; label: string; detail: string | null }>;
  sos: { open: number; oldestMin: number | null };
  /** Minutes the observability system has been collecting data (null = unknown). */
  collectingForMin: number | null;
}

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

export function evaluateRules(s: AlertSignals, t = THRESHOLDS): AlertCandidate[] {
  const out: AlertCandidate[] = [];

  if (s.api5m && s.api5m.count >= t.minRequests) {
    const er = s.api5m.errorRate;
    if (er >= t.errorRateWarn) {
      out.push({
        rule: 'api_error_rate',
        ruleKey: 'api_error_rate',
        severity: er >= t.errorRateCrit ? 'CRITICAL' : 'WARNING',
        title: `API 5xx error rate ${pct(er)} (last 5 min)`,
        detail: `${Math.round(er * s.api5m.count)} of ${s.api5m.count} API requests failed with 5xx.`,
        value: er,
        threshold: er >= t.errorRateCrit ? t.errorRateCrit : t.errorRateWarn,
      });
    }
    const p95 = s.api5m.p95;
    if (p95 !== null && p95 >= t.p95WarnMs) {
      out.push({
        rule: RULE_P95,
        ruleKey: RULE_P95,
        severity: p95 >= t.p95CritMs ? 'CRITICAL' : 'WARNING',
        title: `API P95 latency ${p95} ms (last 5 min)`,
        detail: `P95 over ${s.api5m.count} requests is above ${p95 >= t.p95CritMs ? t.p95CritMs : t.p95WarnMs} ms.`,
        value: p95,
        threshold: p95 >= t.p95CritMs ? t.p95CritMs : t.p95WarnMs,
      });
    }
  }

  for (const j of s.jobs) {
    if (j.health === 'OVERDUE') {
      out.push({
        rule: 'job_overdue',
        ruleKey: `job_overdue:${j.job}`,
        severity: j.job.startsWith('phonepe') || j.job.startsWith('youpi') ? 'CRITICAL' : 'WARNING',
        title: `Job "${j.job}" is overdue`,
        detail: `Last run ${j.minutesSinceLastRun ?? '?'} min ago; expected every ${j.periodMin ?? '?'} min. Check /etc/cron.d/flavrly-jobs and the jobs log.`,
        value: j.minutesSinceLastRun,
        threshold: j.periodMin,
      });
    }
    if (
      j.health === 'NEVER' &&
      j.periodMin !== null &&
      s.collectingForMin !== null &&
      s.collectingForMin > overdueAfterMin(j.periodMin)
    ) {
      out.push({
        rule: 'job_overdue',
        ruleKey: `job_overdue:${j.job}`,
        severity: 'WARNING',
        title: `Job "${j.job}" has never run`,
        detail: `No run recorded in ${s.collectingForMin} min of monitoring; expected every ${j.periodMin} min. Is the cron line installed?`,
        value: null,
        threshold: j.periodMin,
      });
    }
    if (j.consecutiveFailures >= 1 && j.health !== 'OVERDUE') {
      out.push({
        rule: 'job_failing',
        ruleKey: `job_failing:${j.job}`,
        severity: j.consecutiveFailures >= 3 ? 'CRITICAL' : 'WARNING',
        title: `Job "${j.job}" failing (${j.consecutiveFailures} in a row)`,
        detail: j.lastError ? `Last error: ${j.lastError}` : 'Last run failed.',
        value: j.consecutiveFailures,
        threshold: 1,
      });
    }
  }

  for (const st of s.stuck) {
    if (st.count > 0) {
      out.push({
        rule: 'stuck_orders',
        ruleKey: `stuck_orders:${st.key}`,
        severity: st.key === 'PAYMENT_PENDING' ? 'WARNING' : st.count >= 3 ? 'CRITICAL' : 'WARNING',
        title: `${st.count} order(s) stuck: ${st.label}`,
        detail: `Older than ${st.thresholdMin} min; oldest is ${st.oldestMin ?? '?'} min.`,
        value: st.count,
        threshold: st.thresholdMin,
      });
    }
  }

  for (const n of s.notify30m) {
    const total = n.sent + n.failed;
    if (total >= t.notifyFailMin) {
      const rate = n.failed / total;
      if (rate >= t.notifyFailWarn) {
        out.push({
          rule: 'notification_failures',
          ruleKey: `notification_failures:${n.channel}`,
          severity: rate >= t.notifyFailCrit ? 'CRITICAL' : 'WARNING',
          title: `${n.channel} delivery failing: ${pct(rate)} (last 30 min)`,
          detail: `${n.failed} of ${total} ${n.channel} notifications failed.`,
          value: rate,
          threshold: t.notifyFailWarn,
        });
      }
    }
  }

  if (s.db && s.db.max > 0) {
    const used = s.db.total / s.db.max;
    if (used >= t.dbConnWarn) {
      out.push({
        rule: 'db_connections',
        ruleKey: 'db_connections',
        severity: used >= t.dbConnCrit ? 'CRITICAL' : 'WARNING',
        title: `Postgres connections at ${pct(used)} of max`,
        detail: `${s.db.total} of ${s.db.max} connections in use.`,
        value: used,
        threshold: t.dbConnWarn,
      });
    }
  }

  if (s.disk && s.disk.freePct <= t.diskFreeWarnPct) {
    out.push({
      rule: 'disk_low',
      ruleKey: 'disk_low',
      severity: s.disk.freePct <= t.diskFreeCritPct ? 'CRITICAL' : 'WARNING',
      title: `Disk space low: ${s.disk.freePct}% free (${s.disk.freeGB} GB)`,
      detail: `Volume holding ${s.disk.path}.`,
      value: s.disk.freePct,
      threshold: t.diskFreeWarnPct,
    });
  }

  if (s.mockInProduction.length) {
    out.push({
      rule: 'mock_notifier',
      ruleKey: 'mock_notifier',
      severity: 'CRITICAL',
      title: `Mock notifier active in production: ${s.mockInProduction.join(', ')}`,
      detail: 'Customers and riders are NOT receiving these messages. Configure a real provider (NOTIFIER_SMS / NOTIFIER_EMAIL / NOTIFIER_WHATSAPP).',
      value: s.mockInProduction.length,
      threshold: 0,
    });
  }

  for (const p of s.probesDown) {
    out.push({
      rule: 'probe_down',
      ruleKey: `probe_down:${p.target}`,
      severity: 'CRITICAL',
      title: `${p.label} is DOWN`,
      detail: p.detail ?? 'Health probe failing.',
      value: null,
      threshold: null,
    });
  }

  if (s.sos.open > 0 && (s.sos.oldestMin ?? 0) >= t.sosAckMin) {
    out.push({
      rule: 'sos_open',
      ruleKey: 'sos_open',
      severity: 'CRITICAL',
      title: `${s.sos.open} rider SOS alert(s) open`,
      detail: `Oldest has been open ${s.sos.oldestMin} min. Respond from /platform/rider-sos.`,
      value: s.sos.open,
      threshold: 0,
    });
  }

  return out;
}

// ─── signal gathering ────────────────────────────────────────────────────────

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export async function gatherSignals(): Promise<AlertSignals> {
  const now = new Date();
  const fiveMin = new Date(now.getTime() - 5 * 60_000);
  const thirtyMin = new Date(now.getTime() - 30 * 60_000);
  const schedules = jobSchedules();

  const [api, jobRuns, stuck, notify, db, disk, mockEvents, probes, sos] = await Promise.all([
    safe(() => windowTotals(fiveMin, 'API'), null),
    safe(
      () => prisma.$queryRaw<Array<{ job: string; status: string; startedAt: Date; finishedAt: Date | null; durationMs: number | null; error: string | null }>>`
        SELECT job, status, "startedAt", "finishedAt", "durationMs", error FROM (
          SELECT *, row_number() OVER (PARTITION BY job ORDER BY "startedAt" DESC) AS rn
          FROM "ObsJobRun" WHERE "startedAt" >= (now() AT TIME ZONE 'UTC') - interval '35 days'
        ) x WHERE rn <= 5`,
      [],
    ),
    safe(() => stuckOrders(), []),
    safe(() => prisma.notificationLog.groupBy({ by: ['channel', 'status'], where: { createdAt: { gte: thirtyMin } }, _count: { _all: true } }), []),
    dbConnections(),
    diskFree(),
    safe(() => prisma.obsEventMinute.groupBy({ by: ['dim1'], where: { kind: 'notify', dim2: { startsWith: 'mock' }, minute: { gte: new Date(now.getTime() - 60 * 60_000) } }, _sum: { count: true } }), []),
    safe(() => prisma.obsProbe.findMany({ where: { status: 'DOWN', target: { in: ['db', 'app', 'system', 'ssl', 'dns'] }, checkedAt: { gte: new Date(now.getTime() - 10 * 60_000) } } }), []),
    safe(() => prisma.sosAlert.findFirst({ where: { status: 'ACTIVE' }, orderBy: { triggeredAt: 'asc' }, select: { triggeredAt: true } }), null),
  ]);
  const firstMinute = await safe(() => prisma.obsRequestMinute.findFirst({ orderBy: { minute: 'asc' }, select: { minute: true } }), null);
  const sosOpen = sos ? await safe(() => prisma.sosAlert.count({ where: { status: 'ACTIVE' } }), 0) : 0;

  const runsByJob = new Map<string, typeof jobRuns>();
  for (const r of jobRuns) runsByJob.set(r.job, [...(runsByJob.get(r.job) ?? []), r]);
  const jobs = schedules.map((sch) => {
    const runs = (runsByJob.get(sch.job) ?? []).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    const h = computeJobHealth(sch, runs, now);
    const lastFailed = runs.find((r) => r.status === 'FAILED');
    return {
      job: sch.job,
      health: h.health,
      minutesSinceLastRun: h.minutesSinceLastRun,
      periodMin: sch.periodMin,
      consecutiveFailures: h.consecutiveFailures,
      lastError: lastFailed?.error ?? null,
    };
  });

  const cfg = notifierConfig();
  const prod = isProductionInstance();
  const mockChannels = new Set<string>();
  if (prod) {
    for (const e of mockEvents) if ((e._sum.count ?? 0) > 0) mockChannels.add(e.dim1);
    // SMS carries OTP login: a mock SMS provider in production is a problem even before traffic.
    if (cfg.SMS === 'mock') mockChannels.add('SMS');
  }

  return {
    api5m: api ? { count: api.count, errorRate: api.errorRate, p95: api.p95 } : null,
    jobs,
    stuck: stuck.map((s) => ({ key: s.key, label: s.label, count: s.count, oldestMin: s.oldestMin, thresholdMin: s.thresholdMin })),
    notify30m: ['SMS', 'EMAIL', 'WHATSAPP', 'PUSH'].map((ch) => ({
      channel: ch,
      sent: notify.find((n) => n.channel === ch && n.status === 'SENT')?._count._all ?? 0,
      failed: notify.find((n) => n.channel === ch && n.status === 'FAILED')?._count._all ?? 0,
    })),
    db: db ? { total: db.total, max: db.max } : null,
    disk: disk ? { freePct: disk.freePct, freeGB: disk.freeGB, path: disk.path } : null,
    mockInProduction: [...mockChannels],
    probesDown: probes.map((p) => ({ target: p.target, label: p.label, detail: p.detail })),
    sos: { open: sosOpen, oldestMin: sos ? Math.round((now.getTime() - sos.triggeredAt.getTime()) / 60_000) : null },
    collectingForMin: firstMinute ? Math.round((now.getTime() - firstMinute.minute.getTime()) / 60_000) : null,
  };
}

// ─── reconciliation + notification ───────────────────────────────────────────

const NOTIFY_DEBOUNCE_MIN = 30;
const REMIND_EVERY_MIN = 60;

/** Pure: should we notify for this alert right now? */
export function shouldNotify(
  a: { severity: string; notifiedAt: Date | null; acknowledgedAt: Date | null; isNew: boolean },
  muted: boolean,
  now: Date = new Date(),
): boolean {
  if (muted || a.acknowledgedAt) return false;
  if (a.isNew || !a.notifiedAt) return true;
  return now.getTime() - a.notifiedAt.getTime() >= REMIND_EVERY_MIN * 60_000;
}

export function isMuted(ruleKey: string, rule: string, mutes: Array<{ key: string; until: Date }>, now: Date = new Date()): boolean {
  return mutes.some((m) => (m.key === ruleKey || m.key === rule) && m.until.getTime() > now.getTime());
}

async function notifySuperAdmins(alert: AlertCandidate, reminder: boolean): Promise<boolean> {
  try {
    // Debounce across processes / overlapping runs with the shared AlertDebounce table.
    const key = { entityType: 'ObsAlert', entityId: alert.ruleKey, kind: 'obs.alert' };
    const prev = await prisma.alertDebounce.findUnique({ where: { entityType_entityId_kind: key } });
    if (prev && Date.now() - prev.lastSentAt.getTime() < NOTIFY_DEBOUNCE_MIN * 60_000) return false;
    await prisma.alertDebounce.upsert({
      where: { entityType_entityId_kind: key },
      update: { lastSentAt: new Date(), payload: { title: alert.title, severity: alert.severity } },
      create: { ...key, lastSentAt: new Date(), payload: { title: alert.title, severity: alert.severity } },
    });

    const { notify } = await import('../notifications');
    const admins = await prisma.user.findMany({
      where: { role: 'SUPER_ADMIN', suspendedAt: null, deletedAt: null },
      select: { email: true, phone: true },
    });
    const base = process.env.NEXTAUTH_URL ? `${process.env.NEXTAUTH_URL.replace(/\/$/, '')}/platform/observability?tab=alerts` : '/platform/observability?tab=alerts';
    const subject = `[Flavrly ${alert.severity}]${reminder ? ' (still firing)' : ''} ${alert.title}`;
    const text = `${alert.title}\n\n${alert.detail}\n\nOpen: ${base}`;
    const html = `<p><strong>${escapeHtml(alert.title)}</strong></p><p>${escapeHtml(alert.detail)}</p><p><a href="${base}">Open the Observability Center</a></p>`;
    for (const a of admins) {
      if (a.email) await notify.email({ to: a.email, subject, body: text, html, template: 'alert.obs', meta: { ruleKey: alert.ruleKey } }).catch(() => null);
      if (alert.severity === 'CRITICAL' && a.phone) {
        await notify.sms({ to: a.phone, body: `Flavrly ${alert.severity}: ${alert.title}`.slice(0, 300), template: 'alert.obs' }).catch(() => null);
      }
    }
    return admins.length > 0;
  } catch {
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export async function runAlertEvaluation(opts: { signals?: AlertSignals; notify?: boolean } = {}) {
  const now = new Date();
  const signals = opts.signals ?? (await gatherSignals());
  const candidates = evaluateRules(signals);
  const [firing, mutes] = await Promise.all([
    prisma.obsAlert.findMany({ where: { state: 'FIRING' } }),
    prisma.obsAlertMute.findMany({ where: { until: { gt: now } } }),
  ]);
  const byKey = new Map(firing.map((a) => [a.ruleKey, a]));
  let fired = 0;
  let notified = 0;

  for (const c of candidates) {
    const existing = byKey.get(c.ruleKey);
    byKey.delete(c.ruleKey);
    const muted = isMuted(c.ruleKey, c.rule, mutes, now);
    if (!existing) {
      const row = await prisma.obsAlert.create({
        data: { rule: c.rule, ruleKey: c.ruleKey, severity: c.severity, title: c.title, detail: c.detail, value: c.value, threshold: c.threshold },
      });
      fired++;
      if (opts.notify !== false && shouldNotify({ severity: c.severity, notifiedAt: null, acknowledgedAt: null, isNew: true }, muted, now)) {
        if (await notifySuperAdmins(c, false)) {
          notified++;
          await prisma.obsAlert.update({ where: { id: row.id }, data: { notifiedAt: now, notifyCount: { increment: 1 } } });
        }
      }
    } else {
      // Escalation (WARNING → CRITICAL) counts as new for notification purposes.
      const escalated = existing.severity === 'WARNING' && c.severity === 'CRITICAL';
      await prisma.obsAlert.update({
        where: { id: existing.id },
        data: { severity: c.severity, title: c.title, detail: c.detail, value: c.value, threshold: c.threshold, lastSeenAt: now },
      });
      if (
        opts.notify !== false &&
        shouldNotify({ severity: c.severity, notifiedAt: existing.notifiedAt, acknowledgedAt: existing.acknowledgedAt, isNew: escalated }, muted, now)
      ) {
        if (await notifySuperAdmins(c, !escalated)) {
          notified++;
          await prisma.obsAlert.update({ where: { id: existing.id }, data: { notifiedAt: now, notifyCount: { increment: 1 } } });
        }
      }
    }
  }

  // Anything still in byKey is no longer firing → resolve.
  const resolvedIds = [...byKey.values()].map((a) => a.id);
  if (resolvedIds.length) {
    await prisma.obsAlert.updateMany({ where: { id: { in: resolvedIds } }, data: { state: 'RESOLVED', resolvedAt: now } });
  }
  return { evaluatedAt: now.toISOString(), candidates: candidates.length, fired, resolved: resolvedIds.length, notified };
}

