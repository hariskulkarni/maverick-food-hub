import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ChevronLeft, MapPin, Navigation, Clock, Star, Percent, Gift, Tag, Leaf, Drumstick, UtensilsCrossed } from 'lucide-react';
import { ImageWithFallback } from '@/components/image-with-fallback';
import { FOOD_FALLBACK } from '@/lib/food-images';
import { getDiscoveryCategory, type DiscoveryCategory } from '@/lib/discovery-categories';
import { readDeliveryLocation } from '@/server/discovery';
import { getDiscoveryRadiusKm } from '@/server/platform-settings';
import {
  getCategoryView,
  getDishRestaurants,
  type VegFilter,
  type CategoryDish,
  type DishRestaurant,
  type CategoryOffer
} from '@/server/dish-discovery';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Params = Promise<{ slug: string }>;
type Search = Promise<{ dish?: string; veg?: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const cat = getDiscoveryCategory(slug);
  if (!cat) return { title: 'Category' };
  return {
    title: `${cat.label} near you`,
    description: `${cat.tagline} Order ${cat.label} from the best kitchens on Flavrly.`
  };
}

function formatDistance(distanceM: number | null): string | null {
  if (distanceM == null) return null;
  const km = distanceM / 1000;
  return `${(Math.round(km * 10) / 10).toFixed(1)} km`;
}

const rupee = (n: number) => `₹${Math.round(n)}`;

function offerValue(o: CategoryOffer): string {
  if (o.percentOff && o.percentOff > 0) return `${o.percentOff}% OFF`;
  if (o.flatOff && o.flatOff > 0) return `₹${o.flatOff} OFF`;
  if (o.type === 'BUY_X_GET_Y') return 'Buy 1 Get 1';
  if (o.type === 'FREE_ITEM_ABOVE') return 'Free item';
  return 'Special offer';
}

export default async function CategoryPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug } = await params;
  const sp = (await searchParams) ?? {};
  const category = getDiscoveryCategory(slug);
  if (!category) notFound();

  const veg: VegFilter = sp.veg === 'veg' ? 'veg' : sp.veg === 'nonveg' ? 'nonveg' : null;
  const selectedDish = typeof sp.dish === 'string' && sp.dish.length > 0 ? sp.dish : null;

  const [loc, radiusKm] = await Promise.all([readDeliveryLocation(), getDiscoveryRadiusKm()]);

  // Preserve veg filter across links.
  const withVeg = (base: string) => (veg ? `${base}${base.includes('?') ? '&' : '?'}veg=${veg}` : base);
  const vegHref = (v: VegFilter) => {
    const params = new URLSearchParams();
    if (selectedDish) params.set('dish', selectedDish);
    if (v) params.set('veg', v);
    const q = params.toString();
    return q ? `/category/${slug}?${q}` : `/category/${slug}`;
  };

  return (
    <>
      {/* ─────────── Full-bleed category hero ─────────── */}
      <section className="relative">
        <div className="relative h-44 w-full overflow-hidden md:h-60">
          <ImageWithFallback src={category.image} alt={category.label} fill priority sizes="100vw" className="object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-black/20" />
          <div className="absolute inset-0">
            <div className="container flex h-full flex-col justify-end pb-5">
              <Link
                href="/restaurants"
                className="absolute left-4 top-4 inline-flex size-9 items-center justify-center rounded-full bg-white/90 text-foreground shadow-md backdrop-blur tap-press md:left-0"
                aria-label="Back to restaurants"
              >
                <ChevronLeft className="size-5" />
              </Link>
              <h1 className="display text-3xl font-extrabold text-white drop-shadow md:text-5xl">{category.label}</h1>
              <p className="mt-1 max-w-md text-sm text-white/90 md:text-base">{category.tagline}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="container pt-4 pb-8">
        {/* Veg / Non-veg quick filter */}
        <div className="mb-5 flex items-center gap-2">
          <FilterPill href={vegHref(null)} active={veg === null} label="All" />
          <FilterPill href={vegHref('veg')} active={veg === 'veg'} label="Veg" tone="veg" icon={<Leaf className="size-3.5" />} />
          <FilterPill href={vegHref('nonveg')} active={veg === 'nonveg'} label="Non-veg" tone="nonveg" icon={<Drumstick className="size-3.5" />} />
        </div>

        {selectedDish ? (
          <DishResults category={category} slug={slug} selectedDish={selectedDish} loc={loc} radiusKm={radiusKm} veg={veg} />
        ) : (
          <CategoryLanding category={category} slug={slug} loc={loc} radiusKm={radiusKm} veg={veg} withVeg={withVeg} />
        )}
      </div>
    </>
  );
}

