import Link from 'next/link';
import Image from 'next/image';
import { prisma } from '@/server/db';
import { auth } from '@/server/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChefHat, Clock, MapPin, Star, ArrowUpDown, Navigation } from 'lucide-react';
import { FOOD_FALLBACK } from '@/lib/food-images';
import { readDeliveryLocation } from '@/server/discovery';
import { filterNearbyRestaurants } from '@/server/discovery';
import { getDiscoveryRadiusKm } from '@/server/platform-settings';
import { DeliverToHeader } from './deliver-to-header';
import { ChangeLocationButton } from './change-location-button';
import type { SavedAddressOption } from './location-picker-dialog';

export const metadata = { title: 'All restaurants' };

// Discovery is per-customer (location cookie) — never cache the render.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type SortKey = 'newest' | 'name';

interface SearchParams {
  cuisine?: string;
  sort?: string;
}

/** Format a distance in metres as a short human string ("0.4 km", "2.3 km"). */
function formatDistance(distanceM: number): string {
  const km = distanceM / 1000;
  if (km < 1) return `${Math.max(0.1, Math.round(km * 10) / 10).toFixed(1)} km`;
  return `${(Math.round(km * 10) / 10).toFixed(1)} km`;
}

/**
 * Marketplace directory — location-gated discovery.
 *
 * Gate vs list:
 *   - No location cookie  → render the LocationGate (no list at all).
 *   - Location set        → load active restaurants + their branch geo, filter
 *                           to the ones that can deliver here, and render the
 *                           nearby set with cuisine chips + sort applied to it.
 */
