/**
 * GET /api/customer/recent-orders
 * Last 10 distinct restaurants the user has ordered from, with their latest
 * order code. Powers the "Order again" rail on the customer home.
 */
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });

  // Pull a generous window of recent orders, then dedupe by restaurant in JS.
  // 60 covers most users without needing a per-restaurant subquery.
  const recent = await prisma.order.findMany({
    where: { customerId: session.user.id },
    orderBy: { placedAt: 'desc' },
    take: 60,
    select: {
      id: true,
      code: true,
      placedAt: true,
      total: true,
      branch: {
        select: {
          id: true,
          name: true,
          slug: true,
          restaurant: { select: { id: true, name: true, slug: true, logoUrl: true } }
        }
      }
    }
  });

  const seen = new Set<string>();
  const result: Array<{
    orderId: string;
    orderCode: string;
    placedAt: Date;
    total: number;
    restaurantId: string;
    restaurantName: string;
    restaurantSlug: string;
    restaurantLogoUrl: string | null;
    branchSlug: string;
  }> = [];
  for (const o of recent) {
    const rid = o.branch.restaurant.id;
    if (seen.has(rid)) continue;
    seen.add(rid);
    result.push({
      orderId: o.id,
      orderCode: o.code,
      placedAt: o.placedAt,
      total: Number(o.total),
      restaurantId: rid,
      restaurantName: o.branch.restaurant.name,
      restaurantSlug: o.branch.restaurant.slug,
      restaurantLogoUrl: o.branch.restaurant.logoUrl,
      branchSlug: o.branch.slug
    });
    if (result.length >= 10) break;
  }

  return Response.json({ restaurants: result });
}
