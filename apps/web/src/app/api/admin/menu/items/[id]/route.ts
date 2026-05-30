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

  // FK pre-flight — count every relation that could block delete so the
  // error message names the SPECIFIC source instead of a generic 500.
  //
  // Three FKs restrict MenuItem deletion (Prisma schema audit):
  //   • FreebieRule.menuItemId — onDelete: Restrict (line 828)
  //   • ComboItem.menuItemId   — onDelete: Restrict (line 1031)
  //   • OrderItem.menuItemId   — optional FK, default NoAction (line 1213)
  //
  // All other relations to MenuItem cascade or set-null, so they don't
  // block delete. If a future schema change introduces a fourth
  // restrict-relation, the `catch` at the actual delete site (below)
  // still surfaces a clean error message — this list is the
  // best-effort-UX layer; the catch is the safety net.
  const [freebieBlock, comboBlock, orderBlock] = await Promise.all([
    prisma.freebieRule.count({ where: { menuItemId: id } }),
    prisma.comboItem.count({ where: { menuItemId: id } }),
    prisma.orderItem.count({ where: { menuItemId: id } }),
  ]);
  if (freebieBlock > 0 || comboBlock > 0 || orderBlock > 0) {
    const reasons: string[] = [];
    if (orderBlock > 0) reasons.push(`${orderBlock} past order item${orderBlock === 1 ? '' : 's'}`);
    if (comboBlock > 0) reasons.push(`${comboBlock} combo${comboBlock === 1 ? '' : 's'}`);
    if (freebieBlock > 0) reasons.push(`${freebieBlock} freebie rule${freebieBlock === 1 ? '' : 's'}`);
    return Response.json(
      {
        error: `"${item.name}" is referenced by ${reasons.join(' and ')} and can't be deleted. Mark it Unavailable instead.`,
        reason: 'fk_in_use',
        itemId: id,
        itemName: item.name,
        blockedBy: { orders: orderBlock, combos: comboBlock, freebies: freebieBlock },
      },
      { status: 409 },
    );
  }

  // Safety net: any FK constraint we DIDN'T enumerate above (e.g. a new
  // relation introduced by a future migration) surfaces here as a Prisma
  // P2003. We catch it specifically and translate to the same fk_in_use
  // shape the client already handles — instead of leaking a 500 the user
  // can't recover from. This is what made the previous "Delete failed"
  // unactionable.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.menuItem.delete({ where: { id } });
    });
  } catch (err) {
    const e = err as { code?: string; meta?: Record<string, unknown>; message?: string };
    if (e.code === 'P2003' || /Foreign key constraint/i.test(e.message ?? '')) {
      log.warn({ id, meta: e.meta, msg: e.message }, 'menu item delete blocked by an unenumerated FK');
      return Response.json(
        {
          error: `"${item.name}" is still referenced elsewhere and can't be deleted. Mark it Unavailable instead.`,
          reason: 'fk_in_use',
          itemId: id,
          itemName: item.name,
        },
        { status: 409 },
      );
    }
    log.error({ err: e.message, id }, 'menu item delete failed at commit');
    return Response.json(
      {
        error: `Could not delete "${item.name}". Hide it instead, or retry.`,
        reason: 'delete_failed',
      },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, name: item.name });
}
