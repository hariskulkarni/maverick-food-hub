/**
 * POST /api/admin/group/children  → link an existing restaurant as a child of
 * the caller's active (parent) restaurant. The caller must be a member of both,
 * the target must currently be top-level (no parent) and have no children of its
 * own (single-level hierarchy), and the parent must not itself be a child.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { requireActiveRestaurant, isMemberOf, serializeGroup } from '../_helpers';

const Body = z.object({ restaurantId: z.string().min(1) }).strict();

export async function POST(req: NextRequest) {
  const guard = await requireActiveRestaurant();
  if ('error' in guard) return guard.error;
  const parent = guard.restaurant;
  if (parent.parentId) {
    return Response.json({ error: 'This restaurant is already a child; nest under its parent instead' }, { status: 400 });
  }

  let restaurantId: string;
  try {
    ({ restaurantId } = Body.parse(await req.json()));
  } catch {
    return Response.json({ error: 'restaurantId is required' }, { status: 400 });
  }
  if (restaurantId === parent.id) {
    return Response.json({ error: 'A restaurant cannot be its own parent' }, { status: 400 });
  }
  if (!(await isMemberOf(guard.userId, restaurantId))) {
    return Response.json({ error: 'You do not have access to that restaurant' }, { status: 404 });
  }

  const target = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true, name: true, parentId: true, _count: { select: { children: true } } },
  });
  if (!target) return Response.json({ error: 'Restaurant not found' }, { status: 404 });
  if (target.parentId) {
    return Response.json({ error: 'That restaurant already belongs to a group' }, { status: 409 });
  }
  if (target._count.children > 0) {
    return Response.json({ error: 'That restaurant is itself a parent and cannot be nested' }, { status: 409 });
  }

  await prisma.restaurant.update({ where: { id: target.id }, data: { parentId: parent.id } });
  await audit('restaurant.child_linked', {
    actorId: guard.userId,
    restaurantId: parent.id,
    entityType: 'Restaurant',
    entityId: target.id,
    before: { parentId: null },
    after: { parentId: parent.id },
  });
  const group = await serializeGroup(parent.id);
  return Response.json({ group });
}
