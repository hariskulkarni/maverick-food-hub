/**
 * Scheduled-job observability: the expected schedule of every job (parsed from
 * deploy/flavrly-jobs.cron), run recording, and health (last run, success
 * rate, overdue).
 *
 * Every job in this app is an HTTP route (`POST /api/platform/jobs/<name>/run`)
 * triggered by cron. The HTTP recorder captures each call generically (start,
 * finish, duration, status, error/summary) — so new jobs added by any team are
 * observed with zero code changes. `withJobRun()` is available for jobs that
 * run outside HTTP.
 */
import fs from 'node:fs';
import path from 'node:path';
import { redactText } from './redact';

export interface JobSchedule {
  job: string;
  cron: string;
  /** Expected period between runs, minutes. */
  periodMin: number;
  description: string;
}

/**
 * Compiled-in copy of deploy/flavrly-jobs.cron. A unit test asserts this stays
 * in sync with the file; at runtime the file (if readable) wins, so a cron line
 * added on the VPS is picked up without a deploy.
 */
export const DEFAULT_CRON_TEXT = `
*/5 * * * * curl https://x/api/platform/jobs/phonepe-reconcile/run
*/20 * * * * curl https://x/api/platform/jobs/rider-shift-missed/run
0 2 * * * curl https://x/api/platform/jobs/kyc-expiry/run
0 6 * * * curl https://x/api/platform/jobs/food-license-expiry/run
*/15 * * * * curl https://x/api/platform/jobs/google-reviews/run
*/3 * * * * curl https://x/api/platform/jobs/youpi-reconcile/run
* * * * * curl https://x/api/platform/jobs/pg-worker/run
*/5 * * * * curl https://x/api/platform/jobs/review-requests/run
0 9 * * 1 curl https://x/api/platform/jobs/review-digest/run
* * * * * curl https://x/api/platform/jobs/obs-alerts/run
30 3 * * * curl https://x/api/platform/jobs/obs-retention/run
* * * * * curl https://x/api/platform/jobs/dispatch-jit/run
*/2 * * * * curl https://x/api/platform/jobs/rider-stationary/run
*/2 * * * * curl https://x/api/platform/jobs/safety-alerts/run
*/10 * * * * curl https://x/api/platform/jobs/rider-trip-summaries/run
*/5 * * * * curl https://x/api/platform/jobs/zone-snapshot/run
10 3 * * * curl https://x/api/platform/jobs/prep-stats/run
* * * * * curl https://x/api/platform/jobs/novaryq-worker/run
*/15 * * * * curl https://x/api/platform/jobs/novaryq-reconcile/run
`;

/**
 * Expected period of a 5-field cron expression, in minutes. Handles the forms
 * this project uses: "* /N" (every N), "*" (every 1), fixed minute + every-hour
 * / "* /N" hours, daily, weekly (fixed day-of-week), monthly (fixed dom).
 */
export function cronPeriodMinutes(expr: string): number {
  const [min = '*', hour = '*', dom = '*', , dow = '*'] = expr.trim().split(/\s+/);
  const step = (f: string): number | null => {
    if (f === '*') return 1;
    const m = /^\*\/(\d+)$/.exec(f);
    if (m) return Number(m[1]);
    return null; // fixed value or list
  };
  if (dom !== '*' && !dom.startsWith('*/')) return 30 * 1440;
  if (dow !== '*' && !dow.startsWith('*/')) {
    const days = dow.split(',').length;
    return Math.round((7 * 1440) / Math.max(1, days));
  }
  const hs = step(hour);
  const ms = step(min);
  if (hs === 1 && ms !== null) return ms; // every N minutes
  if (hs === 1 && ms === null) return 60 / Math.max(1, min.split(',').length); // fixed minute(s) every hour
  if (hs !== null) return hs * 60; // every N hours
  return Math.round(1440 / Math.max(1, hour.split(',').length)); // fixed hour(s) daily
}

export function parseCronFile(text: string): JobSchedule[] {
  const out: JobSchedule[] = [];
  let lastComment = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      lastComment = line.replace(/^#\s*/, '');
      continue;
    }
    const m = /\/api\/platform\/jobs\/([a-z0-9-]+)\/run/.exec(line);
    if (!m) continue;
    const cron = line.split(/\s+/).slice(0, 5).join(' ');
    out.push({ job: m[1], cron, periodMin: cronPeriodMinutes(cron), description: lastComment.slice(0, 160) });
    lastComment = '';
  }
  return out;
}

let cached: { at: number; list: JobSchedule[] } | null = null;

/** The job schedule list (runtime cron file if readable, else compiled-in). */
export function jobSchedules(): JobSchedule[] {
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.list;
  let list = parseCronFile(DEFAULT_CRON_TEXT);
  for (const p of [path.join(process.cwd(), '../../deploy/flavrly-jobs.cron'), path.join(process.cwd(), 'deploy/flavrly-jobs.cron')]) {
    try {
      const parsed = parseCronFile(fs.readFileSync(p, 'utf8'));
      if (parsed.length) {
        // File wins, but keep compiled-in obs jobs if the file predates them.
        const names = new Set(parsed.map((j) => j.job));
        list = [...parsed, ...list.filter((j) => !names.has(j.job) && j.job.startsWith('obs-'))];
        break;
      }
    } catch {
      /* not readable here */
    }
  }
  cached = { at: Date.now(), list };
  return list;
}

