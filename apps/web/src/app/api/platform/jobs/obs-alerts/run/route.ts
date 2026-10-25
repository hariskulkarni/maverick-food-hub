/**
 * POST /api/platform/jobs/obs-alerts/run — every minute (deploy/flavrly-jobs.cron).
 * Refreshes dependency probes when stale, flushes this process's metric buffer,
 * then evaluates every alert rule and sends debounced notifications.
 *
 * Auth: x-internal-secret (constant-time) OR a super-admin 2FA session.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { cronSecretMatches, jsonError } from '@/server/observability/route-helpers';
import { requireObservabilityApi } from '@/server/observability/access';
import { runAlertEvaluation } from '@/server/observability/alerts';
import { flushAggregates } from '@/server/observability/aggregator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!cronSecretMatches(req.headers.get('x-internal-secret'))) {
    const gate = await requireObservabilityApi();
    if (gate instanceof Response) return jsonError(403, 'Forbidden');
  }
  await flushAggregates();
  const lastProbe = await prisma.obsProbe.findFirst({ where: { target: 'db' }, select: { checkedAt: true } }).catch(() => null);
  if (!lastProbe || Date.now() - lastProbe.checkedAt.getTime() > 50_000) {
    const { runAllProbes } = await import('@/server/observability/probes');
    await runAllProbes();
  }
  const result = await runAlertEvaluation();
  return Response.json({ ok: true, ...result });
}
