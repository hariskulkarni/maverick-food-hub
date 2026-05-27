import Link from 'next/link';
import Image from 'next/image';
import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BrandMark } from '@/components/brand-mark';
import { RestaurantAcquisitionGrid } from '@/components/landing/restaurant-acquisition';
import { RiderAcquisition } from '@/components/landing/rider-acquisition';
import { HeroStage } from '@/components/hero/hero-stage';
import { HeroPulse } from '@/components/landing/hero-pulse';
import {
  ChefHat,
  ArrowRight,
  MapPin,
  ClipboardList,
  CheckCircle2,
  UtensilsCrossed,
  PackageCheck,
  Search,
  ShoppingBag,
  Navigation,
  Wallet,
  ShieldCheck,
  Timer
} from 'lucide-react';
import { brand } from '@/lib/brand';
import { FOOD_FALLBACK } from '@/lib/food-images';
import { JsonLd } from '@/components/seo/json-ld';

const SITE = 'https://flavrly.in';

// Render per-request. This page reads live counts from the DB, so it must NOT be
// statically pre-rendered at build time — otherwise `next build` connects to the
// database, and a momentary DB blip during a deploy fails the whole build (which
// leaves a broken .next / missing required-server-files.json). Dynamic rendering
// keeps the build DB-independent and the home counts always fresh.
export const dynamic = 'force-dynamic';

/**
 * Reshee Tech — platform home (marketing surface).
 *
 * This page introduces the platform to all three sides of the marketplace:
 * customers who order, restaurants who cook, and riders who deliver. The hero
 * leads with the restaurant story (the side we're actively onboarding), but
 * every audience gets a clear path:
 *   • customers  → "How ordering works" + browse restaurants
 *   • restaurants → "List your restaurant" CTA + How it works steps
 *   • riders     → the RiderAcquisition strip
 *
 * Ordering itself happens on a restaurant's storefront (`/r/<slug>`), reached
 * by browsing `/restaurants` or scanning a kitchen's QR code — so the home page
 * carries no cart of its own.
 */
