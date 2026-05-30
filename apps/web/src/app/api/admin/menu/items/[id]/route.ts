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

  // Cascade-clean delete.
  //
  // Three FKs reference MenuItem in a way that BLOCKS straight delete:
  //   • OrderItem  — optional FK, NoAction. Past orders that ordered this
  //                  item. We SEVER the FK (set menuItemId = NULL) instead
  //                  of cascade-deleting the OrderItem rows; OrderItem
  //                  snapshots name + unitPrice + variant + modifiers at
  //                  order time (see schema line 1198 "snapshot for
  //                  invoice"), so past invoices, kitchen tickets, and
  //                  reports keep displaying correctly even after the
  //                  menu item is gone.
  //   • ComboItem  — Restrict. Combo memberships. We delete the rows
  //                  (the combo still exists; it just no longer includes
  //                  this item).
  //   • FreebieRule — Restrict. Freebie offers giving this item away. We
  //                  delete them; admins can recreate against a different
  //                  item if needed.
  //
  // This entire chain runs in ONE transaction — partial cascade plus a
  // failed delete would leave invoices broken, so atomicity is required.
  //
  // Side-effect counts are captured BEFORE the cascade so we can surface
  // them in the response. The UI uses them to write a clear success
  // toast ("Deleted Phirni · 3 past orders preserved, 2 combos updated").
  const [orderRefCount, comboRefCount, freebieRefCount] = await Promise.all([
    prisma.orderItem.count({ where: { menuItemId: id } }),
    prisma.comboItem.count({ where: { menuItemId: id } }),
    prisma.freebieRule.count({ where: { menuItemId: id } }),
  ]);

  try {
    await prisma.$transaction(async (tx) => {
      // 1. Past orders: keep the OrderItem rows (their content is
      //    snapshotted), just sever the FK so the MenuItem can drop.
      if (orderRefCount > 0) {
        await tx.orderItem.updateMany({
          where: { menuItemId: id },
          data: { menuItemId: null },
        });
      }
      // 2. Combo memberships: delete the membership rows. The combos
      //    themselves are untouched and continue to exist with their
      //    remaining items.
      if (comboRefCount > 0) {
        await tx.comboItem.deleteMany({ where: { menuItemId: id } });
      }
      // 3. Freebie rules referencing this item: delete them. There's no
      //    meaningful way to keep a "give away this nonexistent dish"
      //    rule, so we drop them.
      if (freebieRefCount > 0) {
        await tx.freebieRule.deleteMany({ where: { menuItemId: id } });
      }
      // 4. Finally, the menu item itself. Other relations (variants,
      //    modifier groups, cross-sells, availability rows, etc.) all
      //    cascade automatically.
      await tx.menuItem.delete({ where: { id } });
    });
  } catch (err) {
    const e = err as { code?: string; meta?: Record<string, unknown>; message?: string };
    // Safety net for any future FK we didn't enumerate above. We DON'T
    // try to cascade-clean unknown relations — that would risk silently
    // destroying data. Instead, surface the structured 409 so the UI's
    // "Hide instead" flow takes over.
    if (e.code === 'P2003' || /Foreign key constraint/i.test(e.message ?? '')) {
      log.warn({ id, meta: e.meta, msg: e.message }, 'menu item delete blocked by an unenumerated FK');
      return Response.json(
        {
          error: `"${item.name}" is still referenced by something we couldn't safely cascade. Mark it Unavailable instead.`,
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

  return Response.json({
    ok: true,
    name: item.name,
    cascaded: {
      orderItems: orderRefCount,    // past orders that lost their MenuItem FK
      combos: comboRefCount,        // combo memberships removed
      freebieRules: freebieRefCount // freebie rules removed
    },
  });
}
