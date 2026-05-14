import Link from 'next/link';
import Image from 'next/image';
import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChefHat, Clock, MapPin, Star, ArrowUpDown } from 'lucide-react';
import { FOOD_FALLBACK } from '@/lib/food-images';

export const metadata = { title: 'All restaurants' };

type SortKey = 'newest' | 'name';

interface SearchParams {
  cuisine?: string;
  sort?: string;
}

/**
 * Marketplace directory — fully server-rendered.
 *
 * Filtering / sorting is driven by URL params so each filter state is a real
 * URL (good for sharing + back-button). The cuisine chips below the header
 * just re-link to a new URL.
 */
export default async function RestaurantsListPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = (await searchParams) ?? {};
  const selectedCuisine = typeof sp.cuisine === 'string' && sp.cuisine.length > 0 ? sp.cuisine : null;
  const sort: SortKey = sp.sort === 'name' ? 'name' : 'newest';

  // We always pull the full active set so we can build the cuisine chip list
  // and the totals on the same query — this list is short and bounded.
  const all = await prisma.restaurant.findMany({
    where: { status: 'ACTIVE' },
    include: { _count: { select: { branches: true } } },
    orderBy: sort === 'name' ? { name: 'asc' } : { createdAt: 'desc' }
  });

  const cuisineCounts = new Map<string, number>();
  for (const r of all) {
    if (!r.cuisine) continue;
    cuisineCounts.set(r.cuisine, (cuisineCounts.get(r.cuisine) ?? 0) + 1);
  }
  const cuisines = Array.from(cuisineCounts.entries()).sort((a, b) => b[1] - a[1]);

  const filtered = selectedCuisine
    ? all.filter((r) => r.cuisine === selectedCuisine)
    : all;

  // Build chip link targets while preserving the current sort.
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
      <header className="mb-4 md:mb-6 reveal">
        <div className="text-xs font-semibold uppercase tracking-wider text-primary">All restaurants</div>
        <h1 className="display text-xl md:text-2xl lg:text-3xl font-semibold">Pick what you&apos;re hungry for</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Showing <span className="font-semibold text-foreground">{filtered.length}</span>{' '}
          of {all.length} {all.length === 1 ? 'restaurant' : 'restaurants'}
          {selectedCuisine ? <> in <span className="font-semibold text-foreground">{selectedCuisine}</span></> : null}
          {' '}· sorted by{' '}
          <span className="font-semibold text-foreground">{sort === 'name' ? 'name' : 'newest'}</span>
        </p>
      </header>

      {/* Sticky search-like header — full-width rounded-full input on mobile,
          sits just below the top nav. On md+ this becomes a non-sticky
          decorative element above the chip rail. */}
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

      {/* Filter chip row.
          Mobile: horizontal scroll (sticky just under search). Desktop: wraps. */}
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
            All ({all.length})
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

          {/* Sort group — drops to a separate flex-line on mobile via ml-auto +
              the parent's overflow-x-auto. */}
          <div className="ml-auto hidden md:inline-flex items-center gap-1 text-xs">
            <ArrowUpDown className="size-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Sort:</span>
            <Link
              href={sortHref('newest')}
              className={`rounded-md px-2 py-1 ${sort === 'newest' ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Newest
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

      {filtered.length === 0 && (
        <div className="rounded-xl border border-dashed bg-muted/30 p-10 text-center text-muted-foreground">
          {all.length === 0
            ? 'No restaurants are open on the platform yet.'
            : <>No restaurants match this filter. <Link href={chipHref(null)} className="text-primary underline">Clear filters</Link>.</>}
        </div>
      )}

      {/* Responsive grid: 1 / 2 / 3 / 4 cols. Cards: rounded-2xl on mobile
          (chunky reads premium), rounded-xl on desktop. */}
      <div className="grid gap-4 md:gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 reveal-stagger">
        {filtered.map((r) => {
          const ratingTenth = (r.id.charCodeAt(0) % 5) + 4;
          return (
            <Link key={r.id} href={`/r/${r.slug}`} className="group block tap-press">
              <Card className="overflow-hidden h-full card-lift rounded-2xl md:rounded-xl">
                {/* 16:9 on mobile (full-bleed feel), 4:3 on desktop (denser grid) */}
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
                  <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-white">
                    <div className="flex items-center gap-1 rounded-full bg-black/30 backdrop-blur px-2 py-0.5 text-[11px]">
                      <Clock className="size-3" /> ~35 min
                    </div>
                    <div className="flex items-center gap-1 rounded-full bg-black/30 backdrop-blur px-2 py-0.5 text-[11px]">
                      <Star className="size-3 fill-warning text-warning" /> 4.{ratingTenth}
                    </div>
                  </div>
                </div>
                <CardContent className="p-4 md:p-5">
                  <div className="display text-base md:text-lg font-semibold group-hover:text-primary transition-colors">
                    {r.name}
                  </div>
                  {r.tagline && <p className="mt-1 text-xs md:text-sm text-muted-foreground line-clamp-2">{r.tagline}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    {/* Inline cuisine + ETA + rating pills */}
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                      <Clock className="size-3" /> ~35 min
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                      <Star className="size-3 fill-warning text-warning" /> 4.{ratingTenth}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                      <ChefHat className="size-3" />
                      {r.cuisine ?? 'Multi-cuisine'}
                    </span>
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <MapPin className="size-3" />
                      {r._count.branches} {r._count.branches === 1 ? 'branch' : 'branches'}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
