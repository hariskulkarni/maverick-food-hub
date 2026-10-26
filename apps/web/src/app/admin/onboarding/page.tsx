/**
 * /admin/onboarding — "Get your restaurant live" guided setup.
 *
 * Server component: loads everything the steps need from the real tables
 * (restaurant, branches + hours + zones, menu stats, team, integration
 * statuses, QR) plus persisted progress and live readiness, then hands one
 * serialisable object to the client wizard. Every step writes through the
 * existing admin APIs; router.refresh() re-runs this loader afterwards.
 */
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { parseStorefrontConfig } from '@/server/storefront-cms';
import { listForRestaurant } from '@/server/integrations';
import { getOnboardingState } from '@/server/onboarding';
import { isStepKey } from '@/lib/onboarding/steps';
import { OnboardingWizard } from './wizard-client';
import type { OnboardingData } from './types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin · Get your restaurant live' };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const restaurant = await requireRestaurant();
  const { step } = await searchParams;

  const [branches, items, categories, members, integrations, qr, state] = await Promise.all([
    prisma.branch.findMany({
      where: { restaurantId: restaurant.id },
      orderBy: { createdAt: 'asc' },
      include: { hours: { orderBy: { dayOfWeek: 'asc' } }, deliveryZones: { orderBy: { priority: 'asc' } } },
    }),
    prisma.menuItem.findMany({
      where: { branch: { restaurantId: restaurant.id, isActive: true } },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { name: true, description: true, price: true, isVeg: true, imageUrl: true, isAvailable: true, category: { select: { name: true } } },
    }),
    prisma.category.findMany({
      where: { branch: { restaurantId: restaurant.id, isActive: true } },
      orderBy: { sortOrder: 'asc' },
      select: { name: true },
    }),
    prisma.restaurantUser.findMany({
      where: { restaurantId: restaurant.id },
      orderBy: { createdAt: 'asc' },
      select: { role: true, user: { select: { id: true, name: true, email: true } } },
    }),
    listForRestaurant(restaurant.id),
    prisma.qrCode.findFirst({ where: { restaurantId: restaurant.id, type: 'RESTAURANT', isActive: true }, orderBy: { createdAt: 'asc' }, select: { code: true } }),
    getOnboardingState(restaurant.id),
  ]);
  const [itemCount, availableCount] = await Promise.all([
    prisma.menuItem.count({ where: { branch: { restaurantId: restaurant.id, isActive: true } } }),
    prisma.menuItem.count({ where: { branch: { restaurantId: restaurant.id, isActive: true }, isAvailable: true, price: { gt: 0 }, category: { isActive: true } } }),
  ]);

  const data: OnboardingData = {
    restaurant: {
      id: restaurant.id, slug: restaurant.slug, name: restaurant.name, status: restaurant.status,
      tagline: restaurant.tagline, description: restaurant.description, cuisine: restaurant.cuisine,
      contactEmail: restaurant.contactEmail, contactPhone: restaurant.contactPhone,
      logoUrl: restaurant.logoUrl, coverImageUrl: restaurant.coverImageUrl,
      legalName: restaurant.legalName, gstin: restaurant.gstin, pan: restaurant.pan,
      commissionPct: restaurant.commissionPct, paymentFeePct: restaurant.paymentFeePct, settlementCycle: restaurant.settlementCycle,
    },
    storefront: parseStorefrontConfig(restaurant.storefrontConfig),
    branches: branches.map((b) => ({
      id: b.id, name: b.name, isActive: b.isActive,
      line1: b.line1, city: b.city, state: b.state, postalCode: b.postalCode, phone: b.phone,
      latitude: b.latitude, longitude: b.longitude, serviceRadiusKm: b.serviceRadiusKm,
      baseDeliveryFee: Number(b.baseDeliveryFee), perKmDeliveryFee: Number(b.perKmDeliveryFee),
      fssaiLicenseNumber: b.fssaiLicenseNumber, fssaiLicenseType: b.fssaiLicenseType,
      fssaiExpiresOn: b.fssaiExpiresOn?.toISOString() ?? null, fssaiLicenseImageUrl: b.fssaiLicenseImageUrl,
      hours: b.hours.map((h) => ({ dayOfWeek: h.dayOfWeek, openMin: h.openMin, closeMin: h.closeMin })),
      zones: b.deliveryZones.map((z) => ({
        id: z.id, name: z.name, type: z.type, radiusKm: z.radiusKm, isActive: z.isActive,
        feeBrackets: z.feeBrackets, distanceTiers: z.distanceTiers,
        minOrder: z.minOrder == null ? null : Number(z.minOrder), etaMinutes: z.etaMinutes,
      })),
    })),
    menu: {
      categories: [...new Set(categories.map((c) => c.name))],
      itemCount,
      availableCount,
      recent: items.map((i) => ({
        name: i.name, description: i.description, price: Number(i.price), isVeg: i.isVeg,
        imageUrl: i.imageUrl, category: i.category.name, isAvailable: i.isAvailable,
      })),
    },
    staff: members.map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email, role: m.role, isOwner: m.user.id === restaurant.ownerUserId })),
    integrations: integrations.map((i) => ({ provider: i.provider, title: i.title, status: i.status })),
    qrCode: qr?.code ?? null,
    progress: state.progress,
    readiness: state.readiness,
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl">
      <OnboardingWizard data={JSON.parse(JSON.stringify(data))} initialStep={isStepKey(step) ? step : data.progress.currentStep} />
    </div>
  );
}
