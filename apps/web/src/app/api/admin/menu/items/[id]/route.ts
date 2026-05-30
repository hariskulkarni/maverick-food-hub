import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireRestaurantAdminApi } from '@/server/api-auth';
import { requireRestaurant } from '@/server/tenancy';
import { sendMenuToggleAlert } from '@/server/alerts';
import { log } from '@/server/log';
import { imageRef } from '@/server/zod-helpers';

const Patch = z.object({
  name: z.string().optional(),
  slug: z.string().optional(),
  description: z.string().optional().nullable(),
  price: z.number().optional(),
  categoryId: z.string().optional(),
  isVeg: z.boolean().optional(),
  spicyLevel: z.number().optional(),
  prepTimeMin: z.number().optional(),
  imageUrl: imageRef.optional().nullable(),
  isAvailable: z.boolean().optional(),
  isPopular: z.boolean().optional(),
  isRecommended: z.boolean().optional(),
  branchId: z.string().optional(),
  reason: z.string().optional().nullable()
}).strict().partial();

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const session = gate;
  const parsed = Patch.parse(await req.json());
  const { reason, ...data } = parsed;

  // Snapshot the existing availability so we can detect a true flip.
  const before = await prisma.menuItem.findUnique({
    where: { id },
    select: {
      id: true, name: true, isAvailable: true,
      branch: {
        select: {
          id: true, name: true, restaurantId: true,
          restaurant: { select: { id: true, name: true } }
        }
      }
    }
  });

  const u = await prisma.menuItem.update({
    where: { id },
    data: { ...data, ...(data.price != null ? { price: data.price as any } : {}) }
  });

  // Alert hook — only fire when isAvailable actually flipped. Runs after the
  // mutation commits and is fully suppressed if the mail layer throws so a
  // bad SMTP config can never roll back this PATCH.
  if (before && data.isAvailable !== undefined && before.isAvailable !== data.isAvailable) {
    const restaurantId = before.branch?.restaurantId;
    const restaurantName = before.branch?.restaurant?.name ?? '';
    if (restaurantId) {
      sendMenuToggleAlert({
        restaurantId,
        kind: 'item',
        entityType: 'MenuItem',
        entityId: id,
        entityName: before.name,
        restaurantName,
        branchName: before.branch?.name ?? null,
        actorName: session.user.name ?? session.user.email ?? null,
        actorEmail: session.user.email ?? null,
        actorRole: session.user.role,
        oldStatus: before.isAvailable ? 'Enabled' : 'Disabled',
        newStatus: data.isAvailable ? 'Enabled' : 'Disabled',
        reason: reason ?? null,
        timestamp: new Date(),
        detailUrl: `${process.env.NEXTAUTH_URL ?? ''}/admin/menu#item-${id}`
      }).catch((e) => log.error({ err: (e as Error).message, id }, 'sendMenuToggleAlert(item) failed'));
    }
  }

  return Response.json(u);
}

/**
 * DELETE /api/admin/menu/items/[id]
 *
 * Hard-delete a menu item. Two failure modes the UI needs to recover from:
 *
 *   • Cross-tenant attempt → 404 "not_found" so a stale UI doesn't expose
 *     whether the id exists in another restaurant. We don't 403 here on
 *     purpose; "not visible to me" is the same as "doesn't exist" from this
 *     admin's point of view.
 *
 *   • Foreign-key references → 409 `reason: 'fk_in_use'` with the count of
 *     blocking rows. The client uses that to offer "Hide instead" via the
 *     existing bulk-toggle endpoint, mirroring the bulk-delete flow.
 *
 * Tenancy was MISSING in the previous implementation — any admin could
 * `DELETE /api/admin/menu/items/<id-of-someone-else's-item>` and Prisma
 * would happily oblige. Fixed via the `requireRestaurant` + branch-scope
 * check below.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const restaurant = await requireRestaurant();

  // Tenancy: the item must belong to a branch of the caller's restaurant.
  // We fetch the row (not just count) so we can also surface the name in
  // the audit log + toast.
  const item = await prisma.menuItem.findFirst({
    where: { id, branch: { restaurantId: restaurant.id } },
    select: { id: true, name: true, branchId: true },
  });
  if (!item) {
    return Response.json(
      { error: 'Menu item not found (or already deleted).', reason: 'not_found' },
      { status: 404 },
    );
  }

  // FK pre-flight — see the bulk-delete handler for the full rationale.
  // We DO the cheap check before invoking Prisma so the error message can
  // name the specific blocking relations instead of leaking a 500.
  const [freebieBlock, orderBlock] = await Promise.all([
    prisma.freebieRule.count({ where: { menuItemId: id } }),
    prisma.orderItem.count({ where: { menuItemId: id } }),
  ]);
  if (freebieBlock > 0 || orderBlock > 0) {
    const reasons: string[] = [];
    if (orderBlock > 0) reasons.push(`${orderBlock} past order item${orderBlock === 1 ? '' : 's'}`);
    if (freebieBlock > 0) reasons.push(`${freebieBlock} freebie rule${freebieBlock === 1 ? '' : 's'}`);
    return Response.json(
      {
        error: `"${item.name}" is referenced by ${reasons.join(' and ')} and can't be deleted. Mark it Unavailable instead.`,
        reason: 'fk_in_use',
        itemId: id,
        itemName: item.name,
      },
      { status: 409 },
    );
  }

  // Delete inside a transaction so a concurrent order placement on this
  // item can't race us into an inconsistent state. The transaction will
  // surface any LATE-ARRIVING FK violation cleanly (rare but possible if
  // an order lands between the pre-flight count and the delete).
  try {
    await prisma.$transaction(async (tx) => {
      await tx.menuItem.delete({ where: { id } });
    });
  } catch (err) {
    log.error({ err: (err as Error).message, id }, 'menu item delete failed at commit');
    return Response.json(
      {
        error: `Could not delete "${item.name}". An order may have just referenced it — hide it instead, or retry.`,
        reason: 'delete_failed',
      },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, name: item.name });
}
