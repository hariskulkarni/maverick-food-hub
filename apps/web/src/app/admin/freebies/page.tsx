import { requireRestaurant } from '@/server/tenancy';
import { prisma } from '@/server/db';
import { FreebiesClient } from './freebies-client';
import { serializeFreebieRule } from '@/app/api/admin/freebies/_helpers';
import { NoBranchNotice } from '../no-branch-notice';

export const metadata = { title: 'Admin · Freebies' };
export const dynamic = 'force-dynamic';

export default async function FreebiesPage() {
  const restaurant = await requireRestaurant();
  const branch = await prisma.branch.findFirst({
    where: { restaurantId: restaurant.id },
    orderBy: { createdAt: 'asc' }
  });
  if (!branch) return <NoBranchNotice />;

  const [rules, menuItems] = await Promise.all([
    prisma.freebieRule.findMany({
      where: { branchId: branch.id },
      include: { menuItem: { select: { name: true } } },
      orderBy: [{ sortOrder: 'asc' }, { minOrderAmount: 'asc' }]
    }),
    prisma.menuItem.findMany({
      where: { branchId: branch.id },
      select: { id: true, name: true, isAvailable: true },
      orderBy: { name: 'asc' }
    })
  ]);

  return (
    <FreebiesClient
      allowFreebies={restaurant.allowFreebies}
      initialRules={rules.map(serializeFreebieRule)}
      menuItems={menuItems}
    />
  );
}
