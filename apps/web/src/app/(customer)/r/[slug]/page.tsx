import Image from 'next/image';
import Link from 'next/link';
import { prisma } from '@/server/db';
import { ImageWithFallback } from '@/components/image-with-fallback';
import { LOGO_FIT_CLASS, LOGO_SHAPE_RADIUS_CLASS, HERO_WIDTH_WRAP_CLASS, HERO_WIDTH_INNER_CLASS, HERO_HEIGHT_CLASS, HERO_FIT_CLASS, HERO_POSITION_CLASS } from '@/server/storefront-cms';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { MenuClient } from '../../menu/menu-client';
import { MenuItemCard, type MenuItemForCard } from '../../menu/menu-item-card';
import { ComboAddButton } from '../../combos/combo-add-button';
import { StorefrontHeroCarousel } from '@/components/storefront/hero-carousel';
import { StorefrontAnnouncementBar } from '@/components/storefront/announcement-bar';
import { AboutSection, ContentBlocks, StorefrontFooter } from '@/components/storefront/storefront-sections';
import { parseStorefrontConfig } from '@/server/storefront-cms';
import { HeartButton } from '@/components/heart-button';
import { money } from '@/lib/utils';
import { COMBO_IMAGES, FOOD_FALLBACK } from '@/lib/food-images';
import { Clock, MapPin, ShieldCheck, Star, Flame } from 'lucide-react';
import { isCategoryAvailableNow, formatNextOpenLabel } from '@/server/category-availability';
import { OfferCards } from './offer-cards';
import { priceForItem, priceForCombo } from '@/server/happy-hours';
import { HappyHourBanner } from './happy-hour-banner';
import { DeliveryEtaCard } from './delivery-eta-card';
import { DeliveryEtaChip } from './delivery-eta-chip';
import { BrandRibbon } from './brand-ribbon';
import { CategoryFab } from './category-fab';
import { ClosedBanner } from './closed-banner';
import { FoodLicenseFooter } from './food-license-footer';
import { JsonLd } from '@/components/seo/json-ld';
import { brand } from '@/lib/brand';
import { loadRestaurantPageData } from './page-data';

const SITE = 'https://flavrly.in';

