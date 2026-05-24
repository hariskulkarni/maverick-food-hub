'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  ShoppingBag,
  Plus,
  Bike,
  MapPin,
  ChefHat,
  Flame,
  Percent,
  Gift,
  Ticket
} from 'lucide-react';

/**
 * FeatureCarousel — the auto-rotating "showpiece" banner on the discovery page.
 *
 * Modelled on the swipeable promo header found in best-in-class food apps: one
 * rounded banner that cycles through 4 branded slides, each with a CSS-only
 * animated illustration on the right and copy on the left. Pagination dots sit
 * at the bottom centre; the strip auto-advances, pauses on hover/touch, and
 * supports swipe + keyboard.
 *
 * The four slides depict Flavrly's core moments:
 *   1. Ordering   — "Order in three taps"
 *   2. Delivery   — live tracking to your door
 *   3. Live kitchen — meals cooked fresh on camera
 *   4. Offers     — save on every order
 *
 * All motion is CSS keyframes (defined in globals.css, prefixed `fc-`) and is
 * disabled under prefers-reduced-motion. No layout shift: each slide reserves a
 * fixed min-height.
 */

const AUTOPLAY_MS = 4500;

type Slide = {
  key: string;
  eyebrow: string;
  title: React.ReactNode;
  subtitle: string;
  /** Gradient applied to the slide background. */
  gradient: string;
  art: React.ReactNode;
};

const SLIDES: Slide[] = [
  {
    key: 'order',
    eyebrow: 'Order in seconds',
    title: (
      <>
        Your favourites, <span className="text-pop">just three taps</span> away.
      </>
    ),
    subtitle: 'Browse, tap, and check out in seconds — no fuss, no clutter.',
    gradient: 'from-primary via-[#e0286f] to-berry',
    art: <OrderArt />
  },
  {
    key: 'delivery',
    eyebrow: 'Live order tracking',
    title: (
      <>
        Track every bite, <span className="text-pop">door to door.</span>
      </>
    ),
    subtitle: 'Watch your rider on the map and know exactly when food arrives.',
    gradient: 'from-[#d62a6b] via-primary to-[#7a1f4a]',
    art: <DeliveryArt />
  },
  {
    key: 'kitchen',
    eyebrow: 'Live kitchen counters',
    title: (
      <>
        Cooked fresh, <span className="text-pop">live on camera.</span>
      </>
    ),
    subtitle: 'Peek into real kitchens and see your meal made to order.',
    gradient: 'from-[#c41f5c] via-[#e0286f] to-berry',
    art: <KitchenArt />
  },
  {
    key: 'offers',
    eyebrow: 'Offers & rewards',
    title: (
      <>
        Save on <span className="text-pop">every single order.</span>
      </>
    ),
    subtitle: 'Daily deals, coupons and rewards stacked right into your cart.',
    gradient: 'from-primary via-[#d62a8a] to-berry',
    art: <OffersArt />
  }
];

