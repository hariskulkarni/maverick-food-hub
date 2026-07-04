/**
 * POST /api/platform/restaurants/reorder
 *
 * Persist a curated outlet sequence. Super-admin only.
 *
 * Body: { ids: string[] }
 *   The full ordered list of restaurant ids to apply. Position in the array
 *   becomes the row's sortOrder (multiplied by 10 to leave room for future
 *   insertions without renumbering everything). Ids not in the payload are
 *   left untouched — the client is expected to send the complete list it is
 *   currently displaying so the curated order is unambiguous.
 *
 * Why "ids only" instead of {id, sortOrder} pairs:
 *   The UI does drag-and-drop and renumbers contiguously anyway, so the
 *   server doing the multiplication keeps the index sparse without leaking
 *   that detail into the client. It also makes a tampered payload (e.g.
 *   duplicate sortOrder values) impossible by construction.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { audit } from '@/server/audit';
import { revalidateRestaurantSurfaces } from '@/server/revalidate';

const Body = z.object({
  ids: z.array(z.string().min(1)).min(1).max(1000),
});

export async function POST(req: NextRequest) {
  const session = await requireSuperAdmin();
  const { ids } = Body.parse(await req.json());

  // Defensively de-dupe while preserving order — a buggy client should not be
  // able to assign two restaurants the same sortOrder via duplicate entries.
  const seen = new Set<string>();
  const unique = ids.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));

  // Capture the previous order of the affected rows for the audit trail.
  const before = await prisma.restaurant.findMany({
    where: { id: { in: unique } },
    select: { id: true, sortOrder: true },
  });
  const beforeMap = new Map(before.map((r) => [r.id, r.sortOrder]));

  // Apply the new ordering in a single transaction so a half-applied reorder
  // can't leave the list in a partially-shuffled state.
  await prisma.$transaction(
    unique.map((id, index) =>
      prisma.restaurant.update({
        where: { id },
        data: { sortOrder: index * 10 },
      })
    )
  );

  await audit('restaurant.sort_order.update', {
    actorId: session.user?.id,
    actorRole: session.user?.role,
    entityType: 'Restaurant',
    before: { order: before.sort((a, b) => a.sortOrder - b.sortOrder).map((r) => r.id) },
    after: { order: unique, sortOrders: unique.map((id, i) => ({ id, was: beforeMap.get(id), now: i * 10 })) },
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: req.headers.get('user-agent') ?? undefined,
  });

  revalidateRestaurantSurfaces();
  return Response.json({ ok: true, count: unique.length });
}
