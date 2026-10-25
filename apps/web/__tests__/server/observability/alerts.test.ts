import { describe, it, expect, vi } from 'vitest';
vi.mock('@/server/db', () => ({ prisma: {} }));
import { evaluateRules, shouldNotify, isMuted, THRESHOLDS, type AlertSignals } from '@/server/observability/alerts';
import { healthScore } from '@/server/observability/overview';
import { paymentProviderStatus } from '@/server/observability/providers';

const quiet: AlertSignals = {
  api5m: { count: 100, errorRate: 0, p95: 120 },
  jobs: [{ job: 'kyc-expiry', health: 'OK', minutesSinceLastRun: 10, periodMin: 1440, consecutiveFailures: 0, lastError: null }],
  stuck: [{ key: 'RECEIVED_NOT_ACCEPTED', label: 'Received', count: 0, oldestMin: null, thresholdMin: 10 }],
  notify30m: [{ channel: 'SMS', sent: 50, failed: 0 }],
  db: { total: 10, max: 100 },
  disk: { freePct: 60, freeGB: 50, path: '.' },
  mockInProduction: [],
  probesDown: [],
  sos: { open: 0, oldestMin: null },
  collectingForMin: 60,
};
const keys = (s: AlertSignals) => evaluateRules(s).map((a) => `${a.ruleKey}:${a.severity}`);

describe('alert rules', () => {
  it('quiet system → no alerts', () => {
    expect(evaluateRules(quiet)).toEqual([]);
  });
  it('error-rate spike: warning then critical, ignored below the request floor', () => {
    expect(keys({ ...quiet, api5m: { count: 100, errorRate: 0.03, p95: 100 } })).toEqual(['api_error_rate:WARNING']);
    expect(keys({ ...quiet, api5m: { count: 100, errorRate: 0.2, p95: 100 } })).toEqual(['api_error_rate:CRITICAL']);
    expect(keys({ ...quiet, api5m: { count: THRESHOLDS.minRequests - 1, errorRate: 1, p95: 9000 } })).toEqual([]);
  });
  it('P95 latency', () => {
    expect(keys({ ...quiet, api5m: { count: 100, errorRate: 0, p95: THRESHOLDS.p95WarnMs } })).toEqual(['api_p95_latency:WARNING']);
    expect(keys({ ...quiet, api5m: { count: 100, errorRate: 0, p95: THRESHOLDS.p95CritMs + 1 } })).toEqual(['api_p95_latency:CRITICAL']);
  });
  it('job overdue / failing / never ran', () => {
    const j = quiet.jobs[0];
    expect(keys({ ...quiet, jobs: [{ ...j, health: 'OVERDUE' }] })).toEqual(['job_overdue:kyc-expiry:WARNING']);
    expect(keys({ ...quiet, jobs: [{ ...j, job: 'phonepe-reconcile', health: 'OVERDUE' }] })).toEqual(['job_overdue:phonepe-reconcile:CRITICAL']);
    expect(keys({ ...quiet, jobs: [{ ...j, health: 'FAILING', consecutiveFailures: 3, lastError: 'boom' }] })).toEqual(['job_failing:kyc-expiry:CRITICAL']);
    expect(keys({ ...quiet, jobs: [{ ...j, health: 'NEVER', periodMin: 5 }], collectingForMin: 30 })).toEqual(['job_overdue:kyc-expiry:WARNING']);
    expect(keys({ ...quiet, jobs: [{ ...j, health: 'NEVER', periodMin: 5 }], collectingForMin: 3 })).toEqual([]);
  });
  it('stuck orders, notification failures, db connections, disk, mock notifier, probes, SOS', () => {
    expect(keys({ ...quiet, stuck: [{ ...quiet.stuck[0], count: 4, oldestMin: 30 }] })).toEqual(['stuck_orders:RECEIVED_NOT_ACCEPTED:CRITICAL']);
    expect(keys({ ...quiet, notify30m: [{ channel: 'SMS', sent: 5, failed: 5 }] })).toEqual(['notification_failures:SMS:CRITICAL']);
    expect(keys({ ...quiet, notify30m: [{ channel: 'SMS', sent: 1, failed: 2 }] })).toEqual([]); // below the floor
    expect(keys({ ...quiet, db: { total: 85, max: 100 } })).toEqual(['db_connections:WARNING']);
    expect(keys({ ...quiet, db: { total: 95, max: 100 } })).toEqual(['db_connections:CRITICAL']);
    expect(keys({ ...quiet, disk: { freePct: 5, freeGB: 2, path: '.' } })).toEqual(['disk_low:CRITICAL']);
    expect(keys({ ...quiet, mockInProduction: ['SMS'] })).toEqual(['mock_notifier:CRITICAL']);
    expect(keys({ ...quiet, probesDown: [{ target: 'db', label: 'PostgreSQL', detail: 'x' }] })).toEqual(['probe_down:db:CRITICAL']);
    expect(keys({ ...quiet, sos: { open: 1, oldestMin: 5 } })).toEqual(['sos_open:CRITICAL']);
    expect(keys({ ...quiet, sos: { open: 1, oldestMin: 0 } })).toEqual([]);
  });
});

