/**
 * GET /api/customer/cross-sell/cart?branchId=<id>&items=<id,id,id>&surface=cart
 *
 * Cart-level cross-sell: given the items already in the cart, returns suggested
 * add-on items the customer might want. Suggestions are:
 *   1. Pulled from any CrossSell row whose `parentItemId` is in the cart and
 *      whose `surface` includes the requested surface (default 'cart').
 *   2. Deduped — if multiple parent items suggest the same target, we keep the
 *      lowest sortOrder.
 *   3. Filtered to remove items already in the cart.
 *   4. Limited to the requested branch (parent + suggested must live there).
 *   5. Sorted by sortOrder ASC.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const role = session.user.role;
  if (role === 'ADMIN' || role === 'RIDER' || role === 'KITCHEN' || role === 'SUPER_ADMIN') {
    return new Response('Forbidden', { status: 403 });
  }

  const branchId = req.nextUrl.searchParams.get('branchId');
  const itemsParam = req.nextUrl.searchParams.get('items') ?? '';
  const surface = req.nextUrl.searchParams.get('surface') ?? 'cart';

  if (!branchId) return new Response('Missing branchId param', { status: 400 });

  const cartItemIds = itemsParam.split(',').map((s) => s.trim()).filter(Boolean);
  if (cartItemIds.length === 0) {
    return Response.json({ suggestions: [] });
  }

  const cartSet = new Set(cartItemIds);

  const rows = await prisma.crossSell.findMany({
    where: {
      parentItemId: { in: cartItemIds },
      isActive: true,
      surface: { contains: surface },
      parentItem: { branchId },
      suggestedItem: { branchId, isAvailable: true }
    },
    include: {
      suggestedItem: {
        select: {
          id: true,
          name: true,
          slug: true,
          price: true,
          imageUrl: true,
          isAvailable: true,
          isVeg: true,
          branchId: true,
          categoryId: true
        }
      }
    },
    orderBy: { sortOrder: 'asc' }
  });

  // Dedupe by suggestedItemId, keeping the first (lowest sortOrder) seen.
  const seen = new Set<string>();
  const suggestions: any[] = [];
  for (const r of rows) {
    if (!r.suggestedItem) continue;
    if (cartSet.has(r.suggestedItem.id)) continue;
    if (seen.has(r.suggestedItem.id)) continue;
    seen.add(r.suggestedItem.id);
    suggestions.push({
      id: r.id,
      sortOrder: r.sortOrder,
      surface: r.surface,
      note: r.note,
      source: r.source,
      parentItemId: r.parentItemId,
      suggestedItem: r.suggestedItem
    });
  }

  suggestions.sort((a, b) => a.sortOrder - b.sortOrder);

  return Response.json({ suggestions });
}
