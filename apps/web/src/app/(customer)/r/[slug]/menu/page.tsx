import Image from 'next/image';
import Link from 'next/link';
import { prisma } from '@/server/db';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { MenuClient } from '../../../menu/menu-client';
import { ComboAddButton } from '../../../combos/combo-add-button';
import { StorefrontAnnouncementBar } from '@/components/storefront/announcement-bar';
import { ContentBlocks } from '@/components/storefront/storefront-sections';
import { parseStorefrontConfig } from '@/server/storefront-cms';
import { HeartButton } from '@/components/heart-button';
import { money } from '@/lib/utils';
import { COMBO_IMAGES, FOOD_FALLBACK } from '@/lib/food-images';
import { ChevronLeft, Flame } from 'lucide-react';
import { isCategoryAvailableNow, formatNextOpenLabel } from '@/server/category-availability';
import { OfferCards } from '../offer-cards';
import { priceForItem, priceForCombo } from '@/server/happy-hours';
import { HappyHourBanner } from '../happy-hour-banner';
import { DeliveryEtaCard } from '../delivery-eta-card';
import { CategoryFab } from '../category-fab';
import { FoodLicenseFooter } from '../food-license-footer';
import { JsonLd } from '@/components/seo/json-ld';
import { brand } from '@/lib/brand';
import { loadRestaurantPageData } from '../page-data';

const SITE = 'https://flavrly.in';

// Same dynamic rendering policy as the homepage — CMS changes show
// immediately when an admin hits Save on the storefront editor.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await prisma.restaurant.findUnique({ where: { slug } });
  if (!r) return { title: 'Menu' };
  const cms = parseStorefrontConfig((r as { storefrontConfig?: unknown }).storefrontConfig);
  const baseTitle = cms.seo.metaTitle || r.name;
  const title = `Menu · ${baseTitle}`;
  const description = cms.seo.metaDescription || r.tagline || `Order from ${r.name} on ${brand.name}.`;
  const ogImage = cms.seo.ogImage || r.coverImageUrl || r.logoUrl || undefined;
  return {
    title,
    description,
    alternates: { canonical: `${SITE}/r/${slug}/menu` },
    openGraph: {
      title,
      description,
      url: `${SITE}/r/${slug}/menu`,
      type: 'website',
      ...(ogImage ? { images: [{ url: ogImage }] } : {})
    },
    twitter: {
      card: ogImage ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(ogImage ? { images: [ogImage] } : {})
    }
  };
}