/** Grace before a job counts as overdue: a quarter period, at least 3 minutes. */
export function overdueAfterMin(periodMin: number): number {
  return periodMin + Math.max(3, Math.round(periodMin * 0.25));
}

export type JobHealth = 'OK' | 'OVERDUE' | 'FAILING' | 'RUNNING' | 'NEVER' | 'UNSCHEDULED';

export interface JobRunLite {
  status: string; // RUNNING | SUCCESS | FAILED
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  error: string | null;
}

/** Pure health computation for one job, given its runs newest-first. */
export function computeJobHealth(
  schedule: JobSchedule | null,
  runsNewestFirst: JobRunLite[],
  now: Date = new Date(),
): {
  health: JobHealth;
  lastRunAt: Date | null;
  lastStatus: string | null;
  minutesSinceLastRun: number | null;
  successRate: number | null;
  consecutiveFailures: number;
  avgDurationMs: number | null;
} {
  const last = runsNewestFirst[0] ?? null;
  const finished = runsNewestFirst.filter((r) => r.status !== 'RUNNING');
  const ok = finished.filter((r) => r.status === 'SUCCESS').length;
  let consecutiveFailures = 0;
  for (const r of finished) {
    if (r.status === 'FAILED') consecutiveFailures++;
    else break;
  }
  const durs = finished.map((r) => r.durationMs).filter((d): d is number => typeof d === 'number');
  const minutesSince = last ? (now.getTime() - last.startedAt.getTime()) / 60_000 : null;
  let health: JobHealth;
  if (!schedule) health = 'UNSCHEDULED';
  else if (!last) health = 'NEVER';
  else if (minutesSince !== null && minutesSince > overdueAfterMin(schedule.periodMin)) health = 'OVERDUE';
  else if (last.status === 'RUNNING') health = 'RUNNING';
  else if (finished[0]?.status === 'FAILED') health = 'FAILING';
  else health = 'OK';
  return {
    health,
    lastRunAt: last?.startedAt ?? null,
    lastStatus: last?.status ?? null,
    minutesSinceLastRun: minutesSince === null ? null : Math.round(minutesSince),
    successRate: finished.length ? ok / finished.length : null,
    consecutiveFailures,
    avgDurationMs: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : null,
  };
}

// ─── recording ───────────────────────────────────────────────────────────────

export async function recordJobStart(job: string, trigger: 'CRON' | 'MANUAL', requestId?: string): Promise<string | null> {
  try {
    const { prisma } = await import('../db');
    const row = await prisma.obsJobRun.create({
      data: { job: job.slice(0, 80), trigger, status: 'RUNNING', requestId: requestId ?? null },
      select: { id: true },
    });
    return row.id;
  } catch {
    return null;
  }
}

/** Extract a short summary / error from a job route's JSON (or text) response body. */
export function summarizeJobBody(body: string, ok: boolean): { summary: string | null; error: string | null } {
  const text = body.trim();
  if (!text) return { summary: null, error: ok ? null : null };
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const err = typeof j.error === 'string' ? j.error : typeof j.message === 'string' && !ok ? j.message : null;
    const rest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(j)) {
      if (k === 'error' || k === 'at' || k === 'ok') continue;
      if (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length < 60)) rest[k] = v;
    }
    const summary = Object.keys(rest).length ? redactText(JSON.stringify(rest), 400) : null;
    return { summary, error: err ? redactText(err, 500) : null };
  } catch {
    return ok ? { summary: redactText(text, 200), error: null } : { summary: null, error: redactText(text, 500) };
  }
}

export async function recordJobFinish(
  id: string | null,
  r: { ok: boolean; startedAt: number; httpStatus?: number; summary?: string | null; error?: string | null },
): Promise<void> {
  if (!id) return;
  try {
    const { prisma } = await import('../db');
    await prisma.obsJobRun.update({
      where: { id },
      data: {
        status: r.ok ? 'SUCCESS' : 'FAILED',
        finishedAt: new Date(),
        durationMs: Math.max(0, Math.round(Date.now() - r.startedAt)),
        httpStatus: r.httpStatus ?? null,
        summary: r.summary ?? null,
        error: r.ok ? null : (r.error ?? (r.httpStatus ? `HTTP ${r.httpStatus}` : 'failed')),
      },
    });
  } catch {
    /* telemetry must never throw */
  }
}

/** Wrap a non-HTTP job so it is recorded like the HTTP ones. Re-throws the job's error. */
export async function withJobRun<T>(job: string, fn: () => Promise<T>, trigger: 'CRON' | 'MANUAL' = 'CRON'): Promise<T> {
  const startedAt = Date.now();
  const id = await recordJobStart(job, trigger);
  try {
    const out = await fn();
    await recordJobFinish(id, { ok: true, startedAt, summary: summarizeJobBody(JSON.stringify(out ?? {}), true).summary });
    return out;
  } catch (e) {
    await recordJobFinish(id, { ok: false, startedAt, error: redactText((e as Error)?.message ?? String(e), 500) });
    throw e;
  }
}
