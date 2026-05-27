import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { auth } from '@/server/auth';
import { redirect } from 'next/navigation';
import { CombosManager } from './combos-manager';
import { NoBranchNotice } from '../no-branch-notice';

export const metadata = { title: 'Admin · Combos' };
export const dynamic = 'force-dynamic';

export default async function AdminCombosPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    redirect('/login?next=/admin/combos&mode=admin');
  }
  const restaurant = await requireRestaurant();
  // Combos live under branches; for now we operate against the first active
  // branch — matching the rest of the admin surface (menu, kitchen, etc.).
  const branch = await prisma.branch.findFirst({
    where: { restaurantId: restaurant.id, isActive: true },
    orderBy: { createdAt: 'asc' }
  });
  if (!branch) return <NoBranchNotice />;

  const combos = await prisma.combo.findMany({
    where: { branchId: branch.id },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    include: {
      items: {
        include: {
          menuItem: { select: { id: true, name: true, price: true, isAvailable: true, imageUrl: true } }
        }
      }
    }
  });

  const menuItems = await prisma.menuItem.findMany({
    where: { branchId: branch.id },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, price: true, isAvailable: true, categoryId: true, imageUrl: true }
  });

  const categories = await prisma.category.findMany({
    where: { branchId: branch.id },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true }
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <header>
        <h1 className="display text-3xl font-semibold">Combos</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Curated meal bundles for {restaurant.name}. Group 2+ menu items into a
          single combo with its own price, image, and availability toggle.
        </p>
      </header>
      <CombosManager
        branchId={branch.id}
        combos={JSON.parse(JSON.stringify(combos))}
        menuItems={JSON.parse(JSON.stringify(menuItems))}
        categories={JSON.parse(JSON.stringify(categories))}
      />
    </div>
  );
}
