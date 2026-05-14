import { prisma } from '@/server/db';
import { getBrandSalesRollup } from '@/server/brands';
import { notFound } from 'next/navigation';
import { BrandDetailClient } from './brand-detail-client';

export const dynamic = 'force-dynamic';

export default async function BrandDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const brand = await (prisma as any).brand.findUnique({
    where: { id },
    include: {
      restaurants: {
        orderBy: { name: 'asc' },
        include: { _count: { select: { branches: true } } }
      }
    }
  });
  if (!brand) notFound();

  // Unassigned, ACTIVE-only restaurants for the picker.
  const unassigned: any[] = await (prisma as any).restaurant.findMany({
    where: { brandId: null, status: 'ACTIVE' },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, slug: true, cuisine: true, _count: { select: { branches: true } } }
  });

  const to   = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);
  const rollup = await getBrandSalesRollup(brand.id, { from, to });

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <BrandDetailClient
        brand={{
          id: brand.id,
          slug: brand.slug,
          name: brand.name,
          tagline: brand.tagline,
          description: brand.description,
          logoUrl: brand.logoUrl,
          coverImageUrl: brand.coverImageUrl,
          contactEmail: brand.contactEmail,
          contactPhone: brand.contactPhone,
          status: brand.status,
          createdAt: brand.createdAt.toISOString()
        }}
        cuisines={brand.restaurants.map((r: any) => ({
          id: r.id,
          slug: r.slug,
          name: r.name,
          status: r.status,
          cuisine: r.cuisine,
          branchCount: r._count.branches
        }))}
        unassigned={unassigned.map((r: any) => ({
          id: r.id, name: r.name, slug: r.slug, cuisine: r.cuisine, branchCount: r._count.branches
        }))}
        initialReport={rollup}
      />
    </div>
  );
}