export default async function RestaurantsListPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const loc = await readDeliveryLocation();

  // Saved addresses are a quick-pick option in the picker (logged-in users with
  // geocoded addresses only). Serialized to plain numbers for the client.
  let savedAddresses: SavedAddressOption[] = [];
  const session = await auth();
  if (session?.user) {
    const rows = await prisma.address.findMany({
      where: { userId: session.user.id, latitude: { not: null }, longitude: { not: null } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, label: true, line1: true, city: true, latitude: true, longitude: true }
    });
    savedAddresses = rows
      .filter((a) => a.latitude != null && a.longitude != null)
      .map((a) => ({
        id: a.id,
        label: a.label,
        line1: a.line1,
        city: a.city,
        latitude: a.latitude as number,
        longitude: a.longitude as number
      }));
  }

  // ── Discover restaurants ───────────────────────────────────────────────────
  // With a location we filter to deliverable + nearest-first. WITHOUT one we do
  // NOT block: browser geolocation is unavailable on insecure (http) origins and
  // not every customer grants it, so we show ALL active restaurants and let them
  // set a location any time for delivery estimates + nearby filtering. (The old
  // hard gate trapped customers who couldn't share their location.)
  const sp = (await searchParams) ?? {};
  const selectedCuisine = typeof sp.cuisine === 'string' && sp.cuisine.length > 0 ? sp.cuisine : null;
  const sort: SortKey = sp.sort === 'name' ? 'name' : 'newest';

  const [active, radiusKm] = await Promise.all([
    prisma.restaurant.findMany({
      where: { status: 'ACTIVE' },
      include: {
        branches: { select: { id: true, latitude: true, longitude: true, serviceRadiusKm: true, city: true } },
        _count: { select: { branches: true } }
      }
    }),
    getDiscoveryRadiusKm()
  ]);

  const matches: { restaurant: (typeof active)[number]; distanceM: number | null }[] = loc
    ? filterNearbyRestaurants(loc, radiusKm, active).map((m) => ({ restaurant: m.restaurant, distanceM: m.distanceM }))
    : active.map((restaurant) => ({ restaurant, distanceM: null }));

  // Cuisine chips + counts are built from the NEARBY set (not the whole platform).
  const cuisineCounts = new Map<string, number>();
  for (const m of matches) {
    const c = m.restaurant.cuisine;
    if (!c) continue;
    cuisineCounts.set(c, (cuisineCounts.get(c) ?? 0) + 1);
  }
  const cuisines = Array.from(cuisineCounts.entries()).sort((a, b) => b[1] - a[1]);

  // Apply cuisine filter (preserving nearest-first order).
  const filteredMatches = selectedCuisine
    ? matches.filter((m) => m.restaurant.cuisine === selectedCuisine)
    : matches;

  // Apply sort. "newest" keeps the discovery (nearest-first) order, which is the
  // most useful default for location-based browsing; "name" sorts alphabetically.
  const sortedMatches =
    sort === 'name'
      ? [...filteredMatches].sort((a, b) => a.restaurant.name.localeCompare(b.restaurant.name))
      : filteredMatches;

  // Serialize for the cards (Decimal-free: only the geo fields we used, dropped here).
  const cards = sortedMatches.map((m) => {
    const r = m.restaurant;
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      tagline: r.tagline,
      cuisine: r.cuisine,
      coverImageUrl: r.coverImageUrl,
      logoUrl: r.logoUrl,
      branchCount: r._count.branches,
      distanceLabel: m.distanceM != null ? formatDistance(m.distanceM) : null,
      ratingTenth: (r.id.charCodeAt(0) % 5) + 4
    };
  });

  const chipHref = (cuisine: string | null) => {
    const params = new URLSearchParams();
    if (cuisine) params.set('cuisine', cuisine);
    if (sort !== 'newest') params.set('sort', sort);
    const q = params.toString();
    return q ? `/restaurants?${q}` : '/restaurants';
  };

  const sortHref = (next: SortKey) => {
    const params = new URLSearchParams();
    if (selectedCuisine) params.set('cuisine', selectedCuisine);
    if (next !== 'newest') params.set('sort', next);
    const q = params.toString();
    return q ? `/restaurants?${q}` : '/restaurants';
  };

  return (
    <div className="container py-6 md:py-8">
      {/* Deliver-to header (location set) OR a non-blocking prompt to set one. */}
      <div className="mb-4 reveal">
        {loc ? (
          <DeliverToHeader label={loc.label} savedAddresses={savedAddresses} />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed bg-muted/30 p-3">
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="size-4 text-primary" />
              Showing all restaurants. Set your delivery location for accurate delivery estimates &amp; nearby filtering.
            </span>
            <ChangeLocationButton savedAddresses={savedAddresses} />
          </div>
        )}
      </div>

      <header className="mb-4 md:mb-6 reveal">
        <div className="text-xs font-semibold uppercase tracking-wider text-primary">Restaurants near you</div>
        <h1 className="display text-xl md:text-2xl lg:text-3xl font-semibold">Pick what you&apos;re hungry for</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {selectedCuisine ? (
            <>
              <span className="font-semibold text-foreground">{selectedCuisine}</span>
              {' · '}
            </>
          ) : null}
          Sorted by{' '}
          <span className="font-semibold text-foreground">{sort === 'name' ? 'name' : 'nearest'}</span>
        </p>
      </header>

      {/* Sticky search-like header (mobile only). */}
      <div className="sticky top-12 md:top-16 z-20 -mx-4 md:mx-0 px-4 md:px-0 py-2 md:py-0 mb-3 bg-background/85 backdrop-blur md:bg-transparent md:backdrop-blur-none border-b md:border-0">
        <form action="/restaurants" method="get" className="md:hidden">
          {selectedCuisine && <input type="hidden" name="cuisine" value={selectedCuisine} />}
          <input
            type="search"
            name="q"
            placeholder="Search restaurants, cuisines…"
            className="h-10 w-full rounded-full border border-input bg-card px-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary"
            aria-label="Search restaurants"
          />
        </form>
      </div>

      {/* Filter chip row. */}
      <div className="sticky top-[88px] md:static z-10 -mx-4 md:mx-0 mb-6 md:mb-8 bg-background/85 md:bg-transparent backdrop-blur md:backdrop-blur-none">
        <div className="flex md:flex-wrap items-center gap-2 overflow-x-auto md:overflow-visible no-scrollbar px-4 md:px-0 py-2 md:py-0">
          <Link
            href={chipHref(null)}
            className={`inline-flex h-9 items-center rounded-full border px-3.5 text-xs font-medium transition-colors shrink-0 tap-press ${
              selectedCuisine === null
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card hover:border-primary/40 hover:text-foreground text-muted-foreground'
            }`}
          >
            All ({matches.length})
          </Link>
          {cuisines.map(([c, count]) => {
            const active = selectedCuisine === c;
            return (
              <Link
                key={c}
                href={chipHref(c)}
                className={`inline-flex h-9 items-center rounded-full border px-3.5 text-xs font-medium transition-colors shrink-0 tap-press ${
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card hover:border-primary/40 hover:text-foreground text-muted-foreground'
                }`}
              >
                {c} ({count})
              </Link>
            );
          })}

          {/* Sort group. */}
          <div className="ml-auto hidden md:inline-flex items-center gap-1 text-xs">
            <ArrowUpDown className="size-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Sort:</span>
            <Link
              href={sortHref('newest')}
              className={`rounded-md px-2 py-1 ${sort === 'newest' ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Nearest
            </Link>
            <Link
              href={sortHref('name')}
              className={`rounded-md px-2 py-1 ${sort === 'name' ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Name
            </Link>
          </div>
        </div>
      </div>

      {cards.length === 0 && (
        <div className="rounded-xl border border-dashed bg-muted/30 p-10 text-center">
          {matches.length === 0 ? (
            <>
              <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
                <MapPin className="size-6" />
              </div>
              <p className="font-medium">No restaurants deliver to this location yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Try a different spot or widen later.
              </p>
              <ChangeLocationButton savedAddresses={savedAddresses} />
            </>
          ) : (
            <p className="text-muted-foreground">
              No nearby restaurants match this filter.{' '}
              <Link href={chipHref(null)} className="text-primary underline">
                Clear filters
              </Link>
              .
            </p>
          )}
        </div>
      )}

      {/* Responsive grid: 1 / 2 / 3 / 4 cols. */}
      <div className="grid gap-4 md:gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 reveal-stagger">
        {cards.map((r) => (
          <Link key={r.id} href={`/r/${r.slug}`} className="group block tap-press">
            <Card className="overflow-hidden h-full card-lift rounded-2xl md:rounded-xl">
              <div className="relative aspect-[16/9] md:aspect-[4/3] bg-muted overflow-hidden">
                <Image
                  src={r.coverImageUrl || r.logoUrl || FOOD_FALLBACK}
                  alt={r.name}
                  fill
                  loading="lazy"
                  sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                {r.cuisine && (
                  <Badge variant="muted" className="absolute top-3 left-3 bg-white/95 text-foreground backdrop-blur">
                    {r.cuisine}
                  </Badge>
                )}
                {/* Distance badge from the nearest qualifying branch (only when a location is set). */}
                {r.distanceLabel && (
                  <Badge variant="muted" className="absolute top-3 right-3 bg-white/95 text-foreground backdrop-blur">
                    <Navigation className="size-3" /> {r.distanceLabel}
                  </Badge>
                )}
                <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-white">
                  <div className="flex items-center gap-1 rounded-full bg-black/30 backdrop-blur px-2 py-0.5 text-[11px]">
                    <Clock className="size-3" /> ~35 min
                  </div>
                  <div className="flex items-center gap-1 rounded-full bg-black/30 backdrop-blur px-2 py-0.5 text-[11px]">
                    <Star className="size-3 fill-warning text-warning" /> 4.{r.ratingTenth}
                  </div>
                </div>
              </div>
              <CardContent className="p-4 md:p-5">
                <div className="display text-base md:text-lg font-semibold group-hover:text-primary transition-colors">
                  {r.name}
                </div>
                {r.tagline && <p className="mt-1 text-xs md:text-sm text-muted-foreground line-clamp-2">{r.tagline}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  {r.distanceLabel && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                      <Navigation className="size-3" /> {r.distanceLabel}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                    <Clock className="size-3" /> ~35 min
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                    <Star className="size-3 fill-warning text-warning" /> 4.{r.ratingTenth}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                    <ChefHat className="size-3" />
                    {r.cuisine ?? 'Multi-cuisine'}
                  </span>
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <MapPin className="size-3" />
                    {r.branchCount} {r.branchCount === 1 ? 'branch' : 'branches'}
                  </span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
