/**
 * GET /api/customer/me/[slug]
 *
 * Returns the *restaurant-scoped* customer bundle used by `/r/[slug]/me`.
 *
 *   { user, wallet, loyalty, addresses, mostOrdered, recentOrders,
 *     activeCoupons, restaurant }
 *
 *   - `user`          → identity (id, name, phone, email, avatar)
 *   - `wallet`        → balance + last 5 WalletTransaction entries
 *   - `loyalty`       → points balance + lifetime earn/redeem
 *   - `addresses`     → all saved addresses (default first)
 *   - `mostOrdered`   → top 4 menu items the customer has ordered most often
 *                       *from this restaurant's branches* (with image, name,
 *                       count, price, branchId so the client can add-to-cart)
 *   - `recentOrders`  → last 5 orders to this restaurant (code, date,
 *                       total, status)
 *   - `activeCoupons` → platform-wide ACTIVE coupons currently valid
 *   - `restaurant`    → id, slug, name, logo, cover
 *
 * 401 if no session, 404 if the slug doesn't resolve to an ACTIVE restaurant.
 */
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const { slug } = await ctx.params;

  const restaurant = await prisma.restaurant.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, logoUrl: true, coverImageUrl: true, status: true, tagline: true }
  });
  if (!restaurant || restaurant.status !== 'ACTIVE') {
    return new Response('Not found', { status: 404 });
  }

  // Branch IDs for this tenant. Used to scope every per-restaurant query so we
  // never leak data from a different restaurant the customer also ordered from.
  const branches = await prisma.branch.findMany({
    where: { restaurantId: restaurant.id },
    select: { id: true }
  });
  const branchIds = branches.map((b) => b.id);

  const userId = session.user.id;
  const now = new Date();

  const [user, wallet, walletTxns, loyalty, addresses, recentOrders, ordersFromHereCount, mostOrderedRows, activeCoupons] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, phone: true, email: true, avatarUrl: true }
    }),
    prisma.wallet.findUnique({ where: { userId } }),
    prisma.walletTransaction.findMany({
      where: { wallet: { userId } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, type: true, amount: true, note: true, createdAt: true, orderId: true }
    }),
    prisma.loyaltyAccount.findUnique({ where: { userId } }),
    prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }]
    }),
    branchIds.length === 0
      ? Promise.resolve([])
      : prisma.order.findMany({
          where: { customerId: userId, branchId: { in: branchIds } },
          orderBy: { placedAt: 'desc' },
          take: 5,
          select: { id: true, code: true, status: true, total: true, placedAt: true }
        }),
    branchIds.length === 0
      ? Promise.resolve(0)
      : prisma.order.count({ where: { customerId: userId, branchId: { in: branchIds } } }),
    branchIds.length === 0
      ? Promise.resolve([] as Array<{ menuItemId: string | null; _sum: { quantity: number | null } }>)
      : prisma.orderItem.groupBy({
          by: ['menuItemId'],
          _sum: { quantity: true },
          where: {
            menuItemId: { not: null },
            order: { customerId: userId, branchId: { in: branchIds }, status: { notIn: ['CANCELLED', 'PAYMENT_FAILED'] } }
          },
          orderBy: { _sum: { quantity: 'desc' } },
          take: 4
        }),
    prisma.coupon.findMany({
      where: {
        isActive: true,
        OR: [{ validTo: null }, { validTo: { gt: now } }]
      },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: {
        id: true, code: true, description: true, percentOff: true, flatOff: true,
        minOrderAmount: true, maxDiscount: true, validTo: true
      }
    })
  ]);

  // Hydrate the most-ordered groupBy rows with menu-item details.
  const mostOrderedIds = mostOrderedRows.map((r) => r.menuItemId).filter((x): x is string => Boolean(x));
  const items = mostOrderedIds.length
    ? await prisma.menuItem.findMany({
        where: { id: { in: mostOrderedIds } },
        select: { id: true, name: true, price: true, imageUrl: true, isVeg: true, branchId: true }
      })
    : [];
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const mostOrdered = mostOrderedRows
    .map((r) => {
      const m = r.menuItemId ? itemMap.get(r.menuItemId) : null;
      if (!m) return null;
      return {
        id: m.id,
        name: m.name,
        price: Number(m.price),
        imageUrl: m.imageUrl,
        isVeg: m.isVeg,
        branchId: m.branchId,
        timesOrdered: r._sum.quantity ?? 0
      };
    })
    .filter(Boolean);

  return Response.json({
    restaurant,
    user,
    wallet: wallet ? { balance: Number(wallet.balance), currency: wallet.currency } : { balance: 0, currency: 'INR' },
    walletTxns: walletTxns.map((t) => ({ ...t, amount: Number(t.amount) })),
    loyalty: loyalty ? {
      pointsBalance: loyalty.pointsBalance,
      lifetimeEarn: loyalty.lifetimeEarn,
      lifetimeRedeem: loyalty.lifetimeRedeem
    } : { pointsBalance: 0, lifetimeEarn: 0, lifetimeRedeem: 0 },
    addresses,
    ordersFromHereCount,
    recentOrders: recentOrders.map((o) => ({ ...o, total: Number(o.total) })),
    mostOrdered,
    activeCoupons: activeCoupons.map((c) => ({
      ...c,
      flatOff: c.flatOff != null ? Number(c.flatOff) : null,
      minOrderAmount: c.minOrderAmount != null ? Number(c.minOrderAmount) : null,
      maxDiscount: c.maxDiscount != null ? Number(c.maxDiscount) : null
    }))
  });
}