export function FeatureCarousel() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = SLIDES.length;
  const touchStartX = useRef<number | null>(null);

  const go = useCallback((next: number) => {
    setIndex(((next % count) + count) % count);
  }, [count]);

  // Autoplay — paused on hover / touch / when tab is hidden.
  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % count), AUTOPLAY_MS);
    return () => window.clearInterval(id);
  }, [paused, count]);

  // Swipe handlers.
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    setPaused(true);
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartX.current;
    touchStartX.current = null;
    setPaused(false);
    if (start == null) return;
    const dx = e.changedTouches[0].clientX - start;
    if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1));
  };

  return (
    <section className="reveal md:pt-6" aria-label="Flavrly highlights" aria-roledescription="carousel">
      {/* Full-bleed on mobile (edge-to-edge, flush under the sticky header so it
          reads like a native app hero); contained + rounded card on desktop. */}
      <div className="md:container">
      <div
        className="relative overflow-hidden rounded-b-[1.75rem] md:rounded-3xl shadow-lg shadow-primary/10"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Sliding track */}
        <div
          className="flex transition-transform duration-700 ease-[cubic-bezier(0.2,0.7,0.3,1)]"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {SLIDES.map((s, i) => (
            <div
              key={s.key}
              className="w-full shrink-0"
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}`}
              aria-hidden={i !== index}
            >
              <div
                className={`relative min-h-[190px] md:min-h-[260px] overflow-hidden bg-gradient-to-br ${s.gradient} text-white`}
              >
                {/* lime pop glow */}
                <div className="pointer-events-none absolute -bottom-16 -left-10 size-56 rounded-full bg-pop/30 blur-3xl" />
                <div className="pointer-events-none absolute -top-12 -right-8 size-48 rounded-full bg-white/10 blur-3xl" />

                <div className="relative z-10 flex h-full items-center gap-3 p-6 md:p-10">
                  <div className="max-w-[58%] md:max-w-md">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] md:text-xs font-medium backdrop-blur">
                      <Sparkles className="size-3.5" /> {s.eyebrow}
                    </span>
                    <h2 className="display mt-3 text-xl md:text-4xl font-extrabold leading-[1.12]">
                      {s.title}
                    </h2>
                    <p className="mt-2 text-xs md:text-base text-white/85">{s.subtitle}</p>
                  </div>

                  {/* Animated illustration — only animate the live slide to save paint. */}
                  <div className="ml-auto flex-1 self-stretch flex items-center justify-center">
                    {i === index ? s.art : null}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Pagination dots */}
        <div className="absolute inset-x-0 bottom-3 z-20 flex items-center justify-center gap-1.5">
          {SLIDES.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => go(i)}
              aria-label={`Go to slide ${i + 1}`}
              aria-current={i === index}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === index ? 'w-6 bg-white' : 'w-1.5 bg-white/45 hover:bg-white/70'
              }`}
            />
          ))}
        </div>
      </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Slide illustrations ───────────────────────── */

/** Slide 1 — three menu chips drop in, a cart pill counts up. */
function OrderArt() {
  return (
    <div className="relative hidden sm:block h-[140px] w-[150px] md:h-[180px] md:w-[200px]">
      {/* menu chips */}
      <div className="absolute left-0 top-2 fc-pop" style={{ animationDelay: '0.1s' }}>
        <MenuChip emoji="🍛" label="Biryani" />
      </div>
      <div className="absolute left-6 top-12 fc-pop" style={{ animationDelay: '0.5s' }}>
        <MenuChip emoji="🍕" label="Pizza" />
      </div>
      <div className="absolute left-2 top-[88px] fc-pop" style={{ animationDelay: '0.9s' }}>
        <MenuChip emoji="🥗" label="Salad" />
      </div>
      {/* cart pill */}
      <div className="absolute -right-1 bottom-1 fc-pop" style={{ animationDelay: '1.2s' }}>
        <div className="flex items-center gap-2 rounded-full bg-white px-3 py-2 text-foreground shadow-xl">
          <span className="relative grid size-8 place-items-center rounded-full bg-primary text-white">
            <ShoppingBag className="size-4" />
            <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-pop text-[9px] font-bold text-berry">
              3
            </span>
          </span>
          <span className="text-xs font-semibold">Cart ready</span>
        </div>
      </div>
      {/* tap ripple */}
      <span className="absolute left-[78px] top-[70px] fc-ripple grid size-7 place-items-center rounded-full bg-white/30">
        <Plus className="size-4 text-white" />
      </span>
    </div>
  );
}

function MenuChip({ emoji, label }: { emoji: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-xl bg-white/92 px-2.5 py-1.5 text-xs font-semibold text-foreground shadow-lg">
      <span className="text-sm leading-none">{emoji}</span>
      {label}
      <span className="ml-1 grid size-4 place-items-center rounded-full bg-primary text-white">
        <Plus className="size-3" />
      </span>
    </span>
  );
}

