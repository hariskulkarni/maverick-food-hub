import Image from 'next/image';
import { notFound } from 'next/navigation';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { Badge } from '@/components/ui/badge';
import { MenuClient } from '../../menu/menu-client';
import { Card, CardContent } from '@/components/ui/card';
import { ComboAddButton } from '../../combos/combo-add-button';
import { bannersForSlug } from '@/lib/storefront-banners';
import { StorefrontHeroCarousel } from '@/components/storefront/hero-carousel';
import { parseStorefrontConfig } from '@/server/storefront-cms';
import { HeartButton } from '@/components/heart-button';
import { money } from '@/lib/utils';
import { COMBO_IMAGES, FOOD_FALLBACK } from '@/lib/food-images';
import { Clock, MapPin, ShieldCheck, Star, Flame, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { isCategoryAvailableNow, formatNextOpenLabel } from '@/server/category-availability';
import { OfferCards } from './offer-cards';
import { loadRulesForRestaurant, priceForItem, priceForCombo, minutesUntilHappyHourEnds } from '@/server/happy-hours';
import { HappyHourBanner } from './happy-hour-banner';
import { DeliveryEtaCard } from './delivery-eta-card';
import { BrandRibbon } from './brand-ribbon';
import { CategoryFab, type CategoryFabEntry } from './category-fab';
import { FoodLicenseFooter } from './food-license-footer';
import { JsonLd } from '@/components/seo/json-ld';
import { brand } from '@/lib/brand';

const SITE = 'https://flavrly.in';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await prisma.restaurant.findUnique({ where: { slug } });
  return { title: r?.name ?? 'Restaurant' };
}

