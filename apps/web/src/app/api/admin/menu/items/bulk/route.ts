import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { audit } from '@/server/audit';
import { sendMenuToggleAlert } from '@/server/alerts';
import { log } from '@/server/log';

const Body = z.object({
  ids: z.array(z.string().min(1)).min(1),
  patch: z.object({
    isAvailable: z.boolean().optional(),
    isPopular: z.boolean().optional(),
    isRecommended: z.boolean().optional()
  }).strict().refine((p) => Object.keys(p).length > 0, { message: 'patch must have at least one field' }),
  reason: z.string().optional().nullable()
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (session?.user.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const restaurant = await requireRestaurant();
  const { ids, patch, reason } = Body.parse(await req.json());

  // Tenancy: every item must belong to a branch of the requesting admin's restaurant.
  const owned = await prisma.menuItem.count({
    where: { id: { in: ids }, branch: { restaurantId: restaurant.id } }
  });
  if (owned !== ids.length) return new Response('Some items do not belong to this restaurant', { status: 403 });

  // Snapshot the before-state of isAvailable so we can determine how many rows
  // actually flipped. updateMany doesn't tell us this on its own.
  let flipCount = 0;
  let firstBranchId: string | null = null;
  let firstBranchName: string | null = null;
  if (patch.isAvailable !== undefined) {
    const beforeRows = await prisma.menuItem.findMany({
      where: { id: { in: ids }, branch: { restaurantId: restaurant.id } },
      select: { id: true, isAvailable: true, branch: { select: { id: true, name: true } } }
    });
    flipCount = beforeRows.filter((r) => r.isAvailable !== patch.isAvailable).length;
    if (beforeRows[0]?.branch) {
      firstBranchId = beforeRows[0].branch.id;
      firstBranchName = beforeRows[0].branch.name ?? null;
    }
  }

  const result = await prisma.menuItem.updateMany({
    where: { id: { in: ids }, branch: { restaurantId: restaurant.id } },
    data: patch
  });

  await audit('menu.bulk_toggle', {
    actorId: session.user.id,
    restaurantId: restaurant.id,
    after: { count: result.count, patch }
  });

  // Alert hook — only when isAvailable was part of the patch AND at least one
  // row actually flipped. Synthetic entityId keeps each bulk op debounce-distinct.
  if (patch.isAvailable !== undefined && flipCount > 0) {
    const entityId = `bulk:${firstBranchId ?? restaurant.id}:${Date.now()}`;
    sendMenuToggleAlert({
      restaurantId: restaurant.id,
      kind: 'bulk',
      entityType: 'Bulk',
      entityId,
      entityName: 'Bulk update',
      restaurantName: restaurant.name,
      branchName: firstBranchName,
      actorName: session.user.name ?? session.user.email ?? null,
      actorEmail: session.user.email ?? null,
      actorRole: session.user.role,
      oldStatus: `${flipCount} item${flipCount === 1 ? '' : 's'} ${patch.isAvailable ? 'disabled' : 'enabled'}`,
      newStatus: `${flipCount} item${flipCount === 1 ? '' : 's'} ${patch.isAvailable ? 'enabled' : 'disabled'}`,
      reason: reason ?? null,
      timestamp: new Date(),
      detailUrl: `${process.env.NEXTAUTH_URL ?? ''}/admin/menu`
    }).catch((e) => log.error({ err: (e as Error).message }, 'sendMenuToggleAlert(bulk) failed'));
  }

  return Response.json({ count: result.count });
}