/* ─────────────────────────── Landing (dish grid) ─────────────────────────── */

async function CategoryLanding({
  category,
  slug,
  loc,
  radiusKm,
  veg,
  withVeg
}: {
  category: DiscoveryCategory;
  slug: string;
  loc: Awaited<ReturnType<typeof readDeliveryLocation>>;
  radiusKm: number;
  veg: VegFilter;
  withVeg: (base: string) => string;
}) {
  const { dishes, restaurantCount, offers } = await getCategoryView(category, loc, radiusKm, veg);

  if (dishes.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed bg-muted/30 p-10 text-center">
        <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <UtensilsCrossed className="size-6" />
        </div>
        <p className="font-medium">No {category.label.toLowerCase()} near you yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {loc ? 'Try changing your delivery location or ' : 'Set your delivery location or '}
          <Link href="/restaurants" className="text-primary underline">browse all restaurants</Link>.
        </p>
      </div>
    );
  }

  const dishKeyParam = (d: CategoryDish) => `/category/${slug}?dish=${encodeURIComponent(d.key)}`;

  return (
    <>
      {/* Offers strip */}
      {offers.length > 0 && (
        <section className="mb-6">
          <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
            <Tag className="size-3.5" /> {category.label} offers
          </div>
          <div className="-mx-4 overflow-x-auto no-scrollbar px-4 md:mx-0 md:px-0">
            <div className="flex gap-3">
              {offers.map((o) => {
                const Icon = o.percentOff ? Percent : o.type === 'BUY_X_GET_Y' || o.type === 'FREE_ITEM_ABOVE' ? Gift : Tag;
                return (
                  <div key={o.id} className="w-44 shrink-0 rounded-2xl border bg-card p-4 card-lift">
                    <div className="grid size-9 place-items-center rounded-full bg-primary/10 text-primary"><Icon className="size-4" /></div>
                    <div className="display mt-2 text-lg font-bold leading-none">{offerValue(o)}</div>
                    <div className="mt-1 truncate text-xs font-medium">{o.name}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <div className="mb-3 flex items-end justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-primary">Popular in {category.label}</div>
          <h2 className="display text-xl font-semibold md:text-2xl">Pick your favourite</h2>
        </div>
        <span className="text-xs text-muted-foreground">{restaurantCount} {restaurantCount === 1 ? 'restaurant' : 'restaurants'}</span>
      </div>

      {/* Dish grid — every dish tile opens the restaurants-serving-it list. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 reveal-stagger">
        {dishes.map((d) => (
          <Link key={d.key} href={withVeg(dishKeyParam(d))} className="group block tap-press">
            <div className="overflow-hidden rounded-2xl border bg-card card-lift h-full">
              <div className="relative aspect-[4/3] bg-muted overflow-hidden">
                <ImageWithFallback
                  src={d.image || category.image || FOOD_FALLBACK}
                  alt={d.name}
                  fill
                  loading="lazy"
                  sizes="(min-width:1024px) 25vw, (min-width:640px) 33vw, 50vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <span className={`absolute left-2 top-2 grid size-4 place-items-center rounded-[3px] border bg-white ${d.isVeg ? 'border-success' : 'border-destructive'}`}>
                  <span className={`size-2 rounded-full ${d.isVeg ? 'bg-success' : 'bg-destructive'}`} />
                </span>
              </div>
              <div className="p-3">
                <div className="line-clamp-2 text-sm font-semibold leading-tight group-hover:text-primary">{d.name}</div>
                <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">from {rupee(d.minPrice)}</span>
                  <span>{d.restaurantCount} {d.restaurantCount === 1 ? 'place' : 'places'}</span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

/* ─────────────────────── Dish selected (restaurant list) ─────────────────────── */

async function DishResults({
  category,
  slug,
  selectedDish,
  loc,
  radiusKm,
  veg
}: {
  category: DiscoveryCategory;
  slug: string;
  selectedDish: string;
  loc: Awaited<ReturnType<typeof readDeliveryLocation>>;
  radiusKm: number;
  veg: VegFilter;
}) {
  const { dishName, restaurants } = await getDishRestaurants(category, selectedDish, loc, radiusKm, veg);
  const backHref = veg ? `/category/${slug}?veg=${veg}` : `/category/${slug}`;

  return (
    <>
      <Link href={backHref} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-primary tap-press">
        <ChevronLeft className="size-4" /> All {category.label.toLowerCase()}
      </Link>
      <h2 className="display text-xl font-semibold md:text-2xl">
        Restaurants serving <span className="text-primary">{dishName || category.label}</span>
      </h2>
      <p className="mt-1 mb-5 text-sm text-muted-foreground">
        {restaurants.length} {restaurants.length === 1 ? 'place' : 'places'}{loc ? ' near you' : ''}
      </p>

      {restaurants.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-muted/30 p-10 text-center">
          <p className="font-medium">No restaurants serve this right now</p>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link href={backHref} className="text-primary underline">Back to {category.label.toLowerCase()}</Link>
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 reveal-stagger">
          {restaurants.map((r) => (
            <RestaurantRow key={r.id} r={r} category={category.image} />
          ))}
        </div>
      )}
    </>
  );
}

function RestaurantRow({ r, category }: { r: DishRestaurant; category: string }) {
  const distance = formatDistance(r.distanceM);
  return (
    <Link href={`/r/${r.slug}`} className="group block tap-press">
      <div className="flex gap-3 overflow-hidden rounded-2xl border bg-card p-3 card-lift h-full">
        <div className="relative size-24 shrink-0 overflow-hidden rounded-xl bg-muted">
          <ImageWithFallback
            src={r.image || r.coverImageUrl || category || FOOD_FALLBACK}
            alt={r.itemName}
            fill
            loading="lazy"
            sizes="96px"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <span className={`absolute left-1.5 top-1.5 grid size-4 place-items-center rounded-[3px] border bg-white ${r.isVeg ? 'border-success' : 'border-destructive'}`}>
            <span className={`size-2 rounded-full ${r.isVeg ? 'bg-success' : 'bg-destructive'}`} />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="display text-base font-semibold leading-tight group-hover:text-primary line-clamp-1">{r.name}</div>
          <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{r.itemName}</div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{rupee(r.price)}</span>
            <span className="inline-flex items-center gap-1"><Clock className="size-3" /> ~35 min</span>
            {distance && <span className="inline-flex items-center gap-1"><Navigation className="size-3" /> {distance}</span>}
            {r.cuisine && <span className="inline-flex items-center gap-1"><Star className="size-3 fill-warning text-warning" /> {r.cuisine}</span>}
          </div>
        </div>
      </div>
    </Link>
  );
}

/* ───────────────────────────── helpers ───────────────────────────── */

function FilterPill({
  href,
  active,
  label,
  tone,
  icon
}: {
  href: string;
  active: boolean;
  label: string;
  tone?: 'veg' | 'nonveg';
  icon?: React.ReactNode;
}) {
  const activeClass =
    tone === 'veg'
      ? 'bg-success text-success-foreground border-success'
      : tone === 'nonveg'
        ? 'bg-destructive text-destructive-foreground border-destructive'
        : 'bg-primary text-primary-foreground border-primary';
  return (
    <Link
      href={href}
      className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors tap-press ${
        active ? activeClass : 'bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}
