/**
 * Retention for every observability table (run daily by the obs-retention job).
 *   per-minute aggregates 30d · error groups 14d (by last seen) · job runs 90d ·
 *   resolved alerts 90d · probe history 7d · expired mutes.
 * Also closes job runs stuck in RUNNING (process restarted mid-run) and takes the
 * daily table-size snapshot used for growth tracking.
 */
import { prisma } from '../db';
import { snapshotTableSizes } from './q-infra';

export const RETENTION_DAYS = { requestMinutes: 30, eventMinutes: 30, errors: 14, jobRuns: 90, alerts: 90, probeEvents: 7 } as const;

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

export async function runRetention() {
  const [req, evt, errs, jobs, alerts, probes, mutes, debounce, stale] = await Promise.all([
    prisma.obsRequestMinute.deleteMany({ where: { minute: { lt: daysAgo(RETENTION_DAYS.requestMinutes) } } }),
    prisma.obsEventMinute.deleteMany({ where: { minute: { lt: daysAgo(RETENTION_DAYS.eventMinutes) } } }),
    prisma.obsErrorLog.deleteMany({ where: { lastSeenAt: { lt: daysAgo(RETENTION_DAYS.errors) } } }),
    prisma.obsJobRun.deleteMany({ where: { startedAt: { lt: daysAgo(RETENTION_DAYS.jobRuns) } } }),
    prisma.obsAlert.deleteMany({ where: { state: 'RESOLVED', resolvedAt: { lt: daysAgo(RETENTION_DAYS.alerts) } } }),
    prisma.obsProbeEvent.deleteMany({ where: { at: { lt: daysAgo(RETENTION_DAYS.probeEvents) } } }),
    prisma.obsAlertMute.deleteMany({ where: { until: { lt: new Date() } } }),
    prisma.alertDebounce.deleteMany({ where: { entityType: 'ObsAlert', lastSentAt: { lt: daysAgo(7) } } }),
    prisma.obsJobRun.updateMany({
      where: { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - 2 * 3_600_000) } },
      data: { status: 'FAILED', error: 'No completion recorded (process restart or timeout)', finishedAt: new Date() },
    }),
  ]);
  await snapshotTableSizes();
  return {
    deleted: {
      requestMinutes: req.count,
      eventMinutes: evt.count,
      errors: errs.count,
      jobRuns: jobs.count,
      alerts: alerts.count,
      probeEvents: probes.count,
      mutes: mutes.count,
      debounce: debounce.count,
    },
    staleRunsClosed: stale.count,
  };
}
