import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { CheckoutForm } from './checkout-form';
import { resolveGatewayKey } from '@/server/payments';

export const metadata = { title: 'Checkout' };
// Read addresses live every time — never serve a cached render that could show
// a stale delivery address across devices.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function CheckoutPage({
  searchParams
}: {
  searchParams: Promise<{ branchId?: string; notes?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const session = await auth();
  if (!session?.user?.id) {
    // Preserve the branch (and notes) through the login round-trip so the
    // correct restaurant's offers still apply when the customer returns.
    const params = new URLSearchParams();
    if (sp.branchId) params.set('branchId', sp.branchId);
    if (sp.notes) params.set('notes', sp.notes);
    const qs = params.toString();
    redirect(`/login?next=${encodeURIComponent(`/checkout${qs ? `?${qs}` : ''}`)}`);
  }

  const branchInclude = {
    restaurant: { select: { slug: true, scheduledOrdersEnabled: true, selfPickupEnabled: true, dineInEnabled: true, reservationDiscountPct: true } }
  };
  // Prefer the branch the cart is actually ordering from (passed as ?branchId=).
  // This is what makes offers/coupons resolve to the right restaurant in the
  // multi-tenant marketplace. Fall back to the first active branch for legacy
  // links that don't carry it.
  const branch =
    (sp.branchId
      ? await prisma.branch.findFirst({ where: { id: sp.branchId, isActive: true }, include: branchInclude })
      : null) ??
    (await prisma.branch.findFirstOrThrow({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      include: branchInclude
    }));
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

  // Which online gateway this restaurant is on. Resolved server-side because
  // the browser has no way to know, and it decides both the PaymentMethod the
  // form submits and the label the customer sees. Null (no gateway configured)
  // still renders the online option — it routes to the mock provider in dev.
  const gateway = await resolveGatewayKey(branch.restaurantId);

  return (
    <div className="container py-8">
      <h1 className="display text-2xl font-semibold mb-4">Checkout</h1>
      <CheckoutForm
        branchId={branch.id}
        addresses={JSON.parse(JSON.stringify(addresses))}
        walletBalance={Number(wallet?.balance ?? 0)}
        loyaltyPoints={loyalty?.pointsBalance ?? 0}
        fulfillment={fulfillment}
        gateway={gateway}
      />
    </div>
  );
}