/**
 * Single-page restaurant ordering view.
 *
 * This route is the entire customer experience — no separate "marketing
 * homepage" and "menu page". The QR / URL drops the customer straight into
 * the orderable surface:
 *   • hero carousel + restaurant identity
 *   • sticky info bar (open · ETA · rating · city · verified)
 *   • brand ribbon (if part of an umbrella)
 *   • delivery ETA card
 *   • CMS About + top content blocks
 *   • happy-hour banner + offers strip
 *   • bestsellers grid (CMS-configurable)
 *   • combos grid (CMS-configurable)
 *   • MenuClient (the full menu)
 *   • bottom content blocks + FSSAI footer
 *   • floating category FAB
 *
 * The mobile bottom nav independently swaps to the 4-tab restaurant
 * variant (Dine-In / Orders / Cart / Profile) — see `bottom-nav.tsx`.
 *
 * Dynamic rendering is on so CMS edits go live on the next request.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await prisma.restaurant.findUnique({ where: { slug } });
  if (!r) return { title: 'Restaurant' };
  const cms = parseStorefrontConfig((r as { storefrontConfig?: unknown }).storefrontConfig);
  const title = cms.seo.metaTitle || r.name;
  const description = cms.seo.metaDescription || r.tagline || `Order from ${r.name} on ${brand.name}.`;
  const ogImage = cms.seo.ogImage || r.coverImageUrl || r.logoUrl || undefined;
  return {
    title,
    description,
    alternates: { canonical: `${SITE}/r/${slug}` },
    openGraph: {
      title,
      description,
      url: `${SITE}/r/${slug}`,
      type: 'website',
      ...(ogImage ? { images: [{ url: ogImage }] } : {}),
    },
    twitter: {
      card: ogImage ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };
}

export default async function RestaurantPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const {
    restaurant,
    branch,
    cms,
    themeVars,
    heroSlides,
    heroImage,
    siblingCuisineCount,
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
    ratingValue,
    ratingCount,
    isVerified,
    dishCount,
    now,
    openStatus,
  } = await loadRestaurantPageData(slug);

  // When the branch is closed we dim the menu surfaces (apply opacity-60 to
  // the wrapper that holds the cards), show a sticky amber banner at the top
  // explaining when it reopens, and still let customers add items to cart so
  // they can pre-order. Checkout enforces a scheduled-order slot inside the
  // next open window. See server/operating-hours.ts for the resolver.
  const isClosed = !openStatus.isOpen;

  // Info-bar CMS controls (visibility toggles + ETA mode + optional manual
  // rating override). Defaults (all-on / auto) preserve historical behaviour.
  const _ib = cms.infoBar;
  const _useManualRating = _ib.ratingMode === 'manual' && _ib.ratingManualValue !== '';
  const _ratingValue: string | null = _useManualRating ? _ib.ratingManualValue : ratingValue;
  const _ratingCount: number = _useManualRating ? _ib.ratingManualCount : ratingCount;
  const closedMenuClass = isClosed ? 'opacity-60 [&_button[data-add-to-cart]]:opacity-100' : '';

  return (
    <div style={themeVars}>
      {/* Operating-hours banner — sits above the announcement bar so it's the
          first thing customers see when the branch is closed. Includes a live
          countdown to the next open window. */}
      {isClosed && (
        <ClosedBanner
          label={openStatus.label}
          nextChangeAtIso={openStatus.nextChangeAt ? openStatus.nextChangeAt.toISOString() : null}
          reason={openStatus.reason}
        />
      )}

      {cms.announcement.enabled && cms.announcement.text && (
        <StorefrontAnnouncementBar
          text={cms.announcement.text}
          linkLabel={cms.announcement.linkLabel || undefined}
          linkHref={cms.announcement.linkHref || undefined}
          bgColor={cms.announcement.bgColor}
          textColor={cms.announcement.textColor}
        />
      )}

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
              addressCountry: 'IN',
            },
            areaServed: {
              '@type': 'City',
              name: 'Guntur',
              containedInPlace: { '@type': 'AdministrativeArea', name: 'Andhra Pradesh' },
            },
            aggregateRating: ratingCount > 0 ? { '@type': 'AggregateRating', ratingValue, ratingCount } : undefined,
          },
          {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: brand.name, item: SITE },
              { '@type': 'ListItem', position: 2, name: 'Restaurants', item: `${SITE}/restaurants` },
              { '@type': 'ListItem', position: 3, name: restaurant.name, item: `${SITE}/r/${slug}` },
            ],
          },
        ]}
      />

      {/* ───────── Hero ───────── */}
      {heroSlides.length > 0 ? (
        <>
          <StorefrontHeroCarousel
            slides={heroSlides}
            alt={restaurant.name}
            restaurantId={restaurant.id}
            isAuthed={isAuthed}
            favInitial={Boolean(favRestaurant)}
            transition={cms.hero.transition}
            autoplayMs={cms.hero.autoplayMs}
            accentColor={cms.branding.accentColor}
            // Hero size — CMS-controlled. See HeroWidth / HeroHeight in
            // @/server/storefront-cms for the 7 width × 8 height presets.
            // Old configs (missing these fields) fall through the parser to
            // 'full-bleed' / 'wide', which is the historical look.
            width={cms.hero.width}
            height={cms.hero.height}
            imageFit={cms.hero.imageFit}
            imagePosition={cms.hero.imagePosition}
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
        // Cover (single-image) hero — also honours the CMS-controlled width +
        // height presets so the size picker in /admin/storefront applies
        // whether the restaurant uses a single cover or a carousel. The wrap
        // class controls the page-level width (full-bleed, container, card,
        // narrow…); the inner classes add rounded corners + shadow where
        // appropriate; the height class controls the vertical rhythm.
        <div className={HERO_WIDTH_WRAP_CLASS[cms.hero.width] || ''}>
        <section className={`relative w-full bg-muted overflow-hidden ${HERO_WIDTH_INNER_CLASS[cms.hero.width]} ${HERO_HEIGHT_CLASS[cms.hero.height]}`}>
          {/* Use ImageWithFallback so a missing/404 cover URL (e.g. a logoUrl
              persisted in the DB whose file is no longer on disk) renders the
              on-brand gradient placeholder instead of the browser's broken-image
              glyph. The dead-link case happens most often with the local-
              storage driver when uploads were made on a different host. */}
          <ImageWithFallback src={heroImage} alt={restaurant.name} fill priority sizes="100vw" className={`${HERO_FIT_CLASS[cms.hero.imageFit]} ${HERO_POSITION_CLASS[cms.hero.imagePosition]}`} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-black/10" />
          <div className="absolute top-4 right-4 z-10">
            <HeartButton
              restaurantId={restaurant.id}
              initial={Boolean(favRestaurant)}
              requireAuth={!isAuthed}
              variant="glass"
              label={favRestaurant ? 'Remove restaurant from favorites' : 'Add restaurant to favorites'}
            />
          </div>
          {restaurant.logoUrl && (() => {
            // Storefront CMS: how the logo fills its badge. Defaults to
            // `contain` so a transparent brand mark (the common case) isn't
            // cropped — admins can switch to cover/stretch/native via the
            // CMS Logo display panel.
            const d = cms.branding.logoDisplay;
            return (
              <div
                className={`absolute left-4 md:left-8 bottom-[-32px] md:bottom-[-40px] size-20 md:size-24 overflow-hidden border-4 border-background shadow-xl ${LOGO_SHAPE_RADIUS_CLASS[d.shape]}`}
                // Inline style for two CMS-driven values that have too many
                // discrete possibilities to enumerate as Tailwind utilities.
                style={{ background: d.background || 'transparent', padding: `${d.padding}px` }}
              >
                <div className="relative h-full w-full">
                  <ImageWithFallback
                    src={restaurant.logoUrl}
                    alt={restaurant.name}
                    fill
                    sizes="96px"
                    className={LOGO_FIT_CLASS[d.fit]}
                  />
                </div>
              </div>
            );
          })()}
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
        </div>
      )}

      {/* ───────── Sticky info bar ───────── */}
      <div className="sticky top-0 z-30 glass border-b">
        <div className="container py-3 flex items-center gap-4 md:gap-6 text-xs md:text-sm overflow-x-auto no-scrollbar">
          {_ib.showOpen && (
          <div className={`flex items-center gap-1.5 font-medium ${restaurant.logoUrl ? 'md:ml-32' : ''} ${openStatus.isOpen ? '' : 'text-muted-foreground'}`}>
            <span className="relative inline-flex">
              <span className={`size-2 rounded-full ${openStatus.isOpen ? 'bg-success' : 'bg-muted-foreground/60'}`} />
              {openStatus.isOpen && <span className="absolute inset-0 size-2 rounded-full bg-success pulse-soft" />}
            </span>
            {openStatus.isOpen ? 'Open now' : (openStatus.label || 'Closed')}
          </div>
          )}
          {_ib.showEta && (
          <DeliveryEtaChip branchId={branch.id} hasGeo={branch.latitude != null && branch.longitude != null} mode={_ib.etaMode} rangeMin={_ib.etaRangeMin} rangeMax={_ib.etaRangeMax} fixedLabel={_ib.etaFixedLabel} />
          )}
          {_ib.showRating && (_ratingValue ? (
            <div className="flex items-center gap-1.5 text-muted-foreground"><Star className="size-4 fill-warning text-warning" /> {_ratingValue} {_ratingCount > 0 && <span className="hidden md:inline">· {_ratingCount.toLocaleString('en-IN')} rating{_ratingCount === 1 ? '' : 's'}</span>}</div>
          ) : (
            <div className="flex items-center gap-1.5 text-muted-foreground"><Star className="size-4" /> New</div>
          ))}
          {_ib.showLocation && (
          <div className="flex items-center gap-1.5 text-muted-foreground"><MapPin className="size-4" /> {branch.city}</div>
          )}
          {_ib.showVerified && isVerified && (
          <div className="flex items-center gap-1.5 text-muted-foreground"><ShieldCheck className="size-4 text-success" /> Verified</div>
          )}
          {(restaurant as any).dineInEnabled && (
            <Button asChild size="sm" variant="outline" className="shrink-0">
              <Link href={`/r/${slug}/reserve`}>Reserve a table</Link>
            </Button>
          )}
        </div>
      </div>

      {/* ───────── Brand ribbon ───────── */}
      {restaurant.brand && (
        <BrandRibbon
          brandSlug={restaurant.brand.slug}
          brandName={restaurant.brand.name}
          siblingCount={siblingCuisineCount}
        />
      )}

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

      {/* ───────── CMS: About + top content blocks ───────── */}
      <AboutSection about={cms.about} />
      <ContentBlocks blocks={cms.blocks} position="top" />

      {/* ───────── Top Sellers ───────── */}
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
          {/* Use the SAME MenuItemCard component the main Menu uses, so Top
              Sellers, Combos, and the main Menu all render the exact same
              card design on every restaurant page. This is what makes the
              two restaurant URLs visually consistent regardless of CMS
              configuration. */}
          {/* grid-cols-1 explicit at base — without it, the mobile track auto-sizes to
              min-content and the Next.js Image (rendered with fill) lets the column expand
              far beyond the viewport, clipping the description and Add button. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 reveal-stagger">
            {topSellers.slice(0, cms.topSellers.limit).map((t: any) => {
              // Map the topSeller shape to MenuItemForCard. happyHourLabel
              // and variants/modifierGroups default to empty since
              // topSellers come from a denormalised query.
              const hh = priceForItem(
                { id: t.id, categoryId: t.categoryId, price: Number(t.price) },
                happyHourRules,
                now,
              );
              const item: MenuItemForCard = {
                id: t.id,
                name: t.name,
                description: t.description ?? null,
                price: hh.effectivePrice,
                originalPrice: hh.savings > 0 ? hh.originalPrice : null,
                happyHourLabel: hh.label,
                imageUrl: t.imageUrl ?? null,
                isVeg: t.isVeg ?? true,
                spicyLevel: t.spicyLevel ?? 0,
                prepTimeMin: t.prepTimeMin ?? 20,
                isAuthed,
                isFavorited: favItemSet.has(t.id),
                variants: [],
                modifierGroups: [],
              };
              return <MenuItemCard key={t.id} item={item} branchId={branch.id} />;
            })}
          </div>
        </section>
      )}

      {/* ───────── Combos + Menu ─────────
          max-w-full + overflow-x-hidden as a belt for the html/body braces:
          even if some sub-component overshoots, this section can't make the
          page scroll right on phones.
          When the branch is closed we dim this whole section so the menu reads
          as "browsable but inactive". The amber banner above explains why. */}
      <section className={`container py-10 max-w-full overflow-x-hidden transition-opacity ${closedMenuClass}`} aria-disabled={isClosed}>
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
            {/* Phone-first vertical card matching MenuItemCard:
                h-32 image banner on top, content below. w-full max-w-full
                overflow-hidden on the card so it can never overflow its grid
                cell; min-w-0 inside text columns so titles truncate. md+ bumps
                the banner to h-44 to fill the 2/3-up grid more generously. */}
            <div className="grid gap-4 md:gap-5 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 reveal-stagger">
              {combos.slice(0, cms.combos.limit).map((c: any) => {
                const hh = priceForCombo({ id: c.id, price: Number(c.price) }, happyHourRules, now);
                return (
                  <Card key={c.id} className="w-full max-w-full overflow-hidden group card-lift">
                    <div className="relative h-32 md:h-44 w-full bg-muted overflow-hidden">
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
                    <CardContent className="p-4 md:p-5 min-w-0">
                      <div className="display text-lg font-semibold truncate group-hover:text-primary transition-colors">{c.name}</div>
                      {c.description && <div className="mt-1 text-sm text-muted-foreground line-clamp-2 break-words">{c.description}</div>}
                      <ul className="mt-3 text-sm text-muted-foreground space-y-0.5">
                        {c.items.map((i: any) => <li key={i.id} className="truncate">• {i.quantity}× {i.menuItem.name}</li>)}
                      </ul>
                      {/* Phone: stack price block on top, full-width Add combo
                          button below — guarantees neither can clip at 360px
                          even when the original-price + Happy Hour chip pair
                          renders alongside the effective price. Desktop keeps
                          the side-by-side row since there's ample horizontal
                          room in a 3-up grid. */}
                      <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-baseline gap-2 flex-wrap min-w-0">
                          <div className="font-semibold text-lg text-primary">{money(hh.effectivePrice as any)}</div>
                          {hh.savings > 0 && (
                            <>
                              <span className="text-sm text-muted-foreground line-through">{money(hh.originalPrice as any)}</span>
                              <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 text-warning border border-warning/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">Happy Hour</span>
                            </>
                          )}
                        </div>
                        <div className="sm:shrink-0">
                          <ComboAddButton id={c.id} name={c.name} price={hh.effectivePrice} imageUrl={c.imageUrl ?? COMBO_IMAGES[c.slug]} branchId={branch.id} />
                        </div>
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
                  available: status.available,
                  unavailableReason: status.reason === 'available' ? null : status.reason,
                  nextOpenLabel: status.available ? null : formatNextOpenLabel(status),
                  items: c.menuItems.map((m: any) => {
                    const hh = priceForItem(
                      { id: m.id, categoryId: m.categoryId, price: Number(m.price) },
                      happyHourRules,
                      now,
                    );
                    const variants = (m.variants ?? []).map((v: any) => ({
                      id: v.id, name: v.name, price: Number(v.price), isDefault: v.isDefault, isAvailable: v.isAvailable,
                    }));
                    const modifierGroups = (m.modifierGroups ?? []).map((g: any) => ({
                      id: g.id, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, required: g.required,
                      options: (g.options ?? []).map((o: any) => ({
                        id: o.id, name: o.name, priceDelta: Number(o.priceDelta), isDefault: o.isDefault, isAvailable: o.isAvailable,
                      })),
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
                      modifierGroups,
                    };
                  }),
                };
              }),
            ),
          )}
        />
      </section>

      {/* ───────── CMS: bottom content blocks + footer ───────── */}
      <ContentBlocks blocks={cms.blocks} position="bottom" />

      <StorefrontFooter footerText={cms.footer.text} social={cms.social} />

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
