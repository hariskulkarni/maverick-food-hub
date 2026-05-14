import { prisma } from '@/server/db';
import { BrandsClient } from './brands-client';

export const metadata = { title: 'Platform · Brands' };
export const dynamic = 'force-dynamic';

export default async function PlatformBrandsPage() {
  const brands = await (prisma as any).brand.findMany({
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { restaurants: true } } }
  });

  // Lifetime revenue rollup — single grouped query keyed by branchId, folded
  // back to brand via Restaurant.brandId.
  const branchOwners = await (prisma as any).restaurant.findMany({
    where: { brandId: { not: null } },
    select: { brandId: true, branches: { select: { id: true } } }
  });
  const branchToBrand = new Map<string, string>();
  for (const r of branchOwners as any[]) {
    if (!r.brandId) continue;
    for (const b of r.branches) branchToBrand.set(b.id, r.brandId);
  }
  const allBranchIds = Array.from(branchToBrand.keys());
  const revenueByBrand = new Map<string, number>();
  if (allBranchIds.length > 0) {
    const grouped = await prisma.order.groupBy({
      by: ['branchId'],
      where: {
        branchId: { in: allBranchIds },
        status: { notIn: ['CANCELLED', 'PAYMENT_FAILED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_RESTAURANT', 'CANCELLED_BY_ADMIN', 'REFUNDED'] }
      },
      _sum: { total: true }
    });
    for (const g of grouped) {
      const brandId = branchToBrand.get(g.branchId);
      if (!brandId) continue;
      revenueByBrand.set(brandId, (revenueByBrand.get(brandId) ?? 0) + Number(g._sum.total ?? 0));
    }
  }

  const rows = brands.map((b: any) => ({
    id: b.id,
    slug: b.slug,
    name: b.name,
    tagline: b.tagline,
    logoUrl: b.logoUrl,
    coverImageUrl: b.coverImageUrl,
    status: b.status,
    createdAt: b.createdAt.toISOString(),
    cuisineCount: b._count.restaurants,
    lifetimeRevenue: revenueByBrand.get(b.id) ?? 0
  }));

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header>
        <h1 className="display text-3xl font-semibold">Brands</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Umbrella entities that group multiple cuisine-restaurants under a single hospitality client.
        </p>
      </header>

      <BrandsClient initial={rows} />
    </div>
  );
}
