/**
 * GET /api/platform/observability/errors — super-admin + 2FA.
 * Searchable, filterable, paginated error explorer (server, browser and rider-app errors).
 *   ?level=ERROR|WARN|INFO  ?kind=SERVER|CLIENT|NATIVE  ?resolved=true|false
 *   ?area=<key>  ?q=text  ?range=15m|1h|24h|7d (by last seen)  ?limit=100
 * Messages and stacks were redacted at capture time (observability/redact.ts).
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { Prisma } from '@prisma/client';
import { OBS_AREAS, areaForPath } from '@/server/observability/registry';
import { requireObservabilityApi, RANGES } from '@/server/observability/access';
import { NO_STORE } from '@/server/observability/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const gate = await requireObservabilityApi();
  if (gate instanceof Response) return gate;
  const url = new URL(req.url);
  const level = url.searchParams.get('level') || undefined;
  const kind = url.searchParams.get('kind') || undefined;
  const resolvedParam = url.searchParams.get('resolved');
  const area = url.searchParams.get('area') || undefined;
  const range = url.searchParams.get('range');
  const q = url.searchParams.get('q')?.trim().slice(0, 200) || '';
  const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit')) || 100, 500));

  const where: Prisma.ObsErrorLogWhereInput = {};
  if (level) where.level = level;
  if (kind && ['SERVER', 'CLIENT', 'NATIVE'].includes(kind)) where.kind = kind;
  if (resolvedParam === 'true') where.resolvedAt = { not: null };
  else if (resolvedParam === 'false') where.resolvedAt = null;
  if (range && range in RANGES) where.lastSeenAt = { gte: new Date(Date.now() - RANGES[range as keyof typeof RANGES] * 60_000) };
  if (q) {
    where.OR = [
      { message: { contains: q, mode: 'insensitive' } },
      { source: { contains: q, mode: 'insensitive' } },
      { path: { contains: q, mode: 'insensitive' } },
      { route: { contains: q, mode: 'insensitive' } },
      { requestId: { contains: q } },
      { digest: { contains: q } },
    ];
  }

  // Over-fetch a little so area filtering (computed in JS) still returns a full page.
  const [rows, byKind] = await Promise.all([
    prisma.obsErrorLog.findMany({
      where,
      orderBy: { lastSeenAt: 'desc' },
      take: area ? Math.min(limit * 4, 2000) : limit,
    }),
    prisma.obsErrorLog.groupBy({ by: ['kind'], where: { resolvedAt: null }, _count: { _all: true } }),
  ]);

  const withArea = rows.map((r) => ({
    id: r.id,
    level: r.level,
    kind: r.kind,
    source: r.source,
    message: r.message,
    digest: r.digest,
    sampleStack: r.sampleStack,
    method: r.method,
    path: r.path,
    route: r.route,
    requestId: r.requestId,
    release: r.release,
    statusCode: r.statusCode,
    count: r.count,
    firstSeenAt: r.firstSeenAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    area: areaForPath(r.route ?? r.path ?? r.source),
  }));

  const filtered = area ? withArea.filter((r) => r.area === area).slice(0, limit) : withArea;

  return Response.json(
    {
      rows: filtered,
      total: filtered.length,
      unresolvedByKind: Object.fromEntries(byKind.map((k) => [k.kind, k._count._all])),
      areas: [...OBS_AREAS.map((a) => ({ key: a.key, label: a.label })), { key: 'other', label: 'Other / uncategorised' }],
    },
    { headers: NO_STORE },
  );
}
