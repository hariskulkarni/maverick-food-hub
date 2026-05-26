import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { parseStorefrontConfig } from '@/server/storefront-cms';
import { StorefrontEditor } from './storefront-editor';

export const metadata = { title: 'Admin · Storefront CMS' };
export const dynamic = 'force-dynamic';

export default async function StorefrontCmsPage() {
  const restaurant = await requireRestaurant();
  const config = parseStorefrontConfig((restaurant as { storefrontConfig?: unknown }).storefrontConfig);

  const branches = await prisma.branch.findMany({ where: { restaurantId: restaurant.id }, select: { id: true } });
  const branchIds = branches.map((b) => b.id);
  const cats = await prisma.category.findMany({
    where: { branchId: { in: branchIds } },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, sortOrder: true, isActive: true, _count: { select: { menuItems: true } } },
  });
  const categories = cats.map((c) => ({ id: c.id, name: c.name, sortOrder: c.sortOrder, isActive: c.isActive, itemCount: c._count.menuItems }));

  return (
    <div className="p-6 max-w-5xl">
      <StorefrontEditor
        initialConfig={config}
        categories={categories}
        slug={restaurant.slug}
        coverImageUrl={restaurant.coverImageUrl ?? null}
      />
    </div>
  );
}
