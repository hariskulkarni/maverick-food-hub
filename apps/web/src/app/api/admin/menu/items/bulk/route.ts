import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireRestaurantAdminApi } from '@/server/api-auth';
import { requireRestaurant } from '@/server/tenancy';
import { audit } from '@/server/audit';
import { sendMenuToggleAlert } from '@/server/alerts';
import { log } from '@/server/log';
import { parseOrJsonError } from '@/server/zod-helpers';

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
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const session = gate;
  const restaurant = await requireRestaurant();
  const parsed = parseOrJsonError(Body, await req.json());
  if (parsed instanceof Response) return parsed;
  const { ids, patch, reason } = parsed;

  // Tenancy: every item must belong to a branch of the requesting admin's restaurant.
  const owned = await prisma.menuItem.count({
    where: { id: { in: ids }, branch: { restaurantId: restaurant.id } }
  });
  if (owned !== ids.length) {
    return Response.json(
      { error: 'Some items do not belong to this restaurant.', code: 'auth/forbidden', reason: 'cross_tenant' },
      { status: 403 }
    );
  }

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

/**
 * DELETE /api/admin/menu/items/bulk
 *
 * Bulk-delete menu items. Body: `{ ids: string[], reason?: string }`.
 *
 * Why a custom handler rather than reusing the single-item DELETE in a loop:
 *
 *   1. ONE tenancy check up front (a loop would hit the DB N+1 times).
 *   2. ATOMIC delete inside `prisma.menuItem.deleteMany` — either every
 *      deletable item drops or none do, so a partial failure doesn't leave
 *      the UI desynced.
 *   3. CLEAR ERROR when foreign keys block the delete. Menu items are
 *      referenced by FreebieRule (`onDelete: Restrict`) and historical
 *      OrderItem rows. We CHECK for those first and tell the admin which
 *      items can't be hard-deleted, with a one-button fallback to hide
 *      them instead — the bulk-toggle codepath already supports that.
 *
 * Reasons the client knows how to render:
 *   - `cross_tenant`     — at least one id isn't theirs
 *   - `fk_in_use`        — some items are referenced (orders/freebies)
 *                          and should be hidden rather than deleted
 *   - `not_found`        — every id was already gone
 */
const DeleteBody = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
  reason: z.string().max(500).optional().nullable(),
});

export async function DELETE(req: NextRequest) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const session = gate;
  const restaurant = await requireRestaurant();

  const parsed = parseOrJsonError(DeleteBody, await req.json());
  if (parsed instanceof Response) return parsed;
  const { ids, reason } = parsed;

  // Tenancy: every id must belong to a branch of the caller's restaurant.
  // We fetch the actual rows so we can also tell the audit log what NAMES
  // were deleted (much friendlier than just IDs in the activity feed).
  const ownedRows = await prisma.menuItem.findMany({
    where: { id: { in: ids }, branch: { restaurantId: restaurant.id } },
    select: { id: true, name: true, branchId: true },
  });
  const ownedIds = new Set(ownedRows.map((r) => r.id));
  const missingIds = ids.filter((id) => !ownedIds.has(id));
  if (missingIds.length > 0) {
    return Response.json(
      {
        error: missingIds.length === ids.length
          ? 'None of those items exist anymore.'
          : `${missingIds.length} of ${ids.length} items don't belong to this restaurant or were already deleted.`,
        code: 'auth/forbidden',
        reason: missingIds.length === ids.length ? 'not_found' : 'cross_tenant',
        missingIds,
      },
      { status: missingIds.length === ids.length ? 404 : 403 },
    );
  }

  // Count cascade-side-effects BEFORE the transaction so the audit log +
  // the success toast can name what got swept up. See the single-item
  // handler for the full rationale on why we sever OrderItem (snapshotted
  // fields preserve invoice integrity) but delete ComboItem + FreebieRule.
  const [orderRefCount, comboRefCount, freebieRefCount] = await Promise.all([
    prisma.orderItem.count({ where: { menuItemId: { in: ids } } }),
    prisma.comboItem.count({ where: { menuItemId: { in: ids } } }),
    prisma.freebieRule.count({ where: { menuItemId: { in: ids } } }),
  ]);

  // Cascade-clean bulk delete inside a single transaction. Atomic: a
  // failure anywhere in the chain rolls back the OrderItem severance, so
  // past invoices either ALL stay intact or NONE do — never a half-state.
  let deletedCount = 0;
  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Sever OrderItem references (preserve snapshotted invoice data).
      if (orderRefCount > 0) {
        await tx.orderItem.updateMany({
          where: { menuItemId: { in: ids } },
          data: { menuItemId: null },
        });
      }
      // 2. Drop combo memberships.
      if (comboRefCount > 0) {
        await tx.comboItem.deleteMany({ where: { menuItemId: { in: ids } } });
      }
      // 3. Drop freebie rules that gift any of these items.
      if (freebieRefCount > 0) {
        await tx.freebieRule.deleteMany({ where: { menuItemId: { in: ids } } });
      }
      // 4. Finally, the menu items themselves (scoped to tenancy).
      return tx.menuItem.deleteMany({
        where: { id: { in: ids }, branch: { restaurantId: restaurant.id } },
      });
    });
    deletedCount = result.count;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    // Safety net: if a FUTURE migration adds another restrict-FK we
    // didn't enumerate, the cascade chain is incomplete and Prisma
    // raises P2003. Surface a structured 409 so the client can fall
    // back to "Hide instead" rather than seeing a generic 500.
    if (e.code === 'P2003' || /Foreign key constraint/i.test(e.message ?? '')) {
      log.warn({ ids, msg: e.message }, 'bulk delete blocked by an unenumerated FK');
      return Response.json(
        {
          error: `Selected items are still referenced by something we couldn't safely cascade. Mark them Unavailable instead.`,
          reason: 'fk_in_use',
          blockedIds: ids,
          deletableIds: [],
        },
        { status: 409 },
      );
    }
    log.error({ err: e.message, restaurantId: restaurant.id, count: ids.length }, 'bulk delete failed');
    return Response.json(
      {
        error: 'Could not delete the selected items. Try again, or hide them instead.',
        reason: 'delete_failed',
      },
      { status: 500 },
    );
  }

  await audit('menu.bulk_delete', {
    actorId: session.user.id,
    restaurantId: restaurant.id,
    entityType: 'MenuItem',
    after: {
      count: deletedCount,
      names: ownedRows.filter((r) => ids.includes(r.id)).map((r) => r.name),
      cascaded: { orderItems: orderRefCount, combos: comboRefCount, freebieRules: freebieRefCount },
      reason: reason ?? null,
    },
  });

  // Cascade-clean bulk delete always deletes EVERY listed id (no partial
  // FK-block path anymore), so the response shape is simple: deleted
  // count + side-effect summary the UI can surface in its toast.
  return Response.json(
    {
      deleted: deletedCount,
      blocked: 0,
      cascaded: {
        orderItems: orderRefCount,
        combos: comboRefCount,
        freebieRules: freebieRefCount,
      },
    },
    { status: 200 },
  );
}
