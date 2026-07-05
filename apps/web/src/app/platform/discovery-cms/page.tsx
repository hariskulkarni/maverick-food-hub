import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { log } from '@/server/log';
import { getDiscoveryConfig } from '@/server/discovery-cms';
import { DiscoveryCmsEditor } from './discovery-cms-editor';
import { can } from '@/server/permissions';

export const metadata = { title: 'Platform · Discovery CMS' };
export const dynamic = 'force-dynamic';

/**
 * Super-admin CMS for the public discovery page (`/restaurants`). Granular,
 * section-by-section control of the carousel, Top offers strip, "What's on your
 * mind" tiles, "Restaurants near you" header + featured pins, the site footer,
 * and SEO. Persists to SiteContent[key=discovery] via /api/platform/discovery-cms.
 */
export default async function DiscoveryCmsPage() {
  const session = await auth();
  if (!session?.user || !can(session.user.role, 'cms:read')) {
    redirect('/login?next=/platform/discovery-cms&mode=admin');
  }

  const config = await getDiscoveryConfig();

  // Pickers — populate the dropdowns the super-admin uses to pin offers and
  // feature restaurants.
  //
  // The offers picker INTENTIONALLY does not filter by validity/active state.
  // The previous narrow query (`isActive AND validFrom <= now AND validTo > now`)
  // hid every paused or scheduled offer, which made it impossible to pin a
  // promotion that's set to launch tomorrow or one that's temporarily paused.
  // We now return every offer + a derived lifecycle label so the editor can
  // group them (Active / Scheduled / Paused / Expired) and show the restaurant
  // scope alongside each. The storefront still independently filters by date
  // and active flag at render time — pinning a paused offer just keeps the
  // pin "warm" until someone reactivates it.
  let rawOffers: any[] = [];
  try {
    rawOffers = await (prisma as any).offer.findMany({
      orderBy: [{ isActive: 'desc' }, { priority: 'desc' }, { createdAt: 'desc' }],
      take: 500,
      select: {
        id: true,
        name: true,
        code: true,
        type: true,
        isActive: true,
        validFrom: true,
        validTo: true,
        restaurantId: true,
        restaurant: { select: { name: true } },
      },
    });
  } catch (e) {
    // Don't silently swallow — the empty picker would otherwise be
    // indistinguishable from "no offers in the DB", which is exactly the
    // confusion the user reported.
    log.error({ err: e }, 'discovery-cms: failed to list offers for picker');
  }

  const restaurants = await prisma.restaurant.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, cuisine: true },
    take: 500,
  });

  const now = new Date();
  type Lifecycle = 'active' | 'scheduled' | 'paused' | 'expired';
  const lifecycleOf = (o: any): Lifecycle => {
    if (!o.isActive) return 'paused';
    if (o.validFrom && new Date(o.validFrom) > now) return 'scheduled';
    if (o.validTo && new Date(o.validTo) <= now) return 'expired';
    return 'active';
  };

  const offers = rawOffers.map((o: any) => ({
    id: o.id,
    name: o.name as string,
    code: (o.code ?? null) as string | null,
    type: o.type as string,
    lifecycle: lifecycleOf(o),
    scope: (o.restaurantId
      ? (o.restaurant?.name ?? 'Restaurant-scoped')
      : 'Platform-wide') as string,
  }));

  return (
    <div className="p-6 max-w-5xl">
      <header className="mb-6">
        <h1 className="display text-3xl font-semibold">Discovery CMS</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Control every section of the public discovery page (<code>/restaurants</code>) — carousel,
          offers, categories, the restaurants header, footer and SEO. Changes go live immediately.
        </p>
      </header>
      <DiscoveryCmsEditor
        initial={config}
        offers={offers}
        restaurants={restaurants.map((r) => ({ id: r.id, name: r.name, cuisine: r.cuisine }))}
      />
    </div>
  );
}
