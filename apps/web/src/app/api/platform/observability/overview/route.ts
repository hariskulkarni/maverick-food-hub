/**
 * GET /api/platform/observability/overview — super-admin.
 * The single aggregate the dashboard polls: live probe states, error summary,
 * per-area error attribution, system snapshot, and a computed overall status.
 */
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { OBS_AREAS, areaForPath } from '@/server/observability/registry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Status = 'UP' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';
const CRITICAL = new Set(['db', 'app', 'system']);

export async function GET() {
  await requireSuperAdmin();
  const now = Date.now();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const hourAgo = new Date(now - 60 * 60 * 1000);

  const [probes, unresolvedByLevel, totalUnresolved, errors24h, recentUnresolved] = await Promise.all([
    prisma.obsProbe.findMany({ orderBy: [{ category: 'asc' }, { label: 'asc' }] }),
    prisma.obsErrorLog.groupBy({ by: ['level'], where: { resolvedAt: null }, _count: { _all: true } }),
    prisma.obsErrorLog.count({ where: { resolvedAt: null } }),
    prisma.obsErrorLog.count({ where: { lastSeenAt: { gte: dayAgo } } }),
    prisma.obsErrorLog.findMany({
      where: { resolvedAt: null },
      orderBy: { lastSeenAt: 'desc' },
      take: 500,
      select: { id: true, level: true, source: true, message: true, path: true, count: true, lastSeenAt: true, statusCode: true },
    }),
  ]);

  // Per-area error attribution from the recent unresolved set.
  const areaAgg: Record<string, { count: number; lastSeenAt: Date | null }> = {};
  for (const a of OBS_AREAS) areaAgg[a.key] = { count: 0, lastSeenAt: null };
  areaAgg['other'] = { count: 0, lastSeenAt: null };
  for (const e of recentUnresolved) {
    const key = areaForPath(e.path ?? e.source);
    const bucket = areaAgg[key] ?? (areaAgg[key] = { count: 0, lastSeenAt: null });
    bucket.count += e.count;
    if (!bucket.lastSeenAt || e.lastSeenAt > bucket.lastSeenAt) bucket.lastSeenAt = e.lastSeenAt;
  }
  const areas = [...OBS_AREAS.map((a) => ({ key: a.key, label: a.label })), { key: 'other', label: 'Other / uncategorised' }]
    .map((a) => {
      const agg = areaAgg[a.key] ?? { count: 0, lastSeenAt: null };
      const recent = agg.lastSeenAt ? agg.lastSeenAt >= hourAgo : false;
      const status: Status = agg.count === 0 ? 'UP' : recent ? 'DEGRADED' : 'UP';
      return { ...a, errorCount: agg.count, lastErrorAt: agg.lastSeenAt?.toISOString() ?? null, status };
    });

  // Overall status: any critical probe DOWN → DOWN; any DOWN/DEGRADED or recent
  // errors → DEGRADED; else UP.
  let overall: Status = 'UP';
  for (const p of probes) {
    if (CRITICAL.has(p.target) && p.status === 'DOWN') { overall = 'DOWN'; break; }
    // Any non-critical DOWN or any DEGRADED demotes UP → DEGRADED (we'd have
    // broken above for a critical DOWN, so overall is 'UP' here).
    if (p.status === 'DOWN' || p.status === 'DEGRADED') overall = 'DEGRADED';
  }
  const recentErrorBurst = await prisma.obsErrorLog.count({ where: { lastSeenAt: { gte: hourAgo }, resolvedAt: null, level: 'ERROR' } });
  if (overall === 'UP' && recentErrorBurst > 0) overall = 'DEGRADED';

  const system = probes.find((p) => p.target === 'system');
  const levelCounts = { ERROR: 0, WARN: 0, INFO: 0 } as Record<string, number>;
  for (const r of unresolvedByLevel) levelCounts[r.level] = r._count._all;

  return Response.json({
    generatedAt: new Date().toISOString(),
    overall,
    probes: probes.map((p) => ({
      target: p.target,
      category: p.category,
      label: p.label,
      status: p.status,
      latencyMs: p.latencyMs,
      detail: p.detail,
      meta: p.meta,
      consecutiveFailures: p.consecutiveFailures,
      checkedAt: p.checkedAt.toISOString(),
    })),
    errors: {
      totalUnresolved,
      last24h: errors24h,
      byLevel: levelCounts,
      recent: recentUnresolved.slice(0, 25).map((e) => ({
        id: e.id, level: e.level, source: e.source, message: e.message,
        path: e.path, count: e.count, statusCode: e.statusCode, lastSeenAt: e.lastSeenAt.toISOString(),
      })),
    },
    areas,
    system: (system?.meta as Record<string, unknown> | null) ?? null,
  });
}
