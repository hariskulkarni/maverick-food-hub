/**
 * Brand (umbrella) landing — /brand/[slug]
 *
 * Customer-facing cuisine browser for a hospitality group that operates
 * multiple Restaurant rows ("cuisine concepts") under a single brand. Each
 * concept is still its own restaurant with its own menu, branches, offers and
 * happy hours — this page just lifts them up to one inviting umbrella so
 * customers can pick their cuisine before drilling into the storefront.
 *
 * Server-rendered. All data comes from `getBrandBySlug(slug)` so the heavy
 * lifting (dish counts, primary city, branch counts) happens in a single
 * round-trip — see `src/server/brands.ts`.
 */
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getBrandBySlug } from '@/server/brands';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CuisineCard } from './cuisine-card';
import { FOOD_FALLBACK } from '@/lib/food-images';
import {
  ShieldCheck,
  Utensils,
  MapPin,
  Mail,
  Phone,
  ArrowRight,
  Sparkles,
  Store
} from 'lucide-react';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  return { title: `${brand?.name ?? 'Brand'} — Reshee Tech` };
}

export default async function BrandPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) return notFound();

  // Roll-up stats for the strip under the hero. Computed in TS so the strip
  // never disagrees with the cards below (single source of truth).
  const cuisineCount = brand.cuisines.length;
  const totalDishes = brand.cuisines.reduce((s, c) => s + c.dishCount, 0);
  const totalBranches = brand.cuisines.reduce((s, c) => s + c.branchCount, 0);

  const heroImage = brand.coverImageUrl || brand.logoUrl || FOOD_FALLBACK;

  return (
    <div>
      {/* ───────────────────────── Brand Hero ───────────────────────── */}
      <section className="gradient-hero relative h-44 md:h-64 lg:h-80 overflow-hidden border-b">
        <Image
          src={heroImage}
          alt={brand.name}
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        {/* Saffron-tinted overlay so brand colours read consistently regardless of the photo. */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-primary/30 to-black/30" />
        <div className="pointer-events-none absolute -top-24 -right-24 size-80 rounded-full bg-warning/25 blur-3xl float-soft" />
        <div
          className="pointer-events-none absolute -bottom-24 -left-24 size-80 rounded-full bg-primary/25 blur-3xl float-soft"
          style={{ animationDelay: '1.2s' }}
        />

        {/* Floating brand logo */}
        {brand.logoUrl && (
          <div className="absolute left-4 md:left-10 bottom-[-32px] md:bottom-[-44px] size-20 md:size-28 rounded-2xl overflow-hidden border-4 border-background shadow-2xl bg-card z-10">
            <Image
              src={brand.logoUrl}
              alt={`${brand.name} logo`}
              fill
              sizes="(min-width: 768px) 112px, 80px"
              className="object-cover"
            />
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 container py-7 text-white reveal">
          <div className={brand.logoUrl ? 'md:pl-36' : ''}>
            <Badge className="bg-white/15 text-white border-white/30 backdrop-blur w-fit">
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="size-3" />
                Umbrella hospitality group
              </span>
            </Badge>
            <h1 className="display mt-3 text-4xl md:text-6xl font-semibold tracking-tight text-balance">
              {brand.name}
            </h1>
            {brand.tagline && (
              <p className="mt-2 text-base md:text-lg text-white/90 max-w-2xl">
                {brand.tagline}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ───────────────────────── Stat strip ───────────────────────── */}
      <div className="border-b bg-gradient-to-r from-primary/8 via-warning/5 to-primary/8 backdrop-blur">
        <div className={`container py-5 flex items-center flex-wrap gap-2 md:gap-3 ${brand.logoUrl ? 'md:pl-36' : ''}`}>
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs md:text-sm font-medium shadow-sm">
            <Utensils className="size-3.5 text-primary" />
            <span className="font-semibold text-foreground">{cuisineCount}</span>{' '}
            {cuisineCount === 1 ? 'cuisine' : 'cuisines'}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs md:text-sm font-medium shadow-sm">
            <Store className="size-3.5 text-primary" />
            <span className="font-semibold text-foreground">{totalDishes}</span>{' '}
            {totalDishes === 1 ? 'dish' : 'dishes'}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs md:text-sm font-medium shadow-sm">
            <MapPin className="size-3.5 text-primary" />
            <span className="font-semibold text-foreground">{totalBranches}</span>{' '}
            {totalBranches === 1 ? 'branch' : 'branches'}
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-success/10 text-success border border-success/30 px-3 py-1.5 text-xs md:text-sm font-medium">
            <ShieldCheck className="size-3.5" />
            Verified umbrella group
          </span>
        </div>
      </div>

      {/* ───────────────────────── Cuisine grid ───────────────────────── */}
      <section className="container py-12">
        <div className="mb-7 reveal">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary">
            The collection
          </div>
          <h2 className="display mt-1 text-3xl md:text-4xl font-semibold tracking-tight">
            Pick a cuisine, devour the rest later
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-xl">
            Each kitchen below is a fully-fledged restaurant on Reshee Tech —
            its own menu, its own offers, its own happy hours. Same family,
            different cravings.
          </p>
        </div>

        {brand.cuisines.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-muted/30 p-12 text-center">
            <div className="display text-lg font-semibold text-foreground">
              No active cuisines yet
            </div>
            <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
              {brand.name} is setting up its kitchens on Reshee Tech.
              Check back soon — we&apos;re onboarding their cuisines now.
            </p>
            <div className="mt-5">
              <Button asChild variant="outline" size="sm">
                <Link href="/restaurants">
                  Browse other restaurants
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          // 1 / 2 / 3 columns; auto-rows-fr keeps cards aligned when copy varies in length.
          <div className="grid gap-4 md:gap-5 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 auto-rows-fr reveal-stagger">
            {brand.cuisines.map((c) => (
              <CuisineCard
                key={c.id}
                slug={c.slug}
                name={c.name}
                cuisine={c.cuisine}
                dishCount={c.dishCount}
                branchCount={c.branchCount}
                primaryCity={c.primaryCity}
                coverImageUrl={c.coverImageUrl}
                logoUrl={c.logoUrl}
              />
            ))}
          </div>
        )}
      </section>

      {/* ───────────────────────── About this group ───────────────────────── */}
      {(brand.description || brand.contactEmail || brand.contactPhone) && (
        <section className="border-t bg-secondary/30">
          <div className="container py-12 grid gap-10 md:grid-cols-3">
            <div className="md:col-span-1 reveal">
              <div className="text-xs font-semibold uppercase tracking-wider text-primary">
                About this group
              </div>
              <h2 className="display mt-2 text-2xl md:text-3xl font-semibold tracking-tight">
                {brand.name}
              </h2>
              {brand.tagline && (
                <p className="mt-2 text-sm text-muted-foreground">{brand.tagline}</p>
              )}
            </div>

            <div className="md:col-span-2 reveal">
              {brand.description && (
                <div className="prose prose-sm max-w-none text-foreground/90 leading-relaxed whitespace-pre-line">
                  {brand.description}
                </div>
              )}

              {(brand.contactEmail || brand.contactPhone) && (
                <div className="mt-6 flex flex-wrap items-center gap-2">
                  {brand.contactEmail && (
                    <a
                      href={`mailto:${brand.contactEmail}`}
                      className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium hover:border-primary/40 hover:text-primary transition-colors"
                    >
                      <Mail className="size-3.5" />
                      {brand.contactEmail}
                    </a>
                  )}
                  {brand.contactPhone && (
                    <a
                      href={`tel:${brand.contactPhone}`}
                      className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium hover:border-primary/40 hover:text-primary transition-colors"
                    >
                      <Phone className="size-3.5" />
                      {brand.contactPhone}
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
