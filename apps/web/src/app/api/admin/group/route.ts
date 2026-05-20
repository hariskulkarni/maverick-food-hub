/**
 * GET   /api/admin/group  → the active restaurant as a group root: its children,
 *                           members, and sharing toggles (+ linkable candidates).
 * PATCH /api/admin/group  → update the group sharing toggles (parent only).
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { requireActiveRestaurant, serializeGroup } from './_helpers';

export async function GET() {
  const guard = await requireActiveRestaurant();
  if ('error' in guard) return guard.error;
  const group = await serializeGroup(guard.restaurant.id);
  if (!group) return new Response('Not found', { status: 404 });

  // Candidates the caller could link as children: restaurants they're a member
  // of, that aren't the root itself, aren't already a child of someone, and
  // aren't a parent of others (single-level hierarchy).
  const memberships = await prisma.restaurantUser.findMany({
    where: { userId: guard.userId },
    select: { restaurant: { select: { id: true, name: true, slug: true, parentId: true, _count: { select: { children: true } } } } },
  });
  const candidates = memberships
    .map((m) => m.restaurant)
    .filter((r) => r.id !== group.id && r.parentId === null && r._count.children === 0)
    .map((r) => ({ id: r.id, name: r.name, slug: r.slug }));

  return Response.json({ group, candidates });
}

const Patch = z.object({
  groupShareMenu: z.boolean().optional(),
  groupShareRiders: z.boolean().optional(),
  groupShareReports: z.boolean().optional(),
}).strict();

export async function PATCH(req: NextRequest) {
  const guard = await requireActiveRestaurant();
  if ('error' in guard) return guard.error;
  // Toggles live on the group root. A child can't own group policy.
  if (guard.restaurant.parentId) {
    return Response.json({ error: 'Sharing toggles are managed on the parent restaurant' }, { status: 400 });
  }
  let data: z.infer<typeof Patch>;
  try {
    data = Patch.parse(await req.json());
  } catch {
    return Response.json({ error: 'Invalid toggle payload' }, { status: 400 });
  }
  const before = await prisma.restaurant.findUnique({
    where: { id: guard.restaurant.id },
    select: { groupShareMenu: true, groupShareRiders: true, groupShareReports: true },
  });
  const updated = await prisma.restaurant.update({
    where: { id: guard.restaurant.id },
    data,
    select: { groupShareMenu: true, groupShareRiders: true, groupShareReports: true },
  });
  await audit('restaurant.group_sharing_updated', {
    actorId: guard.userId,
    restaurantId: guard.restaurant.id,
    entityType: 'Restaurant',
    entityId: guard.restaurant.id,
    before,
    after: updated,
  });
  return Response.json({ sharing: updated });
}
