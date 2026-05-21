/**
 * GET /api/platform/observability/errors — super-admin.
 * Searchable, filterable, paginated error explorer.
 *   ?level=ERROR|WARN|INFO   ?resolved=true|false   ?area=<key>   ?q=text   ?limit=100
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { Prisma } from '@prisma/client';
import { OBS_AREAS, areaForPath } from '@/server/observability/registry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  await requireSuperAdmin();
  const url = new URL(req.url);
  const level = url.searchParams.get('level') || undefined;
  const resolvedParam = url.searchParams.get('resolved');
  const area = url.searchParams.get('area') || undefined;
  const q = url.searchParams.get('q')?.trim() || '';
  const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit')) || 100, 500));

  const where: Prisma.ObsErrorLogWhereInput = {};
  if (level) where.level = level;
  if (resolvedParam === 'true') where.resolvedAt = { not: null };
  else if (resolvedParam === 'false') where.resolvedAt = null;
  if (q) {
    where.OR = [
      { message: { contains: q, mode: 'insensitive' } },
      { source: { contains: q, mode: 'insensitive' } },
      { path: { contains: q, mode: 'insensitive' } },
      { digest: { contains: q } },
    ];
  }

  // Over-fetch a little so area filtering (computed in JS) still returns a full page.
  const rows = await prisma.obsErrorLog.findMany({
    where,
    orderBy: { lastSeenAt: 'desc' },
    take: area ? Math.min(limit * 4, 2000) : limit,
  });

  const withArea = rows.map((r) => ({
    id: r.id,
    level: r.level,
    source: r.source,
    message: r.message,
    digest: r.digest,
    sampleStack: r.sampleStack,
    method: r.method,
    path: r.path,
    statusCode: r.statusCode,
    count: r.count,
    firstSeenAt: r.firstSeenAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    area: areaForPath(r.path ?? r.source),
  }));

  const filtered = area ? withArea.filter((r) => r.area === area).slice(0, limit) : withArea;

  return Response.json({
    rows: filtered,
    total: filtered.length,
    areas: [...OBS_AREAS.map((a) => ({ key: a.key, label: a.label })), { key: 'other', label: 'Other / uncategorised' }],
  });
}