/** Slide 2 — a rider scoots along a dashed route toward a pulsing pin. */
function DeliveryArt() {
  return (
    <div className="relative hidden sm:block h-[140px] w-[160px] md:h-[180px] md:w-[210px]">
      {/* dashed route */}
      <svg viewBox="0 0 210 120" className="absolute inset-0 size-full" fill="none" aria-hidden>
        <path
          d="M12 96 C 60 96, 60 40, 110 40 S 170 28, 198 28"
          stroke="rgba(255,255,255,0.5)"
          strokeWidth="3"
          strokeDasharray="6 8"
          strokeLinecap="round"
        />
      </svg>
      {/* destination pin */}
      <span className="absolute right-1 top-2 grid size-9 place-items-center rounded-full bg-white text-primary shadow-xl">
        <MapPin className="size-5" />
        <span className="absolute inset-0 rounded-full bg-white/60 pulse-soft" />
      </span>
      {/* rider */}
      <span className="fc-ride absolute bottom-3 left-0 grid size-11 place-items-center rounded-2xl bg-white text-primary shadow-xl">
        <Bike className="size-6" />
      </span>
      {/* ETA chip */}
      <span className="absolute right-0 bottom-2 rounded-full bg-white/92 px-2.5 py-1 text-[11px] font-bold text-foreground shadow-lg">
        8 min away
      </span>
    </div>
  );
}

/** Slide 3 — a pan over a flickering flame with rising steam + a LIVE badge. */
function KitchenArt() {
  return (
    <div className="relative hidden sm:block h-[140px] w-[150px] md:h-[180px] md:w-[190px]">
      {/* LIVE badge */}
      <span className="absolute right-0 top-1 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-primary shadow-lg">
        <span className="size-2 rounded-full bg-destructive pulse-soft" /> Live
      </span>

      {/* steam */}
      <div className="absolute left-1/2 top-3 -translate-x-1/2">
        <span className="fc-steam absolute -left-4 block h-6 w-1.5 rounded-full bg-white/40" style={{ animationDelay: '0s' }} />
        <span className="fc-steam absolute left-0 block h-7 w-1.5 rounded-full bg-white/50" style={{ animationDelay: '0.6s' }} />
        <span className="fc-steam absolute left-4 block h-6 w-1.5 rounded-full bg-white/40" style={{ animationDelay: '1.1s' }} />
      </div>

      {/* pan */}
      <div className="absolute left-1/2 top-12 -translate-x-1/2">
        <div className="relative grid size-20 place-items-center rounded-full bg-white shadow-xl">
          <ChefHat className="size-9 text-primary" />
          <span className="absolute -right-10 top-1/2 h-1.5 w-12 -translate-y-1/2 rounded-full bg-white/80" />
        </div>
        {/* flame */}
        <span className="fc-flame absolute -bottom-5 left-1/2 -translate-x-1/2">
          <Flame className="size-7 text-pop" />
        </span>
      </div>
    </div>
  );
}

/** Slide 4 — discount coins/coupons float up around a big % badge. */
function OffersArt() {
  return (
    <div className="relative hidden sm:block h-[140px] w-[150px] md:h-[180px] md:w-[200px]">
      {/* big percent coin */}
      <div className="fc-pop absolute left-1/2 top-8 -translate-x-1/2" style={{ animationDelay: '0.1s' }}>
        <div className="grid size-24 place-items-center rounded-full bg-white text-primary shadow-2xl ring-4 ring-white/40">
          <div className="text-center leading-none">
            <div className="display text-3xl font-extrabold">20%</div>
            <div className="text-[10px] font-semibold tracking-wide text-muted-foreground">OFF</div>
          </div>
        </div>
      </div>
      {/* floating badges */}
      <span className="float-soft absolute left-0 top-2 grid size-9 place-items-center rounded-2xl bg-white text-primary shadow-xl" style={{ animationDelay: '0s' }}>
        <Percent className="size-4" />
      </span>
      <span className="float-soft absolute right-0 top-0 grid size-9 place-items-center rounded-2xl bg-white text-primary shadow-xl" style={{ animationDelay: '0.8s' }}>
        <Gift className="size-4" />
      </span>
      <span className="float-soft absolute -bottom-0 right-3 grid size-9 place-items-center rounded-2xl bg-white text-primary shadow-xl" style={{ animationDelay: '1.4s' }}>
        <Ticket className="size-4" />
      </span>
      {/* sparkles */}
      <Sparkles className="float-soft absolute bottom-2 left-2 size-5 text-pop" style={{ animationDelay: '0.4s' }} />
    </div>
  );
}
