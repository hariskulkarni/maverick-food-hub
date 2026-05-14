import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { AuditClient } from './audit-client';

export const metadata = { title: 'Platform · Audit log' };
export const dynamic = 'force-dynamic';

export default async function AuditLogPage({
  searchParams
}: {
  searchParams: Promise<{ actorId?: string; action?: string; entityType?: string; from?: string; to?: string; q?: string }>;
}) {
  await requireSuperAdmin();
  const sp = await searchParams;

  const where: any = {};
  if (sp.actorId) where.actorId = sp.actorId;
  if (sp.action) where.action = sp.action;
  if (sp.entityType) where.entityType = sp.entityType;
  if (sp.from || sp.to) {
    where.createdAt = {};
    if (sp.from) where.createdAt.gte = new Date(sp.from);
    if (sp.to)   where.createdAt.lte = new Date(sp.to);
  }
  if (sp.q?.trim()) {
    const q = sp.q.trim();
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
    take: 200
  });

  const actorIds = Array.from(new Set(rows.map((r) => r.actorId).filter(Boolean) as string[]));
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true, email: true, phone: true, role: true }
      })
    : [];
  const actorMap = Object.fromEntries(actors.map((a) => [a.id, a]));

  const [actions, entityTypes] = await Promise.all([
    prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' }, take: 200 }),
    prisma.auditLog.findMany({ distinct: ['entityType'], select: { entityType: true }, orderBy: { entityType: 'asc' }, take: 200 })
  ]);

  const enriched = rows.map((r) => ({
    ...r,
    actor: r.actorId ? actorMap[r.actorId] ?? null : null
  }));

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      <header>
        <h1 className="display text-3xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground mt-1">Every admin action, append-only. Investigate disputes by filtering on actor, entity, or time.</p>
      </header>
      <AuditClient
        initial={JSON.parse(JSON.stringify(enriched))}
        filters={{
          actorId: sp.actorId ?? '',
          action: sp.action ?? '',
          entityType: sp.entityType ?? '',
          from: sp.from ?? '',
          to: sp.to ?? '',
          q: sp.q ?? ''
        }}
        facets={{
          actions: actions.map((a) => a.action),
          entityTypes: entityTypes.map((e) => e.entityType)
        }}
      />
    </div>
  );
}
