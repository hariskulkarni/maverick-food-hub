import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { CouponsClient } from './coupons-client';

export const metadata = { title: 'Admin · Coupons' };
export const dynamic = 'force-dynamic';

export default async function CouponsPage() {
  const restaurant = await requireRestaurant();
  const branches = await prisma.branch.findMany({
    where: { restaurantId: restaurant.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, isActive: true }
  });
  const branchIds = branches.map((b) => b.id);
  const coupons = await prisma.coupon.findMany({
    where: { branchId: { in: branchIds } },
    orderBy: { createdAt: 'desc' }
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <header>
        <h1 className="display text-3xl font-semibold">Coupons</h1>
        <p className="text-sm text-muted-foreground mt-1">Create promo codes for {restaurant.name}. Coupons attach to a branch and apply at checkout.</p>
      </header>
      <CouponsClient
        coupons={JSON.parse(JSON.stringify(coupons))}
        branches={branches}
      />
    </div>
  );
}
