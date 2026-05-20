/**
 * GET /api/r/[slug]/freebies?subtotal=NNN
 *
 * Public read — given a cart subtotal, returns the best qualifying in-stock
 * freebie at the slug's active branch (reusing the core selection engine), plus
 * a "spend ₹X more" nudge toward the next-cheapest threshold the cart hasn't
 * cleared yet. No auth required: the storefront calls this as the cart total
 * changes so it can show "🎁 You've earned a free Y!". The branch is resolved
 * safely by slug — we never accept a branchId from the client.
 *
 * Returns null `qualifying` when freebies are off, no rule qualifies, or every
 * qualifying rule is out of stock.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { resolveQualifyingFreebie } from '@/server/freebies';
import { resolveBranchForSlug } from '../reservations/_helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // Resolve branch + the restaurant's allowFreebies flag by slug.
  const branch = await resolveBranchForSlug(slug);
  if (!branch) return Response.json({ error: 'Restaurant not found' }, { status: 404 });

  const restaurant = await prisma.restaurant.findUnique({
    where: { slug },
    select: { allowFreebies: true }
  });
  const allowFreebies = restaurant?.allowFreebies ?? false;

  if (!allowFreebies) {
    return Response.json({ allowFreebies: false, qualifying: null, nextThreshold: null });
  }

  const subtotalRaw = Number(req.nextUrl.searchParams.get('subtotal'));
  const subtotal = Number.isFinite(subtotalRaw) && subtotalRaw > 0 ? subtotalRaw : 0;

  const qualifying = await resolveQualifyingFreebie(branch.branchId, subtotal, allowFreebies);

  // "Spend ₹X more for a free Y" nudge — the cheapest active, in-stock rule
  // whose threshold the cart hasn't reached yet (and whose gift is available).
  const upcoming = await prisma.freebieRule.findFirst({
    where: {
      branchId: branch.branchId,
      isActive: true,
      stock: { gt: 0 },
      minOrderAmount: { gt: subtotal },
      menuItem: { isAvailable: true }
    },
    include: { menuItem: { select: { name: true } } },
    orderBy: [{ minOrderAmount: 'asc' }, { sortOrder: 'asc' }]
  });

  return Response.json({
    allowFreebies: true,
    qualifying: qualifying
      ? { ruleId: qualifying.ruleId, itemName: qualifying.itemName }
      : null,
    nextThreshold: upcoming
      ? {
          itemName: upcoming.menuItem.name,
          minOrderAmount: Number(upcoming.minOrderAmount),
          amountAway: Math.max(0, Number(upcoming.minOrderAmount) - subtotal)
        }
      : null
  });
}
