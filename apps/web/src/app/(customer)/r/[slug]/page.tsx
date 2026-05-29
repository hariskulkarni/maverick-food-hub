import Image from 'next/image';
import Link from 'next/link';
import { prisma } from '@/server/db';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StorefrontHeroCarousel } from '@/components/storefront/hero-carousel';
import { StorefrontAnnouncementBar } from '@/components/storefront/announcement-bar';
import { AboutSection, ContentBlocks, StorefrontFooter } from '@/components/storefront/storefront-sections';
import { parseStorefrontConfig } from '@/server/storefront-cms';
import { HeartButton } from '@/components/heart-button';
import { FOOD_FALLBACK, COMBO_IMAGES } from '@/lib/food-images';
import { Clock, MapPin, ShieldCheck, Star, Flame, ArrowRight } from 'lucide-react';
import { DeliveryEtaCard } from './delivery-eta-card';
import { BrandRibbon } from './brand-ribbon';
import { FoodLicenseFooter } from './food-license-footer';
import { JsonLd } from '@/components/seo/json-ld';
import { brand } from '@/lib/brand';
import { loadRestaurantPageData } from './page-data';

const SITE = 'https://flavrly.in';

// Always render fresh so Storefront CMS changes appear the moment an admin
// hits Save — without this the route is cached and edits don't show until
// the cache expires.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await prisma.restaurant.findUnique({ where: { slug } });
  if (!r) return { title: 'Restaurant' };
  // Admin-set CMS meta title/description/OG image take precedence over the
  // restaurant's own fields.
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
    combos,
    topSellers,
    favRestaurant,
    isAuthed,
    rating
  } = await loadRestaurantPageData(slug);

  const menuHref = `/r/${slug}/menu`;
  const reserveHref = `/r/${slug}/reserve`;

  // Bestseller teaser copy — use the CMS overrides if the admin enabled the
  // section; otherwise fall back to sensible defaults so the strip still
  // tells the customer what they're looking at.
  const teaserEyebrow = cms.topSellers.enabled ? cms.topSellers.eyebrow : 'Most ordered here';
  const teaserHeading = cms.topSellers.enabled ? cms.topSellers.heading : 'What everyone keeps coming back for';

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
              containedInPlace: { '@type': 'AdministrativeArea', name: 'Andhra Pradesh' }
            },
            aggregateRating: { '@type': 'AggregateRating', ratingValue: rating, ratingCount: 200 }
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

      {/* ───────────────────────── Hero ───────────────────────── */}
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
          <div className="absolute top-4 right-4 z-10">
            <HeartButton
              restaurantId={restaurant.id}
              initial={Boolean(favRestaurant)}
              requireAuth={!isAuthed}
              variant="glass"
              label={favRestaurant ? 'Remove restaurant from favorites' : 'Add restaurant to favorites'}
            />
          </div>
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

      {/* ───────── Brand ribbon ───────── */}
      {restaurant.brand && (
        <BrandRibbon
          brandSlug={restaurant.brand.slug}
          brandName={restaurant.brand.name}
          siblingCount={siblingCuisineCount}
        />
      )}

      {/* ───────── Hero info card: open/eta/rating + delivery ETA ───────── */}
      <div className="space-y-3 px-3 md:px-0 md:space-y-0 pt-3 md:pt-0">
        <div className="md:container md:pt-4">
          <div className="glass border rounded-2xl p-3 md:p-4 flex items-center gap-4 md:gap-6 text-xs md:text-sm overflow-x-auto no-scrollbar">
            <div className="flex items-center gap-1.5 font-medium">
              <span className="relative inline-flex">
                <span className="size-2 rounded-full bg-success" />
                <span className="absolute inset-0 size-2 rounded-full bg-success pulse-soft" />
              </span>
              Open now
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground"><Clock className="size-4" /> ~35 min</div>
            <div className="flex items-center gap-1.5 text-muted-foreground"><Star className="size-4 fill-warning text-warning" /> {rating}</div>
            <div className="flex items-center gap-1.5 text-muted-foreground"><MapPin className="size-4" /> {branch.city}</div>
            <div className="flex items-center gap-1.5 text-muted-foreground"><ShieldCheck className="size-4 text-success" /> Verified</div>
          </div>
        </div>
        <div className="md:container md:pt-3">
          <DeliveryEtaCard
            branchId={branch.id}
            branchName={restaurant.name}
            branchCity={branch.city}
          />
        </div>
      </div>

      {/* ───────── PRIMARY ORDER NOW CTA ───────── */}
      <section className="container pt-6 pb-2">
        <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-5">
          <Button asChild size="lg" className="w-full md:w-auto md:min-w-56 text-base font-semibold shadow-lg">
            <Link href={menuHref}>
              Order Now
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
          {(restaurant as any).dineInEnabled && (
            <Link
              href={reserveHref}
              className="text-sm text-muted-foreground hover:text-primary underline-offset-4 hover:underline text-center md:text-left"
            >
              Or reserve a table
            </Link>
          )}
        </div>
      </section>

      {/* ───────── CMS: About + top content blocks ───────── */}
      <AboutSection about={cms.about} />
      <ContentBlocks blocks={cms.blocks} position="top" />

      {/* ───────── Bestseller TEASER strip (homepage version) ─────────
          A 4-card preview that links to the menu page. The FULL grid (with
          rank badges + sold-count footnotes) lives on /menu. */}
      {topSellers.length > 0 && (
        <section className="container py-8 border-t">
          <div className="mb-5 reveal flex items-end justify-between gap-3">
            <div>
              {teaserEyebrow && (
                <div className="text-xs font-semibold uppercase tracking-wider text-primary flex items-center gap-1.5">
                  <Flame className="size-3.5" /> {teaserEyebrow}
                </div>
              )}
              {teaserHeading && (
                <h2 className="display mt-1 text-xl md:text-2xl font-semibold">{teaserHeading}</h2>
              )}
            </div>
            <Link href={menuHref} className="hidden md:inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              View full menu <ArrowRight className="size-3.5" />
            </Link>
          </div>
          {/* Horizontal-scroll on mobile, 4-col grid on md+. */}
          <div className="flex md:grid md:grid-cols-4 gap-3 md:gap-4 overflow-x-auto no-scrollbar -mx-3 px-3 md:mx-0 md:px-0 reveal-stagger">
            {topSellers.slice(0, 4).map((t: any) => (
              <Link
                key={t.id}
                href={`${menuHref}#item-${t.id}`}
                className="shrink-0 w-44 md:w-auto group overflow-hidden rounded-2xl border bg-card card-lift tap-press"
              >
                <div className="relative aspect-video overflow-hidden">
                  <Image
                    src={t.imageUrl || FOOD_FALLBACK}
                    alt={t.name}
                    fill
                    sizes="(min-width: 768px) 25vw, 176px"
                    className="object-cover transition-transform duration-700 group-hover:scale-110"
                  />
                </div>
                <div className="p-3">
                  <div className="font-semibold text-sm truncate">{t.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground flex items-center gap-1">
                    <Flame className="size-3 text-primary" />
                    {t.soldCount} ordered in 30 days
                  </div>
                </div>
              </Link>
            ))}
            {/* CTA tile at the end of the strip — works as both the mobile
                fallback for the desktop "View full menu" link and a tappable
                tile in its own right. */}
            <Link
              href={menuHref}
              className="shrink-0 w-44 md:w-auto rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold p-4 transition-colors"
            >
              View full menu <ArrowRight className="ml-1 size-4" />
            </Link>
          </div>
        </section>
      )}

      {/* ───────── Combos TEASER (lean — up to 3, no add-to-cart) ───────── */}
      {cms.combos.enabled && combos.length > 0 && (
        <section className="container py-8 border-t">
          <div className="mb-5 reveal">
            {cms.combos.eyebrow && (
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">{cms.combos.eyebrow}</div>
            )}
            {cms.combos.heading && (
              <h2 className="display mt-1 text-xl md:text-2xl font-semibold">{cms.combos.heading}</h2>
            )}
          </div>
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 reveal-stagger">
            {combos.slice(0, 3).map((c: any) => (
              <Link
                key={c.id}
                href={menuHref}
                className="block overflow-hidden rounded-2xl border bg-card card-lift group"
              >
                <div className="relative h-40 bg-muted overflow-hidden">
                  <Image
                    src={c.imageUrl || COMBO_IMAGES[c.slug] || FOOD_FALLBACK}
                    alt={c.name}
                    fill
                    sizes="(min-width: 1024px) 33vw, 100vw"
                    className="object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  {cms.combos.showComboBadge && (
                    <Badge className="absolute top-3 left-3 bg-warning/95 text-warning-foreground border-transparent">Combo</Badge>
                  )}
                </div>
                <div className="p-4">
                  <div className="display text-base font-semibold group-hover:text-primary transition-colors">{c.name}</div>
                  {c.description && <div className="mt-1 text-sm text-muted-foreground line-clamp-2">{c.description}</div>}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ───────── SECONDARY ORDER NOW band ───────── */}
      <section className="container py-10">
        <div className="rounded-2xl border bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-6 md:p-8 text-center reveal">
          <h3 className="display text-xl md:text-2xl font-semibold">Ready to order? Tap below.</h3>
          <p className="mt-1 text-sm text-muted-foreground">Browse the full menu, customize your dish, and check out in seconds.</p>
          <div className="mt-5">
            <Button asChild size="lg" className="text-base font-semibold shadow-lg">
              <Link href={menuHref}>
                Order Now
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ───────── CMS: bottom content blocks ───────── */}
      <ContentBlocks blocks={cms.blocks} position="bottom" />

      {/* ───────── CMS: custom footer + social links ───────── */}
      <StorefrontFooter footerText={cms.footer.text} social={cms.social} />

      {/* ───────── FSSAI licence footer ───────── */}
      <FoodLicenseFooter
        licenseNumber={(branch as any).fssaiLicenseNumber}
        licenseImageUrl={(branch as any).fssaiLicenseImageUrl}
        holder={(branch as any).fssaiLicenseHolder}
      />
    </div>
  );
}
