import { prisma } from '@/server/db';
import { RiderSignupForm } from './form';

export const metadata = { title: 'Become a rider' };

export default async function RiderSignupPage() {
  // Restaurants are an OPTIONAL hint ("I'd like to ride for them") — riders are platform-pool now.
  const restaurants = await prisma.restaurant.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true, cuisine: true }
  });
  return (
    <div className="container py-12 max-w-xl">
      <div className="text-xs font-semibold uppercase tracking-wider text-primary">For riders</div>
      <h1 className="display text-3xl font-semibold mb-2">Earn on FoodHub</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Once approved by the FoodHub team, you'll see every restaurant's READY orders in a single pool —
        pick whichever fits your route. Tips, peak-hour bonuses, and rain-day bonuses are paid on top.
      </p>
      <RiderSignupForm restaurants={JSON.parse(JSON.stringify(restaurants))} />
    </div>
  );
}
