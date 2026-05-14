/**
 * /r/[slug]/me — the customer's "My account" page **for one restaurant**.
 *
 * Server-renders a full dashboard bundle (wallet, loyalty, recent orders,
 * most-ordered items, saved addresses, active coupons) all scoped to the
 * restaurant whose slug owns this route. Non-customers are bounced to the
 * tenant's customer login. Staff and platform users have their own surfaces.
 *
 * Heavy lifting lives in the matching API route at /api/customer/me/[slug];
 * this page repeats the same Prisma reads server-side so first paint isn't
 * blocked on a client fetch. The MeClient receives the fully-resolved bundle
 * and renders the polished, animated UI.
 */
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { Role } from '@prisma/client';
import { MeClient } from './me-client';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await prisma.restaurant.findUnique({ where: { slug }, select: { name: true } });
  return { title: r ? `My account · ${r.name}` : 'My account' };
}

export default async function CustomerMePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // ── Tenancy gate ───────────────────────────────────────────────────────────
  // Resolve the restaurant first so we 404 cleanly for bad slugs, even before
  // we check auth. (We don't want to leak that a slug exists by redirecting.)
  const restaurant = await prisma.restaurant.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, logoUrl: true, coverImageUrl: true, tagline: true, status: true }
  });
  if (!restaurant || restaurant.status !== 'ACTIVE') return notFound();

  const session = await auth();
  if (!session?.user) redirect(`/r/${slug}/login`);
  // The dashboard is a customer surface. Staff have their own admin/kitchen
  // dashboards — escort them to the customer login if they somehow land here.
  if (session.user.role !== Role.CUSTOMER) redirect(`/r/${slug}/login`);

  // Branch IDs for this restaurant — every "from this kitchen" query is
  // scoped against this list so we never leak orders/items from other tenants.
  const branches = await prisma.branch.findMany({
    where: { restaurantId: restaurant.id },
    select: { id: true }
  });
  const branchIds = branches.map((b) => b.id);
  const userId = session.user.id;
  const now = new Date();

  // Fetch the full bundle in parallel — the page is read-only, so one round
  // of Promise.all keeps TTFB tight even on the slowest sections (groupBy).
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
      take: 6
    })
  ]);

  // Hydrate the most-ordered rows with menu-item details so the client can
  // show name + image + price without a second hop.
  const mostOrderedIds = mostOrderedRows.map((r) => r.menuItemId).filter((x): x is string => Boolean(x));
  const items = mostOrderedIds.length
    ? await prisma.menuItem.findMany({
        where: { id: { in: mostOrderedIds } },
        select: { id: true, name: true, price: true, imageUrl: true, isVeg: true, branchId: true }
      })
    : [];
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const mostOrdered = mostOrderedRows.flatMap((r) => {
    const m = r.menuItemId ? itemMap.get(r.menuItemId) : null;
    if (!m) return [];
    return [{
      id: m.id,
      name: m.name,
      price: Number(m.price),
      imageUrl: m.imageUrl,
      isVeg: m.isVeg,
      branchId: m.branchId,
      timesOrdered: r._sum.quantity ?? 0
    }];
  });

  return (
    <MeClient
      restaurant={{
        id: restaurant.id,
        slug: restaurant.slug,
        name: restaurant.name,
        logoUrl: restaurant.logoUrl,
        coverImageUrl: restaurant.coverImageUrl,
        tagline: restaurant.tagline
      }}
      user={{
        id: user?.id ?? userId,
        name: user?.name ?? null,
        phone: user?.phone ?? null,
        email: user?.email ?? null,
        avatarUrl: user?.avatarUrl ?? null
      }}
      wallet={{
        balance: Number(wallet?.balance ?? 0),
        currency: wallet?.currency ?? 'INR'
      }}
      walletTxns={walletTxns.map((t) => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        note: t.note,
        createdAt: t.createdAt.toISOString(),
        orderId: t.orderId
      }))}
      loyalty={{
        pointsBalance: loyalty?.pointsBalance ?? 0,
        lifetimeEarn: loyalty?.lifetimeEarn ?? 0,
        lifetimeRedeem: loyalty?.lifetimeRedeem ?? 0
      }}
      addresses={addresses.map((a) => ({
        id: a.id,
        label: a.label,
        line1: a.line1,
        line2: a.line2,
        city: a.city,
        state: a.state,
        postalCode: a.postalCode,
        isDefault: a.isDefault
      }))}
      recentOrders={recentOrders.map((o) => ({
        id: o.id,
        code: o.code,
        status: o.status,
        total: Number(o.total),
        placedAt: o.placedAt.toISOString()
      }))}
      ordersFromHereCount={ordersFromHereCount}
      mostOrdered={mostOrdered}
      activeCoupons={activeCoupons.map((c) => ({
        id: c.id,
        code: c.code,
        description: c.description,
        percentOff: c.percentOff,
        flatOff: c.flatOff != null ? Number(c.flatOff) : null,
        minOrderAmount: c.minOrderAmount != null ? Number(c.minOrderAmount) : null,
        maxDiscount: c.maxDiscount != null ? Number(c.maxDiscount) : null,
        validTo: c.validTo ? c.validTo.toISOString() : null
      }))}
    />
  );
}
