/**
 * /dine-in — global "Reserve a table" landing.
 *
 * The Dine In tab in the mobile bottom nav points here. Unlike /restaurants
 * (delivery discovery), this surface lists ONLY restaurants that accept table
 * reservations (`dineInEnabled = true`) and sends the customer straight to each
 * restaurant's booking page (/r/<slug>/reserve). Reservation perks (bill
 * discount + deposit credit) are surfaced on each card so the value of booking
 * ahead is obvious before the customer commits to one restaurant.
 *
 * Server component. No location gating — you travel TO the restaurant to dine
 * in, so delivery-radius filtering doesn't apply; we show every dine-in venue
 * in the curated order, annotated with its city.
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { UtensilsCrossed, MapPin, ChefHat, BadgePercent, Wallet, Clock, CalendarCheck } from 'lucide-react';
import { FOOD_FALLBACK } from '@/lib/food-images';
import { ImageWithFallback } from '@/components/image-with-fallback';
import { parseStorefrontConfig } from '@/server/storefront-cms';

export const metadata: Metadata = {
  title: 'Reserve a table',
  description: 'Book a table at restaurants near you and get perks for dining in.',
};

// Reservation availability is an admin toggle that can change any time — never
// cache the list, so a freshly enabled (or disabled) venue shows up correctly.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function DineInLandingPage() {
  const restaurants = await prisma.restaurant.findMany({
    where: { status: 'ACTIVE', dineInEnabled: true },
    select: {
      id: true,
      slug: true,
      name: true,
      tagline: true,
      cuisine: true,
      coverImageUrl: true,
      logoUrl: true,
      storefrontConfig: true,
      reservationDiscountPct: true,
      reservationDeposit: true,
      reservationDurationMin: true,
      branches: {
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { city: true },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
  });

  const cards = restaurants.map((r) => {
    const cfg = parseStorefrontConfig(r.storefrontConfig);
    const cmsHero =
      cfg.hero?.type === 'carousel' && cfg.hero.slides[0]?.src ? cfg.hero.slides[0].src : null;
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      tagline: r.tagline,
      cuisine: r.cuisine,
      imageUrl: cmsHero || r.coverImageUrl || r.logoUrl || FOOD_FALLBACK,
      city: r.branches[0]?.city ?? null,
      discountPct: r.reservationDiscountPct,
      deposit: Number(r.reservationDeposit),
      durationMin: r.reservationDurationMin,
    };
  });

  return (
    <div className="container pt-4 md:pt-6 pb-10">
      <header className="mb-6 md:mb-8 reveal">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
          <UtensilsCrossed className="size-3.5" /> Dine in
        </div>
        <h1 className="display text-2xl md:text-3xl font-semibold tracking-tight mt-1">Reserve a table</h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-prose">
          Book ahead at a restaurant near you. Your deposit is credited to the bill, and many venues
          give you a discount just for reserving your table in advance.
        </p>
      </header>

      {cards.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/30 p-10 text-center">
          <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <CalendarCheck className="size-6" />
          </div>
          <p className="font-medium">No restaurants are taking reservations yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Check back soon, or{' '}
            <Link href="/restaurants" className="text-primary underline">
              browse all restaurants
            </Link>{' '}
            to order for delivery.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 reveal-stagger">
          {cards.map((r) => (
            <Card key={r.id} className="overflow-hidden h-full flex flex-col card-lift rounded-2xl md:rounded-xl">
              <Link href={`/r/${r.slug}/reserve`} className="group block tap-press">
                <div className="relative aspect-[16/9] md:aspect-[4/3] bg-muted overflow-hidden">
                  <ImageWithFallback
                    src={r.imageUrl}
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
                  {r.discountPct > 0 && (
                    <Badge className="absolute top-3 right-3 bg-primary text-primary-foreground">
                      <BadgePercent className="size-3" /> {r.discountPct}% off
                    </Badge>
                  )}
                </div>
              </Link>

              <CardContent className="p-4 md:p-5 flex flex-1 flex-col">
                <Link href={`/r/${r.slug}/reserve`} className="group block tap-press">
                  <div className="display text-base md:text-lg font-semibold group-hover:text-primary transition-colors">
                    {r.name}
                  </div>
                </Link>
                {r.tagline && <p className="mt-1 text-xs md:text-sm text-muted-foreground line-clamp-2">{r.tagline}</p>}

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  {r.city && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                      <MapPin className="size-3" /> {r.city}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                    <ChefHat className="size-3" /> {r.cuisine ?? 'Multi-cuisine'}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                    <Clock className="size-3" /> {r.durationMin} min table
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {r.discountPct > 0 && (
                    <span className="inline-flex items-center gap-1 text-primary font-medium">
                      <BadgePercent className="size-3.5" /> {r.discountPct}% off your bill
                    </span>
                  )}
                  {r.deposit > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Wallet className="size-3.5" /> ₹{r.deposit} deposit, credited back
                    </span>
                  )}
                </div>

                <div className="mt-4 pt-1 mt-auto">
                  <Button asChild className="w-full">
                    <Link href={`/r/${r.slug}/reserve`}>
                      <CalendarCheck className="size-4" /> Reserve a table
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
