import Link from 'next/link';
import { prisma } from '@/server/db';
import { auth } from '@/server/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChefHat, Clock, MapPin, Star, ArrowUpDown, Navigation, Sparkles, Percent, Tag, Gift } from 'lucide-react';
import { FOOD_FALLBACK } from '@/lib/food-images';
import { ImageWithFallback } from '@/components/image-with-fallback';
import { readDeliveryLocation } from '@/server/discovery';
import { filterNearbyRestaurants } from '@/server/discovery';
import { getDiscoveryRadiusKm } from '@/server/platform-settings';
import { DeliverToHeader } from './deliver-to-header';
import { ChangeLocationButton } from './change-location-button';
import type { SavedAddressOption } from './location-picker-dialog';
import { FeatureCarousel } from '@/components/landing/feature-carousel';
import { WhatsOnYourMind } from '@/components/discovery/whats-on-your-mind';
import { getDiscoveryConfig } from '@/server/discovery-cms';
import type { Metadata } from 'next';

// SEO is super-admin editable (/platform/discovery-cms → SEO tab).
export async function generateMetadata(): Promise<Metadata> {
  const cfg = await getDiscoveryConfig();
  const title = cfg.seo.metaTitle || 'All restaurants';
  const description = cfg.seo.metaDescription || undefined;
  return {
    title,
    description,
    keywords: cfg.seo.keywords ? cfg.seo.keywords.split(',').map((k) => k.trim()).filter(Boolean) : undefined,
    openGraph: {
      title,
      description,
      images: cfg.seo.ogImage ? [cfg.seo.ogImage] : undefined,
    },
  };
}

// Discovery is per-customer (location cookie) — never cache the render.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type SortKey = 'newest' | 'name';

interface SearchParams {
  cuisine?: string;
  sort?: string;
  q?: string;
}

/** Format a distance in metres as a short human string ("0.4 km", "2.3 km"). */
function formatDistance(distanceM: number): string {
  const km = distanceM / 1000;
  if (km < 1) return `${Math.max(0.1, Math.round(km * 10) / 10).toFixed(1)} km`;
  return `${(Math.round(km * 10) / 10).toFixed(1)} km`;
}

type TopOffer = { id: string; name: string; type: string; code: string | null; percentOff: number | null; flatOff: number | null };

/** Short headline value for a "Top offers today" tile. */
function offerValue(o: TopOffer): string {
  if (o.percentOff && o.percentOff > 0) return `${o.percentOff}% OFF`;
  if (o.flatOff && o.flatOff > 0) return `₹${o.flatOff} OFF`;
  if (o.type === 'BUY_X_GET_Y') return 'Buy 1 Get 1';
  if (o.type === 'FREE_ITEM_ABOVE') return 'Free item';
  if (o.type === 'COMBO_DISCOUNT') return 'Combo deal';
  return 'Special offer';
}

