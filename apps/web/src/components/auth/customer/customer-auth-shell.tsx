import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { MapPin, Wallet, RotateCcw } from 'lucide-react';
import { BrandMark } from '@/components/brand-mark';
import { brand } from '@/lib/brand';

/**
 * Layout for the customer sign-in screens (flavrly.in/login and the
 * restaurant-branded /r/<slug>/login).
 *
 * Mobile (most customers): a deep-berry brand hero on top, with the sign-in
 * card sliding up over it as a sheet — the form sits in the thumb zone.
 * Desktop: a two-column split — the brand panel on the left, the card on the
 * right. Colours come only from the brand tokens (berry, primary coral,
 * lime "pop"); the font is the app-wide Plus Jakarta Sans.
 */
export function CustomerAuthShell({
  children,
  restaurant,
  stats,
  homeHref = '/',
}: {
  children: ReactNode;
  /** Restaurant-branded variant: show its logo + name instead of the platform pitch. */
  restaurant?: { name: string; logoUrl: string | null; slug: string };
  stats?: { restaurantsLive: number; cuisinesCount: number };
  homeHref?: string;
}) {
  const title = restaurant ? `Order from ${restaurant.name}` : 'Hungry? Let’s get you in.';
  const subtitle = restaurant
    ? `Sign in to place your order with ${restaurant.name} on ${brand.name}.`
    : brand.tagline;

  return (
    <div className="lg:container lg:max-w-6xl lg:py-10">
      <div className="lg:grid lg:min-h-[640px] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-10">
        {/* ── Brand panel: full-bleed hero strip on mobile, rounded column on desktop ── */}
        <section
          aria-label={`${brand.name} sign in`}
          className="relative isolate overflow-hidden bg-berry px-5 pb-14 pt-7 text-white sm:px-8 lg:flex lg:flex-col lg:rounded-[32px] lg:px-12 lg:py-12"
        >
          <BrandGlow />
          <Link
            href={homeHref}
            className="relative hidden min-h-11 w-fit items-center rounded-lg text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 lg:inline-flex"
          >
            <BrandMark className="text-xl" />
          </Link>

          <div className="relative lg:mt-auto lg:max-w-lg">
            {restaurant?.logoUrl && (
              <div className="relative mb-4 size-16 overflow-hidden rounded-2xl bg-white shadow-xl ring-4 ring-white/20 lg:size-20">
                <Image src={restaurant.logoUrl} alt={`${restaurant.name} logo`} fill sizes="80px" className="object-cover" />
              </div>
            )}
            <h1 className="text-balance font-display text-[1.85rem] font-extrabold leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl">
              {title}
            </h1>
            <p className="mt-3 max-w-md text-base text-white/85 lg:text-lg">{subtitle}</p>
          </div>

          {/* Desktop-only value points + stats */}
          <div className="relative mt-10 hidden lg:block">
            <ul className="space-y-4">
              <ValuePoint Icon={MapPin} title="Live order tracking" text="Watch your rider on the map, right to your door." />
              <ValuePoint Icon={Wallet} title="Pay your way" text="UPI, cards or cash on delivery." />
              <ValuePoint Icon={RotateCcw} title="One-tap reorders" text="Your favourites, saved for next time." />
            </ul>
            {stats && !restaurant && (
              <dl className="mt-10 grid max-w-md grid-cols-2 gap-3">
                <Stat label="Restaurants live" value={String(stats.restaurantsLive)} />
                <Stat label="Cuisines" value={String(stats.cuisinesCount)} />
              </dl>
            )}
          </div>
        </section>

        {/* ── Sign-in card: a sheet over the hero on mobile, centred on desktop ── */}
        <div className="relative -mt-7 rounded-t-[28px] bg-background px-5 pb-10 pt-7 sm:px-8 lg:mt-0 lg:flex lg:items-center lg:justify-center lg:rounded-none lg:px-0 lg:py-0">
          <div className="mx-auto w-full max-w-md motion-safe:animate-slide-up lg:max-w-[460px] lg:rounded-[28px] lg:border lg:border-border/70 lg:bg-card lg:p-10 lg:shadow-[0_24px_60px_-28px_hsl(var(--berry)/0.35)]">{children}</div>
        </div>
      </div>
    </div>
  );
}

function ValuePoint({ Icon, title, text }: { Icon: typeof MapPin; title: string; text: string }) {
  return (
    <li className="flex items-start gap-3.5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
        <Icon className="size-5 text-pop" aria-hidden="true" />
      </span>
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-white/75">{text}</span>
      </span>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/15 backdrop-blur-sm">
      <dt className="text-xs font-medium uppercase tracking-wider text-white/70">{label}</dt>
      <dd className="mt-1 font-display text-3xl font-extrabold tabular-nums">{value}</dd>
    </div>
  );
}

/** Decorative coral / magenta / lime glows behind the berry panel. */
function BrandGlow() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
      <div className="absolute -right-24 -top-24 size-72 rounded-full bg-primary/55 blur-3xl lg:size-[28rem]" />
      <div className="absolute -bottom-28 -left-20 size-64 rounded-full bg-[#c026d3]/35 blur-3xl lg:size-96" />
      <div className="absolute bottom-10 right-10 hidden size-40 rounded-full bg-pop/20 blur-3xl lg:block" />
      <svg className="absolute inset-0 h-full w-full opacity-[0.07]" aria-hidden="true">
        <defs>
          <pattern id="flv-dots" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1.5" fill="white" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#flv-dots)" />
      </svg>
    </div>
  );
}