describe('notification debounce + mutes', () => {
  const now = new Date('2026-10-25T10:00:00Z');
  it('notifies new alerts, reminds hourly, never when acked or muted', () => {
    expect(shouldNotify({ severity: 'WARNING', notifiedAt: null, acknowledgedAt: null, isNew: true }, false, now)).toBe(true);
    expect(shouldNotify({ severity: 'WARNING', notifiedAt: new Date(now.getTime() - 10 * 60_000), acknowledgedAt: null, isNew: false }, false, now)).toBe(false);
    expect(shouldNotify({ severity: 'WARNING', notifiedAt: new Date(now.getTime() - 61 * 60_000), acknowledgedAt: null, isNew: false }, false, now)).toBe(true);
    expect(shouldNotify({ severity: 'CRITICAL', notifiedAt: null, acknowledgedAt: now, isNew: true }, false, now)).toBe(false);
    expect(shouldNotify({ severity: 'CRITICAL', notifiedAt: null, acknowledgedAt: null, isNew: true }, true, now)).toBe(false);
  });
  it('mutes match a whole rule or one key, and expire', () => {
    const mutes = [{ key: 'stuck_orders', until: new Date(now.getTime() + 60_000) }, { key: 'job_overdue:kyc-expiry', until: new Date(now.getTime() - 1) }];
    expect(isMuted('stuck_orders:READY_NO_RIDER', 'stuck_orders', mutes, now)).toBe(true);
    expect(isMuted('job_overdue:kyc-expiry', 'job_overdue', mutes, now)).toBe(false);
  });
});

describe('health score + provider status', () => {
  it('100 when quiet, drops with errors/alerts, never below 0', () => {
    const base = { errorRate: 0, requests: 100, p95: 100, criticalAlerts: 0, warningAlerts: 0, probesDown: 0, newErrors1h: 0 };
    expect(healthScore(base)).toEqual({ score: 100, status: 'HEALTHY' });
    expect(healthScore({ ...base, criticalAlerts: 1 }).status).toBe('DEGRADED');
    expect(healthScore({ ...base, errorRate: 0.5, criticalAlerts: 5, warningAlerts: 5, probesDown: 5, newErrors1h: 50, p95: 9000 }).score).toBe(0);
    expect(healthScore({ ...base, errorRate: 0.5, criticalAlerts: 5, probesDown: 5 }).status).toBe('CRITICAL');
  });
  it('payment provider status from 1h success/failure', () => {
    expect(paymentProviderStatus(0, 0)).toBe('UNKNOWN');
    expect(paymentProviderStatus(9, 1)).toBe('UP');
    expect(paymentProviderStatus(7, 3)).toBe('DEGRADED');
    expect(paymentProviderStatus(1, 9)).toBe('DOWN');
    expect(paymentProviderStatus(0, 2)).toBe('DEGRADED'); // too few samples for DOWN
    expect(paymentProviderStatus(2, 0)).toBe('UP');
  });
});
