/**
 * Admin activity feed. Read-only view of the 50 most recent `AuditLog` rows
 * for this restaurant, filtered to `menu.*` and `integration.*` actions and
 * joined to the actor user for name/email.
 *
 * The page is a server component (auth gate + DB read); the rendered list +
 * filter chips live in the sibling client component.
 */
import { auth } from '@/server/auth';
import { redirect } from 'next/navigation';
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import ActivityClient from './activity-client';

export const metadata = { title: 'Admin · Activity' };
export const dynamic = 'force-dynamic';

export interface ActivityRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before: any;
  after: any;
  createdAt: string;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: string | null;
}

export default async function ActivityPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    redirect('/login?next=/admin/activity&mode=admin');
  }
  const restaurant = await requireRestaurant();

  // Pull the 50 most recent menu/integration audit rows for this tenant.
  // We project actor name/email here so the client doesn't have to do a
  // second round-trip.
  const rows = await prisma.auditLog.findMany({
    where: {
      restaurantId: restaurant.id,
      OR: [
        { action: { startsWith: 'menu.' } },
        { action: { startsWith: 'integration.' } }
      ]
    },
    orderBy: { createdAt: 'desc' },
    take: 50
  });

  const actorIds = Array.from(new Set(rows.map((r) => r.actorId).filter(Boolean) as string[]));
  const users = actorIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true, email: true }
      })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));

  const data: ActivityRow[] = rows.map((r) => {
    const u = r.actorId ? byId.get(r.actorId) : null;
    return {
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      before: r.before,
      after: r.after,
      createdAt: r.createdAt.toISOString(),
      actorName: u?.name ?? null,
      actorEmail: u?.email ?? null,
      actorRole: r.actorRole ?? null
    };
  });

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="display text-2xl font-semibold">Activity</h1>
        <p className="text-sm text-muted-foreground">Menu and integration changes across {restaurant.name}.</p>
      </header>
      <ActivityClient rows={data} />
    </div>
  );
}
