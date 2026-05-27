import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { getDiscoveryConfig } from '@/server/discovery-cms';
import { DiscoveryCmsEditor } from './discovery-cms-editor';

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
  if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
    redirect('/login?next=/platform/discovery-cms&mode=admin');
  }

  const config = await getDiscoveryConfig();

  // Pickers: active offers (to pin) + active restaurants (to feature).
  const now = new Date();
  const [rawOffers, restaurants] = await Promise.all([
    (prisma as any).offer
      .findMany({
        where: { isActive: true, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        take: 100,
        select: { id: true, name: true, code: true, type: true },
      })
      .catch(() => []),
    prisma.restaurant.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, cuisine: true },
      take: 300,
    }),
  ]);

  const offers = (rawOffers as any[]).map((o) => ({
    id: o.id,
    name: o.name as string,
    code: (o.code ?? null) as string | null,
    type: o.type as string,
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
