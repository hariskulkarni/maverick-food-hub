import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { CheckoutForm } from './checkout-form';

export const metadata = { title: 'Checkout' };

export default async function CheckoutPage() {
  const session = await auth();
  if (!session?.user) redirect('/login?next=/checkout');

  const branch = await prisma.branch.findFirstOrThrow({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    include: { restaurant: { select: { slug: true, scheduledOrdersEnabled: true, selfPickupEnabled: true, dineInEnabled: true, reservationDiscountPct: true } } }
  });
  const addresses = await prisma.address.findMany({ where: { userId: session.user.id }, orderBy: { isDefault: 'desc' } });
  const wallet = await prisma.wallet.findUnique({ where: { userId: session.user.id } });
  const loyalty = await prisma.loyaltyAccount.findUnique({ where: { userId: session.user.id } });

  // Fulfillment context the checkout form needs to render the Delivery /
  // Pickup / Dine-in chooser + the scheduled-order toggle. The restaurant
  // toggles gate which options appear; the branch address backs the pickup
  // location copy; the slug routes the dine-in reservation fetch.
  const fulfillment = {
    restaurantSlug: branch.restaurant.slug,
    branchName: branch.name,
    branchAddress: `${branch.line1}, ${branch.city}${branch.postalCode ? ' ' + branch.postalCode : ''}`,
    scheduledOrdersEnabled: branch.restaurant.scheduledOrdersEnabled,
    selfPickupEnabled: branch.restaurant.selfPickupEnabled,
    dineInEnabled: branch.restaurant.dineInEnabled,
    reservationDiscountPct: branch.restaurant.reservationDiscountPct
  };

  return (
    <div className="container py-8">
      <h1 className="display text-2xl font-semibold mb-4">Checkout</h1>
      <CheckoutForm
        branchId={branch.id}
        addresses={JSON.parse(JSON.stringify(addresses))}
        walletBalance={Number(wallet?.balance ?? 0)}
        loyaltyPoints={loyalty?.pointsBalance ?? 0}
        fulfillment={fulfillment}
      />
    </div>
  );
}
