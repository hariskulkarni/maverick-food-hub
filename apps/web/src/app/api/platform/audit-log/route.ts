/**
 * GET /api/platform/audit-log
 *
 * Super-admin only. Returns paginated AuditLog rows joined with the actor's
 * minimal identity. Supported filters:
 *
 *   ?actorId=…        single actor
 *   ?action=…         exact action string (e.g. "restaurant.approve")
 *   ?entityType=…     e.g. "Order", "Coupon", "Restaurant"
 *   ?from=ISO         createdAt >= from
 *   ?to=ISO           createdAt <= to
 *   ?q=…              free-text — matches entityId, ipAddress, action, OR
 *                     actor.email / actor.name / actor.phone (insensitive)
 *   ?limit=200        cap rows (default 200, max 1000)
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  await requireSuperAdmin();
  const url = new URL(req.url);
  const actorId = url.searchParams.get('actorId') || undefined;
  const action = url.searchParams.get('action') || undefined;
  const entityType = url.searchParams.get('entityType') || undefined;
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const q = url.searchParams.get('q')?.trim() || '';
  const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit')) || 200, 1000));

  const where: Prisma.AuditLogWhereInput = {};
  if (actorId) where.actorId = actorId;
  if (action) where.action = action;
  if (entityType) where.entityType = entityType;
  if (from || to) {
    where.createdAt = {};
    if (from) (where.createdAt as any).gte = new Date(from);
    if (to)   (where.createdAt as any).lte = new Date(to);
  }
  if (q) {
    where.OR = [
      { entityId: { contains: q, mode: 'insensitive' } },
      { action: { contains: q, mode: 'insensitive' } },
      { ipAddress: { contains: q } },
      { actorId: q }
    ];
  }

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit
  });

  // Look up actor identities in one round-trip
  const actorIds = Array.from(new Set(rows.map((r) => r.actorId).filter(Boolean) as string[]));
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true, email: true, phone: true, role: true }
      })
    : [];
  const actorMap = new Map(actors.map((a) => [a.id, a]));

  // Aggregate distinct actions + entityTypes for filter chips on the client
  const [actions, entityTypes] = await Promise.all([
    prisma.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
      take: 200
    }),
    prisma.auditLog.findMany({
      distinct: ['entityType'],
      select: { entityType: true },
      orderBy: { entityType: 'asc' },
      take: 200
    })
  ]);

  return Response.json({
    rows: rows.map((r) => ({
      ...r,
      actor: r.actorId ? actorMap.get(r.actorId) ?? null : null
    })),
    facets: {
      actions: actions.map((a) => a.action),
      entityTypes: entityTypes.map((e) => e.entityType)
    },
    total: rows.length
  });
}