export default async function RestaurantPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Include the umbrella brand (slug + name) so we can render the "Part of …"
  // ribbon without a second round-trip. `brand` is nullable — most restaurants
  // are solo and have no brandId set.
  const restaurant = await prisma.restaurant.findUnique({
    where: { slug },
    include: { brand: { select: { slug: true, name: true } } }
  } as any) as any;
  if (!restaurant || restaurant.status !== 'ACTIVE') return notFound();

  // Count the brand's other active cuisines (excluding the current one) so
  // the ribbon can say "explore 5 sister cuisines". Skipped when no brand.
  // `brandId` is a new column the stale Prisma client doesn't know about yet —
  // hence the `as any` cast on the where clause (existing convention).
  const siblingCuisineCount: number = restaurant.brandId
    ? await prisma.restaurant.count({
        where: {
          brandId: restaurant.brandId,
          status: 'ACTIVE',
          id: { not: restaurant.id }
        } as any
      })
    : 0;

  const branch = await prisma.branch.findFirst({
    where: { restaurantId: restaurant.id, isActive: true },
    orderBy: { createdAt: 'asc' }
  });
  if (!branch) return notFound();

  const now = new Date();
  // Happy-hour rules currently active for this restaurant. We thread these
  // through to menu item + combo rendering so the strike-through price is
  // computed server-side. The banner countdown reads from the same set.
  const happyHourRules = await loadRulesForRestaurant(restaurant.id, now);
  const happyHourEnds = minutesUntilHappyHourEnds(happyHourRules, now);
  // Active offers for this restaurant — platform-wide (restaurantId NULL) OR
  // scoped to this restaurant. We only need card-display fields; the cart
  // endpoint re-evaluates eligibility before claiming.
  const activeOffers = await (prisma as any).offer.findMany({
    where: {
      isActive: true,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
      AND: [{ OR: [{ restaurantId: null }, { restaurantId: restaurant.id }] }]
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    take: 12
  });

  const [categories, combos, topSellers] = await Promise.all([
    // Include availability rows so we can resolve scheduled-category status
    // on the server and pass it through to the client component. We still
    // include disabled categories' children so the cart can show a proper
    // "Opens at …" hint instead of silently dropping a section the customer
    // might be looking for.
    prisma.category.findMany({
      where: { branchId: branch.id, isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        menuItems: {
          where: { isAvailable: true },
          orderBy: { sortOrder: 'asc' },
          // Variants (sizes) + modifier groups (add-ons) so the customer can
          // customize before adding to cart. Ordered for stable rendering.
          include: {
            variants: { orderBy: { sortOrder: 'asc' } },
            modifierGroups: {
              orderBy: { sortOrder: 'asc' },
              include: { options: { orderBy: { sortOrder: 'asc' } } }
            }
          }
        },
        availabilities: true
      }
    }),
    prisma.combo.findMany({
      where: { branchId: branch.id, isAvailable: true },
      orderBy: { sortOrder: 'asc' },
      include: { items: { include: { menuItem: true } } }
    }),
    // Top sellers: 4 most-ordered menu items in the past 30 days for this branch
    prisma.orderItem.groupBy({
      by: ['menuItemId'],
      _sum: { quantity: true },
      where: {
        menuItemId: { not: null },
        order: { branchId: branch.id, status: { notIn: ['CANCELLED', 'PAYMENT_FAILED'] }, placedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }
      },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 4
    }).then(async (rows) => {
      const items = await prisma.menuItem.findMany({ where: { id: { in: rows.map((r) => r.menuItemId!).filter(Boolean) } } });
      return rows.map((r) => ({ ...items.find((i) => i.id === r.menuItemId)!, soldCount: r._sum.quantity ?? 0 })).filter((x) => x?.id);
    })
  ]);

  // Auth + favorites — used to seed the heart buttons on the hero and each menu card.
  const session = await auth();
  // Key off the user *id*, not just session.user — a session can exist with an
  // undefined id (NextAuth edge case), and passing userId: undefined to Prisma
  // throws and 500s the whole storefront render for that visitor.
  const userId = session?.user?.id ?? null;
  const isAuthed = Boolean(userId);
  const [favRestaurant, favItemRows] = await Promise.all([
    userId
      ? prisma.favoriteRestaurant.findUnique({
          where: { userId_restaurantId: { userId, restaurantId: restaurant.id } }
        })
      : Promise.resolve(null),
    userId
      ? prisma.favoriteItem.findMany({
          where: { userId, menuItem: { branchId: branch.id } },
          select: { menuItemId: true }
        })
      : Promise.resolve([] as { menuItemId: string }[])
  ]);
  const favItemSet = new Set(favItemRows.map((r) => r.menuItemId));

  const heroImage = restaurant.coverImageUrl || restaurant.logoUrl || FOOD_FALLBACK;
  // Storefront CMS — the admin-configured hero (carousel slides + transition +
  // autoplay). Falls back to the legacy static banners, then to the cover image.
  const cms = parseStorefrontConfig((restaurant as { storefrontConfig?: unknown }).storefrontConfig);
  // Hero slides: admin-configured carousel slides (with captions/CTA) when set,
  // else the legacy static banners (mapped to plain slides), else cover image.
  const heroSlides =
    cms.hero.type === 'carousel' && cms.hero.slides.length > 0
      ? cms.hero.slides
      : (bannersForSlug(slug) ?? []).map((src) => ({ src }));
  const dishCount = categories.reduce((s, c) => s + c.menuItems.length, 0);

  // Floating categories FAB entries — projected from the same `categories`
  // query so availability + counts match what MenuClient renders. Empty
  // categories are skipped from the FAB because tapping them is a dead-end.
  const fabCategories: CategoryFabEntry[] = categories
    .filter((c) => c.menuItems.length > 0)
    .map((c) => {
      const status = isCategoryAvailableNow({
        id: c.id,
        name: c.name,
        isActive: c.isActive,
        scheduleEnabled: c.scheduleEnabled,
        availabilities: c.availabilities,
      });
      return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        itemCount: c.menuItems.length,
        available: status.available,
        nextOpenLabel: status.available ? null : formatNextOpenLabel(status),
      };
    });
  // Deterministic-looking rating from restaurant id, so it stays stable per page
  const rating = (4 + ((restaurant.id.charCodeAt(0) % 9) / 10)).toFixed(1);

  return (
    <div>
      <JsonLd
        data={[
          {
            '@context': 'https://schema.org',
            '@type': 'Restaurant',
            name: restaurant.name,
            description: restaurant.tagline || `${restaurant.name} on ${brand.name}`,
            url: `${SITE}/r/${slug}`,
            image: heroImage,
            ...(restaurant.cuisine ? { servesCuisine: restaurant.cuisine } : {}),
            priceRange: '₹₹',
            address: {
              '@type': 'PostalAddress',
              addressLocality: branch.city || 'Guntur',
              addressRegion: 'Andhra Pradesh',
              addressCountry: 'IN'
            },
            areaServed: {
              '@type': 'City',
              name: 'Guntur',
              containedInPlace: {
                '@type': 'AdministrativeArea',
                name: 'Andhra Pradesh'
              }
            },
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: rating,
              ratingCount: 200
            }
          },
          {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: brand.name, item: SITE },
              { '@type': 'ListItem', position: 2, name: 'Restaurants', item: `${SITE}/restaurants` },
              { '@type': 'ListItem', position: 3, name: restaurant.name, item: `${SITE}/r/${slug}` }
            ]
          }
        ]}
      />
      {/* ───────────────────────── Restaurant Hero ───────────────────────── */}
      {heroSlides.length > 0 ? (
        <>
          {/* Admin-configured hero carousel (CMS): slides, captions/CTA,
              transition + autoplay. Falls back to legacy banners. */}
          <StorefrontHeroCarousel
            slides={heroSlides}
            alt={restaurant.name}
            restaurantId={restaurant.id}
            isAuthed={isAuthed}
            favInitial={Boolean(favRestaurant)}
            transition={cms.hero.transition}
            autoplayMs={cms.hero.autoplayMs}
            accentColor={cms.branding.accentColor}
          />
          <div className="container py-4 reveal">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="display text-2xl md:text-4xl font-semibold tracking-tight">{restaurant.name}</h1>
              {restaurant.cuisine && <Badge variant="secondary" className="font-medium">{restaurant.cuisine}</Badge>}
            </div>
            {restaurant.tagline && <p className="mt-1 text-sm md:text-base text-muted-foreground max-w-2xl">{restaurant.tagline}</p>}
          </div>
        </>
      ) : (
      <section className="relative h-64 md:h-[22rem] bg-muted overflow-hidden">
        <Image src={heroImage} alt={restaurant.name} fill priority sizes="100vw" className="object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-black/10" />

        {/* Favorite toggle — top-right of the cover, glass-morphism backdrop */}
        <div className="absolute top-4 right-4 z-10">
          <HeartButton
            restaurantId={restaurant.id}
            initial={Boolean(favRestaurant)}
            requireAuth={!isAuthed}
            variant="glass"
            label={favRestaurant ? 'Remove restaurant from favorites' : 'Add restaurant to favorites'}
          />
        </div>

        {/* Floating logo */}
        {restaurant.logoUrl && (
          <div className="absolute left-4 md:left-8 bottom-[-32px] md:bottom-[-40px] size-20 md:size-24 rounded-2xl overflow-hidden border-4 border-background shadow-xl bg-card">
            <Image src={restaurant.logoUrl} alt={restaurant.name} fill sizes="96px" className="object-cover" />
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 container py-6 text-white reveal">
          <div className={restaurant.logoUrl ? 'md:pl-32' : ''}>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="display text-3xl md:text-5xl font-semibold tracking-tight">{restaurant.name}</h1>
              {restaurant.cuisine && (
                <Badge className="bg-white/15 text-white border-white/25 backdrop-blur ml-1">{restaurant.cuisine}</Badge>
              )}
            </div>
            {restaurant.tagline && <p className="mt-1 text-white/90 text-sm md:text-base max-w-2xl">{restaurant.tagline}</p>}
          </div>
        </div>
      </section>
      )}

      {/* ───────────────────────── Sticky Info Bar ───────────────────────── */}
      <div className="sticky top-0 z-30 glass border-b">
        <div className="container py-3 flex items-center gap-4 md:gap-6 text-xs md:text-sm overflow-x-auto no-scrollbar">
          <div className={`flex items-center gap-1.5 font-medium ${restaurant.logoUrl ? 'md:ml-32' : ''}`}>
            <span className="relative inline-flex">
              <span className="size-2 rounded-full bg-success" />
              <span className="absolute inset-0 size-2 rounded-full bg-success pulse-soft" />
            </span>
            Open now
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground"><Clock className="size-4" /> ~35 min delivery</div>
          <div className="flex items-center gap-1.5 text-muted-foreground"><Star className="size-4 fill-warning text-warning" /> {rating} <span className="hidden md:inline">· 200+ ratings</span></div>
          <div className="flex items-center gap-1.5 text-muted-foreground"><MapPin className="size-4" /> {branch.city}</div>
          <div className="flex items-center gap-1.5 text-muted-foreground"><ShieldCheck className="size-4 text-success" /> Verified</div>
          {/* Reserve-a-table CTA — only when the restaurant has dine-in enabled. */}
          {(restaurant as any).dineInEnabled && (
            <Button asChild size="sm" variant="outline" className="shrink-0">
              <Link href={`/r/${slug}/reserve`}>Reserve a table</Link>
            </Button>
          )}
          {/* Per-restaurant sign-in CTA — only shown to anonymous visitors. */}
          {!isAuthed && (
            <Button asChild size="sm" className="ml-auto shrink-0">
              <Link href={`/r/${slug}/login`}>Sign in</Link>
            </Button>
          )}
        </div>
      </div>

      {/* ───────────────────────── Sign-in CTA (anonymous only) ───────────────────────── */}
      {!isAuthed && (
        <div className="sticky top-12 z-20 border-b bg-gradient-to-r from-primary/10 via-primary/5 to-primary/10 backdrop-blur">
          <div className="container py-2.5 flex items-center justify-between gap-3">
            <div className="text-xs md:text-sm text-foreground/90 truncate">
              <span className="font-medium">Sign in</span>
              <span className="text-muted-foreground"> to save your favourites and track your order</span>
            </div>
            <Button asChild size="sm" className="shrink-0">
              <Link href={`/login?role=customer&next=${encodeURIComponent(`/r/${slug}`)}`}>
                Sign in
                <ArrowRight className="ml-1 size-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      )}

      {/* ───────────────────────── Brand ribbon ───────────────────────── */}
      {restaurant.brand && (
        <BrandRibbon
          brandSlug={restaurant.brand.slug}
          brandName={restaurant.brand.name}
          siblingCount={siblingCuisineCount}
        />
      )}

      {/* Above-the-fold info stack: ETA + happy hour + offers.
          Tighter gutters on mobile (px-3 + space-y-3); on md+ each child
          keeps its existing container chrome (px-0 here is a no-op once the
          children resume their `container` class). */}
      <div className="space-y-3 px-3 md:px-0 md:space-y-0 pt-3 md:pt-0">
        {/* Happy Hour banner */}
        {happyHourEnds && (
          <HappyHourBanner endsAt={happyHourEnds.endsAt} endsInMin={happyHourEnds.endsInMin} ruleCount={happyHourRules.length} />
        )}

        {/* Delivery ETA card */}
        <div className="md:container md:pt-4">
          <DeliveryEtaCard
            branchId={branch.id}
            branchName={restaurant.name}
            branchCity={branch.city}
          />
        </div>

        {/* Offers carousel — toggleable via Storefront CMS */}
        {cms.layout.showOffersStrip && <OfferCards offers={JSON.parse(JSON.stringify(activeOffers))} />}
      </div>

      {/* ───────────────────────── Top Sellers ───────────────────────── */}
      {cms.layout.showTopSellers && topSellers.length > 0 && (
        <section className="container py-10 border-b">
          <div className="mb-6 reveal">
            <div className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center gap-1.5">
              <Flame className="size-3.5" /> Most ordered here
            </div>
            <h2 className="display mt-1 text-2xl font-semibold">What everyone keeps coming back for</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-4 reveal-stagger">
            {topSellers.map((t: any, i: number) => (
              <div key={t.id} className="relative group overflow-hidden rounded-2xl border bg-card card-lift tap-press">
                <div className="relative h-36 overflow-hidden">
                  <Image
                    src={t.imageUrl || FOOD_FALLBACK}
                    alt={t.name}
                    fill
                    sizes="(min-width: 768px) 25vw, 50vw"
                    className="object-cover transition-transform duration-700 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-primary/95 text-primary-foreground text-[10px] font-bold tracking-wider shadow-lg">
                    #{i + 1} BESTSELLER
                  </div>
                </div>
                <div className="p-3">
                  <div className="font-semibold text-sm truncate">{t.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground flex items-center gap-1">
                    <Flame className="size-3 text-primary" />
                    {t.soldCount} ordered in 30 days
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ───────────────────────── Combos ───────────────────────── */}
      <section className="container py-10">
        {combos.length > 0 && (
          <div className="mb-12">
            <div className="mb-5 reveal">
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">Combos</div>
              <h2 className="display mt-1 text-2xl font-semibold">Crowd-pleasers</h2>
            </div>
            {/* Combos: 1-col on mobile so each combo gets full visual weight,
                then 2/3-up on tablet/desktop. */}
            <div className="grid gap-4 md:gap-5 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 reveal-stagger">
              {combos.map((c) => {
                const hh = priceForCombo({ id: c.id, price: Number(c.price) }, happyHourRules, now);
                return (
                <Card key={c.id} className="overflow-hidden group card-lift">{/* happy-hour-aware */}
                  <div className="relative h-44 bg-muted overflow-hidden">
                    <Image
                      src={c.imageUrl || COMBO_IMAGES[c.slug] || FOOD_FALLBACK}
                      alt={c.name}
                      fill
                      sizes="(min-width: 1024px) 33vw, 100vw"
                      className="object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                    <Badge className="absolute top-3 left-3 bg-warning/95 text-warning-foreground border-transparent">Combo</Badge>
                  </div>
                  <CardContent className="p-5">
                    <div className="display text-lg font-semibold group-hover:text-primary transition-colors">{c.name}</div>
                    {c.description && <div className="mt-1 text-sm text-muted-foreground line-clamp-2">{c.description}</div>}
                    <ul className="mt-3 text-sm text-muted-foreground space-y-0.5">
                      {c.items.map((i) => <li key={i.id}>• {i.quantity}× {i.menuItem.name}</li>)}
                    </ul>
                    <div className="mt-4 flex items-center justify-between border-t pt-4">
                      <div className="flex items-baseline gap-2">
                        <div className="font-semibold text-lg text-primary">{money(hh.effectivePrice as any)}</div>
                        {hh.savings > 0 && (
                          <>
                            <span className="text-sm text-muted-foreground line-through">{money(hh.originalPrice as any)}</span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 text-warning border border-warning/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">Happy Hour</span>
                          </>
                        )}
                      </div>
                      <ComboAddButton id={c.id} name={c.name} price={hh.effectivePrice} imageUrl={c.imageUrl ?? COMBO_IMAGES[c.slug]} branchId={branch.id} />
                    </div>
                  </CardContent>
                </Card>
                );
              })}
            </div>
          </div>
        )}

        <div className="reveal">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary">Menu</div>
          <h2 className="display mt-1 text-2xl font-semibold mb-6">{dishCount} dishes</h2>
        </div>
        <MenuClient
          branchId={branch.id}
          showSearch={cms.layout.showSearch}
          showFilters={cms.layout.showFilters}
          data={JSON.parse(
            JSON.stringify(
              categories.map((c) => {
                // Resolve current availability for this category on the server
                // so the (browserless) initial paint is correct. The client
                // doesn't recompute — it just displays what we send.
                const status = isCategoryAvailableNow({
                  id: c.id,
                  name: c.name,
                  isActive: c.isActive,
                  scheduleEnabled: c.scheduleEnabled,
                  availabilities: c.availabilities
                });
                return {
                  id: c.id,
                  name: c.name,
                  slug: c.slug,
                  available: status.available,
                  unavailableReason: status.reason === 'available' ? null : status.reason,
                  nextOpenLabel: status.available ? null : formatNextOpenLabel(status),
                  items: c.menuItems.map((m) => {
                    // Apply happy-hour pricing per item. The hub of price-locking
                    // is the order API, but we mirror the math here so the
                    // displayed price (and the cart copy of unitPrice) always
                    // matches what the server will charge.
                    const hh = priceForItem(
                      { id: m.id, categoryId: m.categoryId, price: Number(m.price) },
                      happyHourRules,
                      now
                    );
                    // Project variants + modifier groups, converting Decimal→Number
                    // so the client receives plain numbers (not Decimal/string).
                    const mAny = m as any;
                    const variants = (mAny.variants ?? []).map((v: any) => ({
                      id: v.id,
                      name: v.name,
                      price: Number(v.price),
                      isDefault: v.isDefault,
                      isAvailable: v.isAvailable
                    }));
                    const modifierGroups = (mAny.modifierGroups ?? []).map((g: any) => ({
                      id: g.id,
                      name: g.name,
                      minSelect: g.minSelect,
                      maxSelect: g.maxSelect,
                      required: g.required,
                      options: (g.options ?? []).map((o: any) => ({
                        id: o.id,
                        name: o.name,
                        priceDelta: Number(o.priceDelta),
                        isDefault: o.isDefault,
                        isAvailable: o.isAvailable
                      }))
                    }));
                    return {
                      ...m,
                      // Replace the unit price with the happy-hour price so the
                      // cart locks the right number. The card additionally renders
                      // originalPrice + happyHourLabel for the strike-through.
                      price: hh.effectivePrice,
                      originalPrice: hh.savings > 0 ? hh.originalPrice : null,
                      happyHourLabel: hh.label,
                      isAvailable: status.available && m.isAvailable,
                      isAuthed,
                      isFavorited: favItemSet.has(m.id),
                      variants,
                      modifierGroups
                    };
                  })
                };
              })
            )
          )}
        />
      </section>

      {/* ───────────────────────── FSSAI licence footer ───────────────────────── */}
      <FoodLicenseFooter
        licenseNumber={(branch as any).fssaiLicenseNumber}
        licenseImageUrl={(branch as any).fssaiLicenseImageUrl}
        holder={(branch as any).fssaiLicenseHolder}
      />

      {/* Floating Categories Menu (mobile-only). Mounted at the page root so it
          stays visible while the user scrolls through the menu sections. */}
      <CategoryFab categories={fabCategories} />
    </div>
  );
}
