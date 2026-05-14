/**
 * Super-admin: create a new restaurant tenant from scratch.
 *
 * Server component — gates on SUPER_ADMIN, loads the brand picker options and
 * any "unowned ADMIN users" the wizard might want to attach as the owner (so
 * the super-admin can re-use an existing admin instead of always minting a new
 * one). All of that is serialised to JSON and handed to the client wizard.
 */
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { WizardClient } from './wizard-client';

export const metadata = { title: 'Platform · New restaurant' };
export const dynamic = 'force-dynamic';

export default async function NewRestaurantPage() {
  await requireSuperAdmin();

  // Brands the super-admin can attach this restaurant to.
  const brandsRaw: { id: string; name: string; slug: string; tagline: string | null }[] =
    await (prisma as any).brand.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true, tagline: true }
    });

  // "Unowned" ADMIN users — registered admins who currently don't own any
  // restaurant. Useful when re-onboarding a chain whose admin account already
  // exists. Optional input on the wizard.
  const unownedAdminsRaw = await prisma.user.findMany({
    where: { role: 'ADMIN', ownedRestaurants: { none: {} } },
    select: { id: true, email: true, name: true },
    orderBy: { createdAt: 'desc' },
    take: 50
  });

  const defaults = {
    commissionPct: Number(process.env.NEXT_PUBLIC_DEFAULT_COMMISSION_PCT ?? 15) || 15,
    country: 'IN',
    serviceRadiusKm: 7,
    taxRatePct: 5,
    baseDeliveryFee: 40,
    perKmDeliveryFee: 8
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <WizardClient
        brands={JSON.parse(JSON.stringify(brandsRaw))}
        unownedAdmins={JSON.parse(JSON.stringify(unownedAdminsRaw))}
        defaults={defaults}
      />
    </div>
  );
}
