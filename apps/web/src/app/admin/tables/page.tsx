import { requireRestaurant } from '@/server/tenancy';
import { prisma } from '@/server/db';
import { TablesClient } from './tables-client';
import { NoBranchNotice } from '../no-branch-notice';

export const metadata = { title: 'Admin · Tables' };
export const dynamic = 'force-dynamic';

export default async function TablesPage() {
  const restaurant = await requireRestaurant();
  const branch = await prisma.branch.findFirst({
    where: { restaurantId: restaurant.id },
    orderBy: { createdAt: 'asc' }
  });
  if (!branch) return <NoBranchNotice />;

  const tables = await prisma.restaurantTable.findMany({
    where: { branchId: branch.id },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
  });

  return (
    <TablesClient
      dineInEnabled={restaurant.dineInEnabled}
      initialTables={JSON.parse(JSON.stringify(tables))}
    />
  );
}