export default async function HomePage() {
  const [restaurants, totalActive, ridersTotal, ridersOnline] = await Promise.all([
    prisma.restaurant.findMany({
      where: { status: 'ACTIVE' },
      take: 8,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { branches: true } },
        branches: { take: 1, orderBy: { createdAt: 'asc' }, select: { city: true } }
      }
    }),
    prisma.restaurant.count({ where: { status: 'ACTIVE' } }),
    prisma.riderProfile.count(),
    prisma.riderProfile.count({ where: { isOnline: true } })
  ]);

  // Riders strip wants the more flattering number when online riders is sparse.
  const ridersDisplay = ridersOnline > 0 ? ridersOnline : ridersTotal;

  return (
    <div>
      <JsonLd
        data={[
          {
            '@context': 'https://schema.org',
            '@type': 'Organization',
            name: brand.name,
            url: SITE,
            slogan: brand.tagline,
            logo: `${SITE}/icon-512.png`,
            telephone: brand.supportPhone,
            areaServed: {
              '@type': 'City',
              name: 'Guntur',
              containedInPlace: {
                '@type': 'AdministrativeArea',
                name: 'Andhra Pradesh'
              }
            },
            address: {
              '@type': 'PostalAddress',
              addressLocality: 'Guntur',
              addressRegion: 'Andhra Pradesh',
              addressCountry: 'IN'
            }
          },
          {
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: brand.name,
            url: SITE,
            description: brand.tagline,
            potentialAction: {
              '@type': 'SearchAction',
              target: {
                '@type': 'EntryPoint',
                urlTemplate: `${SITE}/restaurants?q={search_term_string}`
              },
              'query-input': 'required name=search_term_string'
            }
          }
        ]}
      />
      {/* ────────────────────────── Hero ────────────────────────── */}
      <section className="gradient-hero relative overflow-hidden border-b">
        {/* Living animated gradient mesh — the premium, breathing backdrop. */}
        <div className="gradient-mesh pointer-events-none absolute inset-0 -z-10" aria-hidden />

        <div className="pointer-events-none absolute -top-24 -right-24 size-80 rounded-full bg-primary/15 blur-3xl float-soft" />
        <div
          className="pointer-events-none absolute top-1/2 -left-20 size-72 rounded-full bg-pop/30 blur-3xl float-soft"
          style={{ animationDelay: '1.2s' }}
        />
        <div
          className="pointer-events-none absolute -bottom-24 right-1/4 size-72 rounded-full bg-berry/15 blur-3xl float-soft"
          style={{ animationDelay: '2.1s' }}
        />

        <div className="container relative py-16 md:py-24 lg:py-28">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10">
            {/* Copy column — centered on mobile, left-aligned beside the
                showpiece on desktop. */}
            <div className="reveal-stagger text-center lg:text-left">
              <Badge variant="default" className="w-fit mx-auto lg:mx-0 float-soft">
                <span className="inline-flex items-center gap-1.5">
                  <span className="relative inline-flex">
                    <span className="size-2 rounded-full bg-white" />
                    <span className="absolute inset-0 size-2 rounded-full bg-white/80 pulse-soft" />
                  </span>
                  Now onboarding kitchens & riders
                </span>
              </Badge>

              <h1 className="display mt-6 text-4xl font-bold tracking-tight md:text-6xl text-balance leading-[1.05]">
                <span className="block text-foreground/90">Run your kitchen on</span>
                <BrandMark
                  variant="hero"
                  className="text-5xl md:text-7xl mt-1 justify-center lg:justify-start"
                />
              </h1>

              {/* Body copy: 14px on mobile, 18px on tablet+. Tightens info
                  density on a phone. */}
              <p className="mt-6 text-sm md:text-lg text-muted-foreground max-w-xl mx-auto lg:mx-0">
                Get your kitchen online in 10 minutes. We bring you orders, our riders deliver,
                you cook.
              </p>

              <div className="mt-8 flex flex-wrap items-center justify-center lg:justify-start gap-3">
                <Button size="lg" asChild className="group">
                  <Link href="/signup/restaurant">
                    List your restaurant
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </Button>
                {/* Secondary CTA hidden below the fold on mobile so the hero
                    reads as a single decisive action — bottom nav + the rider
                    card further down still pick this up. */}
                <Button size="lg" variant="outline" asChild className="group hidden md:inline-flex">
                  <Link href="/signup/rider">
                    Become a rider
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </Button>
              </div>

              <p className="mt-4 text-sm text-muted-foreground">
                Already a partner?{' '}
                <Link href="/login?role=staff" className="text-primary font-medium hover:underline">
                  Sign in
                </Link>
                .
              </p>
            </div>

            {/* Showpiece — order-flow device, floating dish chips, optional
                /hero.mp4. Looks great with no video asset present. */}
            <div className="reveal order-first lg:order-none">
              <HeroStage />
            </div>
          </div>

          {/* Dynamic, "alive" stats element — replaces the old static strip.
              Word-cycler + count-up numbers, all motion-aware. */}
          <HeroPulse restaurants={totalActive} riders={ridersDisplay} />
        </div>
      </section>

      {/* ────────────────────────── For customers ────────────────────────── */}
      <section id="for-customers" className="border-b bg-secondary/40">
        <div className="container py-20">
          <div className="text-center mb-12 reveal">
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">
              For customers
            </div>
            <h2 className="display mt-2 text-3xl md:text-5xl font-semibold tracking-tight">
              Hungry? Order in three taps.
            </h2>
            <p className="mt-3 text-sm md:text-base text-muted-foreground max-w-xl mx-auto">
              Browse every kitchen near you, build your order, and track the rider to your
              door — all in one place.
            </p>
          </div>

          <ol className="grid gap-6 md:grid-cols-3 reveal-stagger">
            {[
              {
                icon: Search,
                title: 'Find a kitchen',
                body: 'Browse restaurants near you by cuisine, rating or delivery time. Or open a kitchen straight from its QR code.'
              },
              {
                icon: ShoppingBag,
                title: 'Build your order',
                body: 'Add dishes to your cart, apply a coupon, pay securely online or with cash on delivery. No app download needed.'
              },
              {
                icon: Navigation,
                title: 'Track to your door',
                body: 'Watch your order go from kitchen to rider to doorstep on a live map — with an honest ETA the whole way.'
              }
            ].map(({ icon: Icon, title, body }) => (
              <li key={title} className="rounded-2xl bg-card p-7 border card-lift list-none">
                <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <Icon className="size-6" />
                </div>
                <h3 className="display text-xl font-semibold mt-5">{title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{body}</p>
              </li>
            ))}
          </ol>

          <div className="mt-10 grid gap-4 sm:grid-cols-3 reveal-stagger">
            {[
              { icon: Timer, label: '~35 min average delivery, with a live ETA you can trust' },
              { icon: Wallet, label: 'Pay online or cash on delivery — your call, every time' },
              { icon: ShieldCheck, label: 'FSSAI-verified kitchens and contactless drop-off' }
            ].map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex items-start gap-3 rounded-2xl border bg-card/60 p-4"
              >
                <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-success/10 text-success">
                  <Icon className="size-4.5" />
                </div>
                <span className="text-sm text-muted-foreground leading-snug">{label}</span>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" asChild className="group">
              <Link href="/restaurants">
                Browse restaurants
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/track">Track an order</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ────────────────────────── Why Reshee Tech ────────────────────────── */}
      <section className="container py-20">
        <div className="text-center mb-12 reveal">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary">
            For restaurants
          </div>
          <h2 className="display mt-2 text-3xl md:text-5xl font-semibold tracking-tight">
            Everything your kitchen needs, none of the overhead.
          </h2>
          <p className="mt-3 text-sm md:text-base text-muted-foreground max-w-xl mx-auto">
            We handle the storefront, the riders and the payments. You just cook.
          </p>
        </div>

        <RestaurantAcquisitionGrid />
      </section>

      {/* ────────────────────────── How it works ────────────────────────── */}
      <section id="how-it-works" className="border-y bg-secondary/40">
        <div className="container py-20">
          <div className="text-center mb-14 reveal">
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">
              How it works
            </div>
            <h2 className="display mt-2 text-3xl md:text-5xl font-semibold tracking-tight">
              Live in four steps.
            </h2>
            <p className="mt-3 text-sm md:text-base text-muted-foreground max-w-xl mx-auto">
              From application to first order in roughly a day.
            </p>
          </div>

          <ol className="grid gap-6 md:grid-cols-4 reveal-stagger">
            {[
              {
                step: '01',
                icon: ClipboardList,
                title: 'Apply',
                body: 'Tell us about your kitchen, your menu and where you cook. Takes about 10 minutes.'
              },
              {
                step: '02',
                icon: CheckCircle2,
                title: 'Get approved',
                body: 'Our partner team reviews your application. Typical approval is around one day.'
              },
              {
                step: '03',
                icon: UtensilsCrossed,
                title: 'Set your menu',
                body: 'Upload dishes, set prices, add photos. Pause, edit and re-price any time.'
              },
              {
                step: '04',
                icon: PackageCheck,
                title: 'Receive orders',
                body: 'Orders land on your dashboard. Cook, mark ready — our riders handle delivery.'
              }
            ].map(({ step, icon: Icon, title, body }) => (
              <li
                key={step}
                className="relative rounded-2xl bg-card p-7 border card-lift list-none"
              >
                <div className="absolute -top-4 -left-4 grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg ring-saffron">
                  <Icon className="size-6" />
                </div>
                <div className="absolute top-4 right-5 text-xs font-mono text-muted-foreground/70 tracking-wider">
                  STEP {step}
                </div>
                <h3 className="display text-xl font-semibold mt-6">{title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ─────────────── Featured kitchens (social proof, not a menu) ─────────────── */}
      <section className="container py-20">
        <div className="text-center mb-10 reveal">
          <div className="text-xs font-semibold uppercase tracking-wider text-primary">
            Trusted partners
          </div>
          <h2 className="display mt-2 text-3xl md:text-5xl font-semibold tracking-tight">
            Now serving from these kitchens
          </h2>
          <p className="mt-3 text-sm text-muted-foreground max-w-md mx-auto">
            Some of the restaurants already running on Reshee Tech. Tap a card to see their
            storefront.
          </p>
        </div>

        {restaurants.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-muted/30 p-12 text-center text-muted-foreground">
            No partner kitchens yet.{' '}
            <Link href="/signup/restaurant" className="text-primary font-medium underline">
              Be the first to list
            </Link>
            .
          </div>
        ) : (
          <>
            {/* Mobile: 1.1-card peek carousel — snap-x mandatory + min-w-[80%]
                per card so the next card always teases at the right edge.
                Negative inset matches container padding so the rail goes
                edge-to-edge. */}
            <div className="md:hidden -mx-4 overflow-x-auto no-scrollbar snap-x snap-mandatory">
              <div className="flex gap-4 px-4 pb-1">
                {restaurants.map((r) => {
                  const city = r.branches[0]?.city;
                  return (
                    <Card
                      key={r.id}
                      className="overflow-hidden border-border/70 card-lift shrink-0 snap-start min-w-[80%] rounded-2xl"
                    >
                      <div className="relative aspect-[16/9] bg-muted overflow-hidden">
                        <Image
                          src={r.coverImageUrl || r.logoUrl || FOOD_FALLBACK}
                          alt={r.name}
                          fill
                          loading="lazy"
                          sizes="80vw"
                          className="object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />
                        {r.cuisine && (
                          <Badge
                            variant="muted"
                            className="absolute top-3 left-3 bg-white/95 text-foreground backdrop-blur"
                          >
                            {r.cuisine}
                          </Badge>
                        )}
                      </div>
                      <CardContent className="p-4">
                        <div className="display text-base font-semibold">{r.name}</div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                          {r.cuisine && (
                            <span className="inline-flex items-center gap-1">
                              <ChefHat className="size-3" />
                              {r.cuisine}
                            </span>
                          )}
                          {city && (
                            <span className="inline-flex items-center gap-1">
                              <MapPin className="size-3" />
                              {city}
                            </span>
                          )}
                        </div>
                        <Link
                          href={`/r/${r.slug}`}
                          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 group"
                        >
                          Visit storefront
                          <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                        </Link>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>

            {/* Desktop / tablet grid */}
            <div className="hidden md:grid gap-5 md:grid-cols-2 lg:grid-cols-4 reveal-stagger">
              {restaurants.map((r) => {
                const city = r.branches[0]?.city;
                return (
                  <Card
                    key={r.id}
                    className="overflow-hidden border-border/70 card-lift h-full md:rounded-xl"
                  >
                    <div className="relative h-36 bg-muted overflow-hidden">
                      <Image
                        src={r.coverImageUrl || r.logoUrl || FOOD_FALLBACK}
                        alt={r.name}
                        fill
                        loading="lazy"
                        sizes="(min-width: 1024px) 25vw, 50vw"
                        className="object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />
                      {r.cuisine && (
                        <Badge
                          variant="muted"
                          className="absolute top-3 left-3 bg-white/95 text-foreground backdrop-blur"
                        >
                          {r.cuisine}
                        </Badge>
                      )}
                    </div>

                    <CardContent className="p-4">
                      <div className="display text-base font-semibold">{r.name}</div>
                      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                        {r.cuisine && (
                          <span className="inline-flex items-center gap-1">
                            <ChefHat className="size-3" />
                            {r.cuisine}
                          </span>
                        )}
                        {city && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="size-3" />
                            {city}
                          </span>
                        )}
                      </div>
                      <Link
                        href={`/r/${r.slug}`}
                        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 group"
                      >
                        Visit storefront
                        <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* ────────────────────────── For riders ────────────────────────── */}
      <RiderAcquisition />

      {/* ────────────────────────── FAQ ────────────────────────── */}
      <section id="faq" className="container py-20">
        <div className="grid gap-10 md:grid-cols-3">
          <div className="md:col-span-1 reveal">
            <div className="text-xs font-semibold uppercase tracking-wider text-primary">FAQ</div>
            <h2 className="display mt-2 text-3xl md:text-4xl font-semibold tracking-tight">
              Partner questions, answered.
            </h2>
            <p className="mt-3 text-sm text-muted-foreground max-w-sm">
              Looking for help with an order? See the{' '}
              <Link href="/faq" className="text-primary underline">
                full Help &amp; FAQ
              </Link>{' '}
              or{' '}
              <Link href="/contact" className="text-primary underline">
                get in touch
              </Link>
              .
            </p>
          </div>

          <div className="md:col-span-2 reveal-stagger">
            {[
              {
                q: "What does Reshee Tech charge?",
                a: 'Listing is free. There is no monthly fee and no setup cost. We charge a small commission only on orders we successfully deliver to your customers — so we win when you win.'
              },
              {
                q: 'Who delivers my orders?',
                a: 'Our platform rider pool handles every delivery. You never need to hire delivery staff, manage shifts or run your own logistics. The moment you mark an order ready, the nearest rider is dispatched automatically.'
              },
              {
                q: 'How long does approval take?',
                a: 'Most kitchens are approved within one business day of submitting a complete application. We verify your FSSAI licence, GST details and the basics on your kitchen address — then turn you on.'
              },
              {
                q: 'Can I pause orders?',
                a: 'Yes — instantly. Your dashboard has a one-tap "Pause orders" switch for busy periods, staff shortages or unplanned closures. Resume the moment you are ready again, no escalation needed.'
              },
              {
                q: 'How do I get paid?',
                a: 'Payouts are calculated automatically and settled directly to your registered bank account on a weekly cycle, with a real-time ledger in your dashboard showing every order, commission and net amount.'
              }
            ].map(({ q, a }, i) => (
              <details
                key={q}
                className="group border-b border-border/80 py-5 transition-colors hover:border-primary/40"
                {...(i === 0 ? { open: true } : {})}
              >
                <summary className="flex cursor-pointer items-center justify-between gap-4 list-none">
                  <span className="display text-lg font-medium pr-4">{q}</span>
                  <span className="grid size-8 place-items-center rounded-full border bg-card text-muted-foreground transition-all group-open:bg-primary group-open:text-primary-foreground group-open:rotate-45">
                    <svg
                      viewBox="0 0 24 24"
                      className="size-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden="true"
                    >
                      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                    </svg>
                  </span>
                </summary>
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed max-w-2xl">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
