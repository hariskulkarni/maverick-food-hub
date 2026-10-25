/**
 * GET /api/health — uptime-monitor endpoint.
 *
 * Public callers get ONLY `{ ok, status: 'ok' | 'degraded', time }` (no versions,
 * no counts, no alert text). A super-admin with a 2FA session additionally gets
 * the detail block (DB latency, firing alerts, release, uptime).
 * HTTP 503 only when the database is unreachable.
 */
import { prisma } from '@/server/db';
import { requireObservabilityApi } from '@/server/observability/access';
import { memo } from '@/server/observability/route-helpers';
import { appRelease } from '@/server/observability/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function compute() {
  const t0 = Date.now();
  let dbOk = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbOk = false;
  }
  const dbLatencyMs = Date.now() - t0;
  const firing = dbOk
    ? await prisma.obsAlert
        .findMany({ where: { state: 'FIRING' }, select: { severity: true, title: true, ruleKey: true, firstFiredAt: true } })
        .catch(() => [])
    : [];
  const critical = firing.filter((a) => a.severity === 'CRITICAL');
  return {
    dbOk,
    status: dbOk && critical.length === 0 ? ('ok' as const) : ('degraded' as const),
    detail: {
      db: { ok: dbOk, latencyMs: dbLatencyMs },
      alerts: firing.map((a) => ({ severity: a.severity, title: a.title, ruleKey: a.ruleKey, since: a.firstFiredAt.toISOString() })),
      release: appRelease(),
      uptimeSec: Math.round(process.uptime()),
    },
  };
}

export async function GET() {
  const h = await memo('health', 10_000, compute);
  const body: Record<string, unknown> = { ok: h.dbOk, status: h.status, time: new Date().toISOString() };
  // Only reveal detail to an authenticated super-admin with 2FA. Never fail the probe on auth errors.
  const gate = await requireObservabilityApi().catch(() => null);
  if (gate && !(gate instanceof Response)) body.detail = h.detail;
  return Response.json(body, { status: h.dbOk ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
