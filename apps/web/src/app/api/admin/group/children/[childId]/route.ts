/**
 * DELETE /api/admin/group/children/:childId  → unlink a child from the caller's
 * active (parent) restaurant. The child reverts to an independent top-level
 * restaurant; no data is deleted. Caller must be a member of the parent and the
 * child must actually be a child of that parent.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { requireActiveRestaurant, serializeGroup } from '../../_helpers';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ childId: string }> }) {
  const guard = await requireActiveRestaurant();
  if ('error' in guard) return guard.error;
  const { childId } = await params;

  const child = await prisma.restaurant.findUnique({
    where: { id: childId },
    select: { id: true, parentId: true },
  });
  if (!child || child.parentId !== guard.restaurant.id) {
    return Response.json({ error: 'That restaurant is not a child of your restaurant' }, { status: 404 });
  }

  await prisma.restaurant.update({ where: { id: childId }, data: { parentId: null } });
  await audit('restaurant.child_unlinked', {
    actorId: guard.userId,
    restaurantId: guard.restaurant.id,
    entityType: 'Restaurant',
    entityId: childId,
    before: { parentId: guard.restaurant.id },
    after: { parentId: null },
  });
  const group = await serializeGroup(guard.restaurant.id);
  return Response.json({ group });
}
