/**
 * Per-child access grants (the "explicit grant" model — a parent admin decides
 * who can switch into each child).
 *
 *   POST   { childId, email, role }   → grant an EXISTING user ADMIN/KITCHEN
 *                                       access to a child in the group.
 *   DELETE { childId, userId }         → revoke a user's access to a child.
 *
 * No account creation: if no user has that email, we return 404 and tell the
 * admin the person must sign up first. The child must belong to the caller's
 * active (parent) restaurant, and we never strip the child's owner.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { Role } from '@prisma/client';
import { requireActiveRestaurant } from '../_helpers';

/** Confirm `childId` is a child of the caller's active parent (or the parent itself). */
async function childInGroup(parentId: string, childId: string): Promise<boolean> {
  if (childId === parentId) return true;
  const c = await prisma.restaurant.findUnique({ where: { id: childId }, select: { parentId: true } });
  return c?.parentId === parentId;
}

const Grant = z.object({
  childId: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['ADMIN', 'KITCHEN']),
}).strict();

export async function POST(req: NextRequest) {
  const guard = await requireActiveRestaurant();
  if ('error' in guard) return guard.error;
  if (guard.restaurant.parentId) {
    return Response.json({ error: 'Manage access from the parent restaurant' }, { status: 400 });
  }
  let body: z.infer<typeof Grant>;
  try {
    body = Grant.parse(await req.json());
  } catch {
    return Response.json({ error: 'childId, email and role are required' }, { status: 400 });
  }
  if (!(await childInGroup(guard.restaurant.id, body.childId))) {
    return Response.json({ error: 'That restaurant is not in your group' }, { status: 404 });
  }
  const user = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true, name: true, email: true } });
  if (!user) {
    return Response.json({ error: 'No account with that email. Ask them to sign up first, then grant access.' }, { status: 404 });
  }
  const membership = await prisma.restaurantUser.upsert({
    where: { restaurantId_userId: { restaurantId: body.childId, userId: user.id } },
    update: { role: body.role as Role },
    create: { restaurantId: body.childId, userId: user.id, role: body.role as Role },
    select: { userId: true, role: true },
  });
  await audit('restaurant.access_granted', {
    actorId: guard.userId,
    restaurantId: body.childId,
    entityType: 'RestaurantUser',
    entityId: user.id,
    before: null,
    after: { userId: user.id, role: membership.role },
  });
  return Response.json({ member: { userId: user.id, name: user.name, email: user.email, role: membership.role } });
}

const Revoke = z.object({ childId: z.string().min(1), userId: z.string().min(1) }).strict();

export async function DELETE(req: NextRequest) {
  const guard = await requireActiveRestaurant();
  if ('error' in guard) return guard.error;
  if (guard.restaurant.parentId) {
    return Response.json({ error: 'Manage access from the parent restaurant' }, { status: 400 });
  }
  let body: z.infer<typeof Revoke>;
  try {
    body = Revoke.parse(await req.json());
  } catch {
    return Response.json({ error: 'childId and userId are required' }, { status: 400 });
  }
  if (!(await childInGroup(guard.restaurant.id, body.childId))) {
    return Response.json({ error: 'That restaurant is not in your group' }, { status: 404 });
  }
  // Never strip the child restaurant's owner of access.
  const child = await prisma.restaurant.findUnique({ where: { id: body.childId }, select: { ownerUserId: true } });
  if (child?.ownerUserId === body.userId) {
    return Response.json({ error: "You can't remove the restaurant's owner" }, { status: 400 });
  }
  await prisma.restaurantUser.deleteMany({ where: { restaurantId: body.childId, userId: body.userId } });
  await audit('restaurant.access_revoked', {
    actorId: guard.userId,
    restaurantId: body.childId,
    entityType: 'RestaurantUser',
    entityId: body.userId,
    before: { userId: body.userId },
    after: null,
  });
  return Response.json({ ok: true });
}
