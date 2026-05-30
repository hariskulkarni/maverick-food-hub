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

  // Pre-flight: surface FK references BEFORE attempting the delete so the
  // error message can name the specific items that are locked.
  //   - Active freebie rules (onDelete: Restrict — blocks delete).
  //   - Order items that historically used this menu item (optional FK with
  //     default NoAction — also blocks).
  // Cross-sells, variants, modifier groups, item-availability rows all
  // cascade automatically, so they don't need a check.
  // Three FKs restrict MenuItem deletion. The same audit as the single-item
  // handler — FreebieRule, ComboItem, OrderItem. Missing any one of these
  // means deleteMany throws a P2003 inside the transaction and the whole
  // batch rolls back; we catch it below as a safety net for future migrations.
  const [freebieBlocked, comboBlocked, orderBlocked] = await Promise.all([
    prisma.freebieRule.findMany({
      where: { menuItemId: { in: ids } },
      select: { menuItemId: true },
    }),
    prisma.comboItem.findMany({
      where: { menuItemId: { in: ids } },
      distinct: ['menuItemId'],
      select: { menuItemId: true },
    }),
    prisma.orderItem.findMany({
      where: { menuItemId: { in: ids } },
      distinct: ['menuItemId'],
      select: { menuItemId: true },
    }),
  ]);
  const blockedIds = new Set<string>([
    ...freebieBlocked.map((f) => f.menuItemId),
    ...comboBlocked.map((c) => c.menuItemId),
    ...(orderBlocked.map((o) => o.menuItemId).filter((id): id is string => !!id)),
  ]);

  const deletableIds = ids.filter((id) => !blockedIds.has(id));

  if (deletableIds.length === 0) {
    return Response.json(
      {
        error: `${ids.length} item${ids.length === 1 ? ' is' : 's are'} referenced by past orders, combos, or freebie rules and can't be deleted. Mark them Unavailable instead.`,
        reason: 'fk_in_use',
        blockedIds: Array.from(blockedIds),
        deletableIds: [],
      },
      { status: 409 },
    );
  }

  // Execute the delete for the items we CAN remove. `deleteMany` is wrapped
  // in a transaction so a late-arriving order placement on one of these ids
  // can't race us into an inconsistent state — the transaction either
  // succeeds against all of `deletableIds` or rolls back.
  let deletedCount = 0;
  try {
    const result = await prisma.$transaction(async (tx) => {
      return tx.menuItem.deleteMany({
        where: { id: { in: deletableIds }, branch: { restaurantId: restaurant.id } },
      });
    });
    deletedCount = result.count;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    // Safety net: an FK constraint we DIDN'T enumerate above (e.g. a future
    // migration) surfaces here as P2003. We can't determine WHICH ids were
    // blocked without a re-scan, so we tell the client the whole batch is
    // FK-blocked and let them fall back to "Hide instead" — same recovery
    // path the partial case already uses.
    if (e.code === 'P2003' || /Foreign key constraint/i.test(e.message ?? '')) {
      log.warn({ ids: deletableIds, msg: e.message }, 'bulk delete blocked by an unenumerated FK');
      return Response.json(
        {
          error: `${deletableIds.length} item${deletableIds.length === 1 ? ' is' : 's are'} still referenced elsewhere and can't be deleted. Mark them Unavailable instead.`,
          reason: 'fk_in_use',
          blockedIds: deletableIds,
          deletableIds: [],
        },
        { status: 409 },
      );
    }
    log.error({ err: e.message, restaurantId: restaurant.id, count: deletableIds.length }, 'bulk delete failed');
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
      names: ownedRows.filter((r) => deletableIds.includes(r.id)).map((r) => r.name),
      blockedCount: blockedIds.size,
      reason: reason ?? null,
    },
  });

  // Partial success: some items deleted, some blocked. The 207-style payload
  // lets the client toast the success AND offer to hide the rest in one tap.
  if (blockedIds.size > 0) {
    return Response.json(
      {
        deleted: deletedCount,
        blocked: blockedIds.size,
        blockedIds: Array.from(blockedIds),
        deletableIds,
        // 200 (not 207) so the client treats this as a success that needs a
        // follow-up nudge — the toast helper looks at the body, not status.
        reason: 'partial_fk_in_use',
        error: `${deletedCount} item${deletedCount === 1 ? '' : 's'} deleted. ${blockedIds.size} couldn't be deleted because they have order history, combos, or freebie rules — would you like to hide them instead?`,
      },
      { status: 200 },
    );
  }

  return Response.json({ deleted: deletedCount, blocked: 0 });
}
