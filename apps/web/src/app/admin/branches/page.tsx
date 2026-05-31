import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { money } from '@/lib/utils';
import { requireRestaurant } from '@/server/tenancy';
import Link from 'next/link';

export const metadata = { title: 'Admin · Branches' };

export default async function BranchesPage() {
  const restaurant = await requireRestaurant();
  const branches = await prisma.branch.findMany({
    where: { restaurantId: restaurant.id },
    include: { _count: { select: { menuItems: true, orders: true, riders: true } } }
  });
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="display text-2xl font-semibold">My branches</h1>
        <Button asChild><Link href="/admin/branches/new">+ Add branch</Link></Button>
      </div>
      <p className="text-sm text-muted-foreground">Each branch has its own menu, riders, and orders. Open a branch in a new city when you're ready to scale.</p>
      <div className="grid gap-3 md:grid-cols-2">
        {branches.map((b) => (
          <Card key={b.id}><CardContent className="p-5">
            <div className="font-semibold">{b.name}</div>
            <div className="text-sm text-muted-foreground">{b.line1}, {b.city}</div>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <Stat label="Menu items" value={String(b._count.menuItems)} />
              <Stat label="Orders" value={String(b._count.orders)} />
              <Stat label="Riders" value={String(b._count.riders)} />
              <Stat label="Tax" value={`${b.taxRatePct}%`} />
              <Stat label="Base fee" value={money(b.baseDeliveryFee as any)} />
              <Stat label="Per-km" value={money(b.perKmDeliveryFee as any)} />
            </div>
          </CardContent></Card>
        ))}
      </div>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">{label}</div><div className="font-medium">{value}</div></div>;
}
