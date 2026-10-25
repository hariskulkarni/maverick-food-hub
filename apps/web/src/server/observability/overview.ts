/**
 * Overview: a 0–100 health score, the active alerts, and headline KPIs.
 */
import { prisma } from '../db';
import { windowTotals, series } from './q-api';
import { stuckOrders } from './q-business';

export interface ScoreInputs {
  errorRate: number; // 5xx share, last 15 min
  requests: number;
  p95: number | null;
  criticalAlerts: number;
  warningAlerts: number;
  probesDown: number;
  newErrors1h: number;
}

/**
 * Pure health score. Starts at 100 and deducts, capped per category, so one
 * noisy signal can't zero the score on its own:
 *   5xx rate up to -35 · P95 up to -15 · critical alerts -15 each (max -30) ·
 *   warnings -5 each (max -15) · probes down -10 each (max -20) · new error groups (max -10)
 */
export function healthScore(i: ScoreInputs): { score: number; status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' } {
  let s = 100;
  if (i.requests >= 10) s -= Math.min(35, Math.round(i.errorRate * 700)); // 5% → -35
  if (i.p95 !== null) s -= i.p95 >= 4000 ? 15 : i.p95 >= 1500 ? 8 : i.p95 >= 800 ? 3 : 0;
  s -= Math.min(30, i.criticalAlerts * 15);
  s -= Math.min(15, i.warningAlerts * 5);
  s -= Math.min(20, i.probesDown * 10);
  s -= Math.min(10, i.newErrors1h * 2);
  const score = Math.max(0, Math.min(100, s));
  return { score, status: score >= 85 && i.criticalAlerts === 0 ? 'HEALTHY' : score >= 60 ? 'DEGRADED' : 'CRITICAL' };
}

export async function overviewSnapshot(since: Date, rangeMin: number) {
  const now = Date.now();
  const fifteen = new Date(now - 15 * 60_000);
  const hourAgo = new Date(now - 60 * 60_000);
  const [api15, apiRange, apiSeries, alerts, probesDown, newErrors1h, unresolved, stuck] = await Promise.all([
    windowTotals(fifteen, 'API'),
    windowTotals(since, 'API'),
    series(since, rangeMin, { kind: 'API' }),
    prisma.obsAlert.findMany({ where: { state: 'FIRING' }, orderBy: [{ severity: 'asc' }, { firstFiredAt: 'desc' }] }),
    prisma.obsProbe.count({ where: { status: 'DOWN' } }),
    prisma.obsErrorLog.count({ where: { firstSeenAt: { gte: hourAgo } } }),
    prisma.obsErrorLog.count({ where: { resolvedAt: null, lastSeenAt: { gte: since } } }),
    stuckOrders(),
  ]);
  const critical = alerts.filter((a) => a.severity === 'CRITICAL').length;
  const score = healthScore({
    errorRate: api15.errorRate,
    requests: api15.count,
    p95: api15.p95,
    criticalAlerts: critical,
    warningAlerts: alerts.length - critical,
    probesDown,
    newErrors1h,
  });
  return {
    generatedAt: new Date().toISOString(),
    ...score,
    kpis: {
      requests: apiRange.count,
      rpm: Math.round((apiRange.count / Math.max(1, rangeMin)) * 10) / 10,
      errorRate: apiRange.errorRate,
      p50: apiRange.p50,
      p95: apiRange.p95,
      p99: apiRange.p99,
      unresolvedErrors: unresolved,
      newErrorGroups1h: newErrors1h,
      probesDown,
      stuckOrders: stuck.reduce((a, s) => a + s.count, 0),
    },
    series: apiSeries,
    alerts: alerts.map((a) => ({
      id: a.id,
      rule: a.rule,
      ruleKey: a.ruleKey,
      severity: a.severity,
      title: a.title,
      detail: a.detail,
      firstFiredAt: a.firstFiredAt.toISOString(),
      lastSeenAt: a.lastSeenAt.toISOString(),
      acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
    })),
  };
}
