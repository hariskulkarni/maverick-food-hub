import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireRestaurantAdminApi } from '@/server/api-auth';
import { requireRestaurant } from '@/server/tenancy';
import { audit } from '@/server/audit';
import { sendMenuToggleAlert } from '@/server/alerts';
import { log } from '@/server/log';

const Body = z.object({
  isActive: z.boolean(),
  cascadeItems: z.boolean().optional(),
  reason: z.string().optional().nullable()
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const session = gate;
  const restaurant = await requireRestaurant();
  const { isActive, cascadeItems, reason } = Body.parse(await req.json());

  // Tenancy: category's branch must belong to this restaurant.
  const cat = await prisma.category.findFirst({
    where: { id, branch: { restaurantId: restaurant.id } },
    select: {
      id: true, name: true, branchId: true, isActive: true,
      branch: { select: { id: true, name: true } }
    }
  });
  if (!cat) return Response.json({ error: 'Category not found.', reason: 'not_found' }, { status: 404 });

  let itemCount = 0;
  await prisma.$transaction(async (tx) => {
    await tx.category.update({ where: { id }, data: { isActive } });
    if (cascadeItems) {
      const r = await tx.menuItem.updateMany({
        where: { categoryId: id, branch: { restaurantId: restaurant.id } },
        data: { isAvailable: isActive }
      });
      itemCount = r.count;
    }
  });

  await audit('menu.category.toggle', {
    actorId: session.user.id,
    actorRole: session.user.role,
    restaurantId: restaurant.id,
    entityType: 'Category',
    entityId: id,
    before: { isActive: cat.isActive },
    after: { isActive, cascadeItems: !!cascadeItems, itemsAffected: itemCount },
    ipAddress: req.headers.get('x-forwarded-for') ?? null,
    userAgent: req.headers.get('user-agent') ?? null
  });

  // Alert hook — only when isActive actually flipped.
  if (cat.isActive !== isActive) {
    sendMenuToggleAlert({
      restaurantId: restaurant.id,
      kind: 'category',
      entityType: 'Category',
      entityId: id,
      entityName: cat.name,
      restaurantName: restaurant.name,
      branchName: cat.branch?.name ?? null,
      actorName: session.user.name ?? session.user.email ?? null,
      actorEmail: session.user.email ?? null,
      actorRole: session.user.role,
      oldStatus: cat.isActive ? 'Enabled' : 'Disabled',
      newStatus: isActive ? 'Enabled' : 'Disabled',
      reason: reason ?? null,
      timestamp: new Date(),
      detailUrl: `${process.env.NEXTAUTH_URL ?? ''}/admin/menu#category-${id}`
    }).catch((e) => log.error({ err: (e as Error).message, id }, 'sendMenuToggleAlert(category) failed'));
  }

  return Response.json({ ok: true, itemCount });
}
