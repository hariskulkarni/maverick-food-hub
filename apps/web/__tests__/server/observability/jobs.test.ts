import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { cronPeriodMinutes, parseCronFile, DEFAULT_CRON_TEXT, computeJobHealth, overdueAfterMin, summarizeJobBody } from '@/server/observability/jobs';

describe('cron schedules', () => {
  it('derives the expected period from cron expressions', () => {
    expect(cronPeriodMinutes('*/5 * * * *')).toBe(5);
    expect(cronPeriodMinutes('* * * * *')).toBe(1);
    expect(cronPeriodMinutes('15 * * * *')).toBe(60);
    expect(cronPeriodMinutes('0 */6 * * *')).toBe(360);
    expect(cronPeriodMinutes('0 2 * * *')).toBe(1440);
    expect(cronPeriodMinutes('0 9 * * 1')).toBe(10080);
    expect(cronPeriodMinutes('0 3 1 * *')).toBe(43200);
  });

  it('the compiled-in schedule matches deploy/flavrly-jobs.cron (drift guard)', () => {
    const file = fs.readFileSync(path.resolve(__dirname, '../../../../../deploy/flavrly-jobs.cron'), 'utf8');
    const fromFile = parseCronFile(file).map((j) => `${j.job} ${j.cron}`).sort();
    const compiled = parseCronFile(DEFAULT_CRON_TEXT).map((j) => `${j.job} ${j.cron}`).sort();
    expect(compiled).toEqual(fromFile);
    expect(fromFile).toContain('obs-alerts * * * * *');
  });
});

const sched = { job: 'x', cron: '*/5 * * * *', periodMin: 5, description: '' };
const run = (minAgo: number, status: string, durationMs = 100, error: string | null = null) => ({
  status,
  startedAt: new Date(Date.UTC(2026, 0, 1, 12, 0) - minAgo * 60_000),
  finishedAt: null,
  durationMs,
  error,
});
const NOW = new Date(Date.UTC(2026, 0, 1, 12, 0));

describe('job health', () => {
  it('OK, FAILING, OVERDUE, NEVER, UNSCHEDULED', () => {
    expect(computeJobHealth(sched, [run(2, 'SUCCESS')], NOW).health).toBe('OK');
    const failing = computeJobHealth(sched, [run(2, 'FAILED'), run(7, 'FAILED'), run(12, 'SUCCESS')], NOW);
    expect(failing.health).toBe('FAILING');
    expect(failing.consecutiveFailures).toBe(2);
    expect(failing.successRate).toBeCloseTo(1 / 3);
    expect(computeJobHealth(sched, [run(overdueAfterMin(5) + 1, 'SUCCESS')], NOW).health).toBe('OVERDUE');
    expect(computeJobHealth(sched, [], NOW).health).toBe('NEVER');
    expect(computeJobHealth(null, [run(1, 'SUCCESS')], NOW).health).toBe('UNSCHEDULED');
    expect(computeJobHealth(sched, [run(1, 'RUNNING')], NOW).health).toBe('RUNNING');
  });
  it('grace is period + max(3m, 25%)', () => {
    expect(overdueAfterMin(1)).toBe(4);
    expect(overdueAfterMin(1440)).toBe(1800);
  });
  it('summarises job responses and redacts errors', () => {
    expect(summarizeJobBody('{"ok":true,"expired":3,"at":"2026"}', true)).toEqual({ summary: '{"expired":3}', error: null });
    const bad = summarizeJobBody('{"error":"SMTP auth failed for ops@flavrly.in"}', false);
    expect(bad.error).toContain('[EMAIL]');
    expect(summarizeJobBody('Forbidden', false).error).toBe('Forbidden');
  });
});