export default async function RestaurantMenuPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const {
    restaurant,
    branch,
    cms,
    themeVars,
    heroImage,
    happyHourRules,
    happyHourEnds,
    activeOffers,
    categories,
    combos,
    topSellers,
    fabCategories,
    favRestaurant,
    favItemSet,
    isAuthed,
    rating,
    dishCount,
    now
  } = await loadRestaurantPageData(slug);

  return (
    <div style={themeVars}>
      {cms.announcement.enabled && cms.announcement.text && (
        <StorefrontAnnouncementBar
          text={cms.announcement.text}
          linkLabel={cms.announcement.linkLabel || undefined}
          linkHref={cms.announcement.linkHref || undefined}
          bgColor={cms.announcement.bgColor}
          textColor={cms.announcement.textColor}
        />
      )}
      {/* Single Restaurant JSON-LD pointing at the /menu URL. Breadcrumbs live
          on the marketing homepage; we keep the menu page lean. */}
      <JsonLd
        data={[
          {
            '@context': 'https://schema.org',
            '@type': 'Restaurant',
            name: restaurant.name,
            description: restaurant.tagline || `${restaurant.name} on ${brand.name}`,
            url: `${SITE}/r/${slug}/menu`,
            image: heroImage,
            ...(restaurant.cuisine ? { servesCuisine: restaurant.cuisine } : {}),
            priceRange: '₹₹',
            address: {
              '@type': 'PostalAddress',
              addressLocality: branch.city || 'Guntur',
              addressRegion: 'Andhra Pradesh',
              addressCountry: 'IN'
            },
            aggregateRating: { '@type': 'AggregateRating', ratingValue: rating, ratingCount: 200 }
          }
        ]}
      />

      {/* ───────── Slim sticky header ───────── */}
      {/* Mobile: compact bar with back arrow + name + heart.
          md+: full-width band with the cover image as a thin strip behind. */}
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="md:hidden container py-3 flex items-center gap-2">
          <Link
            href={`/r/${slug}`}
            aria-label={`Back to ${restaurant.name}`}
            className="inline-flex items-center justify-center size-9 rounded-full hover:bg-muted -ml-1"
          >
            <ChevronLeft className="size-5" />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate">{restaurant.name}</div>
            <div className="text-[11px] text-muted-foreground truncate">Menu · {dishCount} dishes</div>
          </div>
          <HeartButton
            restaurantId={restaurant.id}
            initial={Boolean(favRestaurant)}
            requireAuth={!isAuthed}
            variant="default"
            size="sm"
            label={favRestaurant ? 'Remove restaurant from favorites' : 'Add restaurant to favorites'}
          />
        </div>
        <div className="hidden md:block relative h-16 overflow-hidden">
          <Image
            src={heroImage}
            alt={restaurant.name}
            fill
            sizes="100vw"
            className="object-cover opacity-40"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/60" />
          <div className="relative container h-full flex items-center gap-3">
            <Link
              href={`/r/${slug}`}
              aria-label={`Back to ${restaurant.name}`}
              className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-primary -ml-1"
            >
              <ChevronLeft className="size-4" /> Back
            </Link>
            <div className="h-6 w-px bg-border" />
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-base font-semibold truncate">{restaurant.name}</h1>
              {restaurant.cuisine && (
                <Badge variant="secondary" className="font-medium">{restaurant.cuisine}</Badge>
              )}
            </div>
            <div className="ml-auto">
              <HeartButton
                restaurantId={restaurant.id}
                initial={Boolean(favRestaurant)}
                requireAuth={!isAuthed}
                variant="default"
                size="sm"
                label={favRestaurant ? 'Remove restaurant from favorites' : 'Add restaurant to favorites'}
              />
            </div>
          </div>
        </div>
      </header>

      {/* ───────── Above-the-fold info: ETA + happy hour + offers ───────── */}
      <div className="space-y-3 px-3 md:px-0 md:space-y-0 pt-3 md:pt-0">
        {happyHourEnds && (
          <HappyHourBanner
            endsAt={happyHourEnds.endsAt}
            endsInMin={happyHourEnds.endsInMin}
            ruleCount={happyHourRules.length}
          />
        )}
        <div className="md:container md:pt-4">
          <DeliveryEtaCard
            branchId={branch.id}
            branchName={restaurant.name}
            branchCity={branch.city}
          />
        </div>
        {cms.layout.showOffersStrip && (
          <OfferCards offers={JSON.parse(JSON.stringify(activeOffers))} />
        )}
      </div>

      {/* ───────── Top Sellers (full grid) ───────── */}
      {cms.topSellers.enabled && topSellers.length > 0 && (
        <section className="container py-10 border-b">
          <div className="mb-6 reveal">
            {cms.topSellers.eyebrow && (
              <div className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center gap-1.5">
                <Flame className="size-3.5" /> {cms.topSellers.eyebrow}
              </div>
            )}
            {cms.topSellers.heading && (
              <h2 className="display mt-1 text-2xl font-semibold">{cms.topSellers.heading}</h2>
            )}
            {cms.topSellers.subheading && (
              <p className="mt-1.5 text-sm text-muted-foreground max-w-2xl">{cms.topSellers.subheading}</p>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-4 reveal-stagger">
            {topSellers.slice(0, cms.topSellers.limit).map((t: any, i: number) => (
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
                  {cms.topSellers.showRankBadge && (
                    <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-primary/95 text-primary-foreground text-[10px] font-bold tracking-wider shadow-lg">
                      #{i + 1} BESTSELLER
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <div className="font-semibold text-sm truncate">{t.name}</div>
                  {cms.topSellers.showSoldCount && (
                    <div className="mt-0.5 text-xs text-muted-foreground flex items-center gap-1">
                      <Flame className="size-3 text-primary" />
                      {t.soldCount} ordered in 30 days
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ───────── Combos (full grid) + Menu ───────── */}
      <section className="container py-10">
        {cms.combos.enabled && combos.length > 0 && (
          <div className="mb-12">
            <div className="mb-5 reveal">
              {cms.combos.eyebrow && (
                <div className="text-xs font-semibold uppercase tracking-wider text-primary">{cms.combos.eyebrow}</div>
              )}
              {cms.combos.heading && (
                <h2 className="display mt-1 text-2xl font-semibold">{cms.combos.heading}</h2>
              )}
              {cms.combos.subheading && (
                <p className="mt-1.5 text-sm text-muted-foreground max-w-2xl">{cms.combos.subheading}</p>
              )}
            </div>
            <div className="grid gap-4 md:gap-5 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 reveal-stagger">
              {combos.slice(0, cms.combos.limit).map((c: any) => {
                const hh = priceForCombo({ id: c.id, price: Number(c.price) }, happyHourRules, now);
                return (
                  <Card key={c.id} className="overflow-hidden group card-lift">
                    <div className="relative h-44 bg-muted overflow-hidden">
                      <Image
                        src={c.imageUrl || COMBO_IMAGES[c.slug] || FOOD_FALLBACK}
                        alt={c.name}
                        fill
                        sizes="(min-width: 1024px) 33vw, 100vw"
                        className="object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                      {cms.combos.showComboBadge && (
                        <Badge className="absolute top-3 left-3 bg-warning/95 text-warning-foreground border-transparent">Combo</Badge>
                      )}
                    </div>
                    <CardContent className="p-5">
                      <div className="display text-lg font-semibold group-hover:text-primary transition-colors">{c.name}</div>
                      {c.description && <div className="mt-1 text-sm text-muted-foreground line-clamp-2">{c.description}</div>}
                      <ul className="mt-3 text-sm text-muted-foreground space-y-0.5">
                        {c.items.map((i: any) => <li key={i.id}>• {i.quantity}× {i.menuItem.name}</li>)}
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
          menuLayout={cms.layout.menuLayout}
          data={JSON.parse(
            JSON.stringify(
              categories.map((c) => {
                // Server-resolved availability so the (browserless) initial
                // paint is correct; client renders what we send.
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
                  items: c.menuItems.map((m: any) => {
                    // Mirror the happy-hour math here so the displayed price
                    // (and the cart copy of unitPrice) matches what the
                    // server will actually charge.
                    const hh = priceForItem(
                      { id: m.id, categoryId: m.categoryId, price: Number(m.price) },
                      happyHourRules,
                      now
                    );
                    const variants = (m.variants ?? []).map((v: any) => ({
                      id: v.id,
                      name: v.name,
                      price: Number(v.price),
                      isDefault: v.isDefault,
                      isAvailable: v.isAvailable
                    }));
                    const modifierGroups = (m.modifierGroups ?? []).map((g: any) => ({
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

      {/* ───────── CMS: bottom content blocks ───────── */}
      <ContentBlocks blocks={cms.blocks} position="bottom" />

      {/* ───────── FSSAI licence footer ───────── */}
      <FoodLicenseFooter
        licenseNumber={(branch as any).fssaiLicenseNumber}
        licenseImageUrl={(branch as any).fssaiLicenseImageUrl}
        holder={(branch as any).fssaiLicenseHolder}
      />

      {/* Floating Categories Menu (mobile-only). Sits above the bottom nav. */}
      <CategoryFab categories={fabCategories} />
    </div>
  );
}