function offerIcon(o: TopOffer) {
  if (o.percentOff && o.percentOff > 0) return Percent;
  if (o.type === 'BUY_X_GET_Y' || o.type === 'FREE_ITEM_ABOVE' || o.type === 'COMBO_DISCOUNT') return Gift;
  return Tag;
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
  // Super-admin CMS config for this page (carousel, sections, SEO, footer…).
  const cms = await getDiscoveryConfig();

  const sp = (await searchParams) ?? {};
  const selectedCuisine = typeof sp.cuisine === 'string' && sp.cuisine.length > 0 ? sp.cuisine : null;
  // Default sort comes from the CMS unless the customer explicitly chose one.
  const sort: SortKey = sp.sort === 'name' ? 'name' : sp.sort === 'newest' ? 'newest' : cms.restaurantsNearby.defaultSort;
  const query = typeof sp.q === 'string' ? sp.q.trim() : '';
  const queryLower = query.toLowerCase();

  const now = new Date();
  const offerLimit = cms.topOffers.limit;
  const pinnedOfferIds = cms.topOffers.pinnedOfferIds;
  const offerWhere = { isActive: true, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] };
  const [active, radiusKm, rawOffers, rawPinned] = await Promise.all([
    prisma.restaurant.findMany({
      where: { status: 'ACTIVE' },
      include: {
        branches: { select: { id: true, latitude: true, longitude: true, serviceRadiusKm: true, city: true } },
        _count: { select: { branches: true } }
      }
    }),
    getDiscoveryRadiusKm(),
    // Active offers across the platform (platform-wide + per-restaurant), most
    // prominent first — powers the "Top offers today" strip.
    (prisma as any).offer.findMany({
      where: offerWhere,
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: offerLimit + pinnedOfferIds.length
    }).catch(() => []),
    // Explicitly fetch the admin-pinned offers (still active) so they appear even
    // if their priority would push them out of the top set.
    pinnedOfferIds.length
      ? (prisma as any).offer.findMany({ where: { ...offerWhere, id: { in: pinnedOfferIds } } }).catch(() => [])
      : Promise.resolve([])
  ]);

  const toTopOffer = (o: any): TopOffer => ({
    id: o.id,
    name: o.name,
    type: o.type,
    code: o.code ?? null,
    percentOff: o.percentOff ?? null,
    flatOff: o.flatOff != null ? Number(o.flatOff) : null
  });
  // Merge fetched + pinned, dedupe, then order: pinned (in admin order) first.
  const offerById = new Map<string, TopOffer>();
  for (const o of [...(rawOffers as any[]), ...(rawPinned as any[])]) offerById.set(o.id, toTopOffer(o));
  const pinnedFirst = pinnedOfferIds.map((id) => offerById.get(id)).filter((o): o is TopOffer => !!o);
  const pinnedSet = new Set(pinnedOfferIds);
  const restOffers = (rawOffers as any[]).map(toTopOffer).filter((o) => !pinnedSet.has(o.id));
  const topOffers: TopOffer[] = [...pinnedFirst, ...restOffers].slice(0, offerLimit);

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

  // ── Text search (?q=) ──────────────────────────────────────────────────────
  // Matches a restaurant by its name/tagline/cuisine OR by a DISH it serves
  // (so "biryani" surfaces every restaurant with a biryani on the menu, not just
  // ones literally named that). Dish matching is a best-effort DB lookup.
  let searchMatches = matches;
  if (query) {
    let dishRestaurantIds = new Set<string>();
    try {
      const items = await prisma.menuItem.findMany({
        where: {
          isAvailable: true,
          name: { contains: query, mode: 'insensitive' },
          branch: { restaurant: { status: 'ACTIVE' } }
        },
        select: { branch: { select: { restaurantId: true } } },
        take: 500
      });
      dishRestaurantIds = new Set(items.map((it) => it.branch.restaurantId));
    } catch {
      /* dish search is best-effort — fall back to name/cuisine matching only */
    }
    searchMatches = matches.filter((m) => {
      const r = m.restaurant;
      const hay = `${r.name} ${r.tagline ?? ''} ${r.cuisine ?? ''}`.toLowerCase();
      return hay.includes(queryLower) || dishRestaurantIds.has(r.id);
    });
  }

  // Apply cuisine filter (preserving nearest-first order).
  const filteredMatches = selectedCuisine
    ? searchMatches.filter((m) => m.restaurant.cuisine === selectedCuisine)
    : searchMatches;

  // Apply sort. "newest" keeps the discovery (nearest-first) order, which is the
  // most useful default for location-based browsing; "name" sorts alphabetically.
  const sortedMatches =
    sort === 'name'
      ? [...filteredMatches].sort((a, b) => a.restaurant.name.localeCompare(b.restaurant.name))
      : filteredMatches;

  // Admin-pinned "featured" restaurants float to the top (in configured order),
  // keeping the rest in their sorted order. Only pins that survive the current
  // location/cuisine/search filters appear.
  const featuredIds = cms.restaurantsNearby.featuredRestaurantIds;
  const finalMatches = (() => {
    if (!featuredIds.length) return sortedMatches;
    const fset = new Set(featuredIds);
    const feat = featuredIds
      .map((id) => sortedMatches.find((m) => m.restaurant.id === id))
      .filter((m): m is (typeof sortedMatches)[number] => !!m);
    const others = sortedMatches.filter((m) => !fset.has(m.restaurant.id));
    return [...feat, ...others];
  })();

  // Serialize for the cards (Decimal-free: only the geo fields we used, dropped here).
  const cards = finalMatches.map((m) => {
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
    if (query) params.set('q', query);
    const qs = params.toString();
    return qs ? `/restaurants?${qs}` : '/restaurants';
  };

  const sortHref = (next: SortKey) => {
    const params = new URLSearchParams();
    if (selectedCuisine) params.set('cuisine', selectedCuisine);
    if (next !== 'newest') params.set('sort', next);
    if (query) params.set('q', query);
    const qs = params.toString();
    return qs ? `/restaurants?${qs}` : '/restaurants';
  };

  // Same filters minus the search query — used by the "clear" search link.
  const clearSearchHref = (() => {
    const params = new URLSearchParams();
    if (selectedCuisine) params.set('cuisine', selectedCuisine);
    if (sort !== 'newest') params.set('sort', sort);
    const qs = params.toString();
    return qs ? `/restaurants?${qs}` : '/restaurants';
  })();

  return (
    <>
      {/* ─── Full-bleed promo carousel — spans the viewport on mobile (native-app
          feel), contained card on desktop. Lives OUTSIDE the container. Slides,
          autoplay + visibility are CMS-driven (/platform/discovery-cms). ─── */}
      {cms.carousel.enabled && (
        <FeatureCarousel
          slides={cms.carousel.slides
            .filter((s) => s.enabled)
            .map((s) => ({
              src: s.src,
              alt: s.alt,
              fallback: s.fallback,
              href: s.href || undefined,
              eyebrow: s.eyebrow || undefined,
              headline: s.headline || undefined,
              subtext: s.subtext || undefined,
              ctaLabel: s.ctaLabel || undefined,
              ctaHref: s.ctaHref || undefined,
              ctaStyle: s.ctaStyle,
            }))}
          autoplayMs={cms.carousel.autoplayMs}
        />
      )}

      <div className="container pt-4 md:pt-6 pb-6 md:pb-8">
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

      {/* ───────────────────────── Top offers today ───────────────────────── */}
      {cms.topOffers.enabled && topOffers.length > 0 && (
        <section className="mb-6 reveal">
          <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
            <Sparkles className="size-3.5" /> {cms.topOffers.heading}
          </div>
          {cms.topOffers.subheading && (
            <p className="-mt-2 mb-3 text-sm text-muted-foreground">{cms.topOffers.subheading}</p>
          )}
          <div className="-mx-4 md:mx-0 overflow-x-auto no-scrollbar">
            <div className="flex gap-3 px-4 md:px-0">
              {topOffers.map((o) => {
                const Icon = offerIcon(o);
                return (
                  <div key={o.id} className="shrink-0 w-44 rounded-2xl border bg-card p-4 card-lift">
                    <div className="grid size-9 place-items-center rounded-full bg-primary/10 text-primary">
                      <Icon className="size-4" />
                    </div>
                    <div className="display mt-2 text-lg font-bold leading-none">{offerValue(o)}</div>
                    <div className="mt-1 truncate text-xs font-medium text-foreground">{o.name}</div>
                    {o.code ? (
                      <div className="mt-2 inline-block rounded-md border border-dashed border-primary/40 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider text-primary">
                        {o.code}
                      </div>
                    ) : (
                      <div className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                        <Sparkles className="size-3" /> Auto-applied
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ─────── What's on your mind? — cross-restaurant food categories ─────── */}
      {cms.whatsOnYourMind.enabled && (
        <WhatsOnYourMind
          heading={cms.whatsOnYourMind.heading}
          tiles={cms.whatsOnYourMind.tiles
            .filter((t) => t.enabled)
            .map((t) => ({ slug: t.slug, label: t.label, image: t.image, alt: t.alt }))}
        />
      )}

      {cms.restaurantsNearby.enabled && (
      <header className="mb-4 md:mb-6 reveal">
        <div className="text-xs font-semibold uppercase tracking-wider text-primary">{cms.restaurantsNearby.eyebrow}</div>
        <h1 className="display text-xl md:text-2xl lg:text-3xl font-semibold">{cms.restaurantsNearby.heading}</h1>
        {cms.restaurantsNearby.subheading ? (
          <p className="mt-2 text-sm text-muted-foreground">{cms.restaurantsNearby.subheading}</p>
        ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          {query ? (
            <>
              {cards.length} {cards.length === 1 ? 'result' : 'results'} for{' '}
              <span className="font-semibold text-foreground">&ldquo;{query}&rdquo;</span>
              {' · '}
              <Link href={clearSearchHref} className="text-primary underline">
                clear
              </Link>
            </>
          ) : (
            <>
              {selectedCuisine ? (
                <>
                  <span className="font-semibold text-foreground">{selectedCuisine}</span>
                  {' · '}
                </>
              ) : null}
              Sorted by{' '}
              <span className="font-semibold text-foreground">{sort === 'name' ? 'name' : 'nearest'}</span>
            </>
          )}
        </p>
        )}
      </header>
      )}

      {/* ─── Sticky toolbar: search (mobile) + cuisine chips as ONE unit ───
          Both move together and stick directly beneath the global header
          (h-12 mobile / h-16 desktop) at z-30 — below the header's z-40 but
          above page content — so the chips can never tuck under the search.
          Full-bleed on mobile with a near-opaque backdrop so cards scroll
          cleanly behind it (native-app sticky-header feel). */}
      <div className="sticky top-12 md:top-16 z-30 -mx-4 md:mx-0 mb-6 md:mb-8 border-b md:border-0 bg-background/95 backdrop-blur md:bg-transparent md:backdrop-blur-none">
        {/* Search — restaurants + dishes. Preserves the active cuisine/sort so a
            search doesn't silently reset other filters. */}
        <form action="/restaurants" method="get" className="px-4 md:px-0 pt-2.5 pb-1.5 md:pt-3">
          {selectedCuisine && <input type="hidden" name="cuisine" value={selectedCuisine} />}
          {sort !== 'newest' && <input type="hidden" name="sort" value={sort} />}
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search restaurants or dishes…"
            className="h-10 w-full rounded-full border border-input bg-card px-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary md:max-w-md"
            aria-label="Search restaurants or dishes"
          />
        </form>

        {/* Cuisine chips + sort — horizontally scrollable on mobile. */}
        <div className="flex md:flex-wrap items-center gap-2 overflow-x-auto md:overflow-visible no-scrollbar px-4 md:px-0 pb-2.5 pt-1 md:py-0">
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
          ) : query ? (
            <p className="text-muted-foreground">
              No restaurants or dishes match{' '}
              <span className="font-semibold text-foreground">&ldquo;{query}&rdquo;</span>.{' '}
              <Link href={clearSearchHref} className="text-primary underline">
                Clear search
              </Link>
              .
            </p>
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
                <ImageWithFallback
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
    </>
  );
}
