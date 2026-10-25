/**
 * /api/platform/observability/alerts — super-admin + 2FA.
 *   GET  ?range=  → firing alerts, alert history in range, active mutes, rule catalogue.
 *   POST { action: 'evaluate' } → run the evaluator now (no notifications are skipped
 *        or forced — the normal debounce applies).
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { requireObservabilityApi, parseRange } from '@/server/observability/access';
import { runAlertEvaluation, THRESHOLDS } from '@/server/observability/alerts';
import { STUCK } from '@/server/observability/q-business';
import { jsonError, NO_STORE } from '@/server/observability/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RULES = [
  { rule: 'api_error_rate', label: 'API 5xx error-rate spike', condition: `5xx ≥ ${THRESHOLDS.errorRateWarn * 100}% (critical ≥ ${THRESHOLDS.errorRateCrit * 100}%) over 5 min, ≥ ${THRESHOLDS.minRequests} requests` },
  { rule: 'api_p95_latency', label: 'API P95 latency', condition: `P95 ≥ ${THRESHOLDS.p95WarnMs} ms (critical ≥ ${THRESHOLDS.p95CritMs} ms) over 5 min` },
  { rule: 'job_overdue', label: 'Scheduled job overdue / never ran', condition: 'No run for period + max(3 min, 25% of period)' },
  { rule: 'job_failing', label: 'Scheduled job failing', condition: 'Last run failed (critical after 3 in a row)' },
  { rule: 'stuck_orders', label: 'Stuck orders', condition: `Payment pending > ${STUCK.PAYMENT_PENDING}m · not accepted > ${STUCK.RECEIVED_NOT_ACCEPTED}m · ready without rider > ${STUCK.READY_NO_RIDER}m · out for delivery > ${STUCK.OUT_FOR_DELIVERY}m` },
  { rule: 'notification_failures', label: 'Notification failure rate', condition: `≥ ${THRESHOLDS.notifyFailWarn * 100}% failed over 30 min (≥ ${THRESHOLDS.notifyFailMin} sends)` },
  { rule: 'db_connections', label: 'DB connections near limit', condition: `≥ ${THRESHOLDS.dbConnWarn * 100}% of max_connections (critical ≥ ${THRESHOLDS.dbConnCrit * 100}%)` },
  { rule: 'disk_low', label: 'Disk space low', condition: `≤ ${THRESHOLDS.diskFreeWarnPct}% free (critical ≤ ${THRESHOLDS.diskFreeCritPct}%)` },
  { rule: 'mock_notifier', label: 'Mock notifier in production', condition: 'A channel delivers via the mock provider on the production instance' },
  { rule: 'probe_down', label: 'Core probe down', condition: 'DB / app / server / TLS / DNS probe DOWN' },
  { rule: 'sos_open', label: 'Rider SOS open', condition: `Active SOS older than ${THRESHOLDS.sosAckMin} min` },
];

export async function GET(req: NextRequest) {
  const gate = await requireObservabilityApi();
  if (gate instanceof Response) return gate;
  const r = parseRange(req.nextUrl.searchParams.get('range'));
  const [firing, history, mutes] = await Promise.all([
    prisma.obsAlert.findMany({ where: { state: 'FIRING' }, orderBy: [{ severity: 'asc' }, { firstFiredAt: 'desc' }] }),
    prisma.obsAlert.findMany({ where: { firstFiredAt: { gte: r.since } }, orderBy: { firstFiredAt: 'desc' }, take: 200 }),
    prisma.obsAlertMute.findMany({ where: { until: { gt: new Date() } }, orderBy: { until: 'asc' } }),
  ]);
  const dto = (a: (typeof firing)[number]) => ({
    id: a.id,
    rule: a.rule,
    ruleKey: a.ruleKey,
    severity: a.severity,
    state: a.state,
    title: a.title,
    detail: a.detail,
    value: a.value,
    threshold: a.threshold,
    firstFiredAt: a.firstFiredAt.toISOString(),
    lastSeenAt: a.lastSeenAt.toISOString(),
    resolvedAt: a.resolvedAt?.toISOString() ?? null,
    acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
    notifiedAt: a.notifiedAt?.toISOString() ?? null,
    notifyCount: a.notifyCount,
  });
  return Response.json(
    {
      range: r.key,
      firing: firing.map(dto),
      history: history.map(dto),
      mutes: mutes.map((m) => ({ key: m.key, until: m.until.toISOString(), reason: m.reason, createdAt: m.createdAt.toISOString() })),
      rules: RULES,
    },
    { headers: NO_STORE },
  );
}

export async function POST(req: NextRequest) {
  const gate = await requireObservabilityApi();
  if (gate instanceof Response) return gate;
  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== 'evaluate') return jsonError(400, 'Unknown action');
  const result = await runAlertEvaluation();
  await audit('observability.alerts.evaluate', { actorId: gate.userId, actorRole: 'SUPER_ADMIN', entityType: 'ObsAlert', after: result });
  return Response.json(result);
}
