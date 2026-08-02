'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Percent, Tag, Gift, Sparkles, ChevronLeft, ChevronRight } from 'lucide-react';

export interface TopOffer {
  id: string;
  name: string;
  type: string;
  code: string | null;
  percentOff: number | null;
  flatOff: number | null;
}

/** Short headline value for a "Top offers today" tile. */
function offerValue(o: TopOffer): string {
  if (o.percentOff && o.percentOff > 0) return `${o.percentOff}% OFF`;
  if (o.flatOff && o.flatOff > 0) return `₹${o.flatOff} OFF`;
  if (o.type === 'BUY_X_GET_Y') return 'Buy 1 Get 1';
  if (o.type === 'FREE_ITEM_ABOVE') return 'Free item';
  if (o.type === 'COMBO_DISCOUNT') return 'Combo deal';
  return 'Special offer';
}

function offerIcon(o: TopOffer) {
  if (o.percentOff && o.percentOff > 0) return Percent;
  if (o.type === 'BUY_X_GET_Y' || o.type === 'FREE_ITEM_ABOVE' || o.type === 'COMBO_DISCOUNT') return Gift;
  return Tag;
}

/**
 * "Top offers today" carousel for /restaurants. A swipeable, snap-scrolling
 * track of offer cards with desktop prev/next arrows (disabled at the ends) and
 * gentle autoplay that loops. Autoplay pauses on hover / focus / touch and is
 * suppressed under prefers-reduced-motion (WCAG). Cards match the original strip.
 */
export function TopOffersCarousel({
  heading,
  subheading,
  offers,
}: {
  heading: string;
  subheading?: string | null;
  offers: TopOffer[];
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const pausedRef = useRef(false);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const update = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 4);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [update]);

  const page = useCallback((dir: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.85), behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (offers.length <= 1) return;
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const id = setInterval(() => {
      if (pausedRef.current) return;
      const el = trackRef.current;
      if (!el) return;
      if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 4) {
        el.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        el.scrollBy({ left: Math.round(el.clientWidth * 0.85), behavior: 'smooth' });
      }
    }, 4500);
    return () => clearInterval(id);
  }, [offers.length]);

  return (
    <section
      className="mb-6 reveal"
      aria-roledescription="carousel"
      aria-label={heading}
      onMouseEnter={() => { pausedRef.current = true; }}
      onMouseLeave={() => { pausedRef.current = false; }}
      onFocusCapture={() => { pausedRef.current = true; }}
      onBlurCapture={() => { pausedRef.current = false; }}
      onTouchStart={() => { pausedRef.current = true; }}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
          <Sparkles className="size-3.5" /> {heading}
        </div>
        <div className="hidden items-center gap-1.5 md:flex">
          <button
            type="button"
            aria-label="Previous offers"
            disabled={!canPrev}
            onClick={() => page(-1)}
            className="grid size-8 place-items-center rounded-full border bg-card text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Next offers"
            disabled={!canNext}
            onClick={() => page(1)}
            className="grid size-8 place-items-center rounded-full border bg-card text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
      {subheading && <p className="-mt-1 mb-3 text-sm text-muted-foreground">{subheading}</p>}
      <div
        ref={trackRef}
        className="no-scrollbar -mx-4 snap-x snap-mandatory overflow-x-auto scroll-smooth md:mx-0"
      >
        <div className="flex gap-3 px-4 md:px-0">
          {offers.map((o) => {
            const Icon = offerIcon(o);
            return (
              <div key={o.id} className="snap-start w-44 shrink-0 rounded-2xl border bg-card p-4 card-lift">
                <div className="grid size-9 place-items-center rounded-full bg-primary/10 text-primary">
                  <Icon className="size-4" />
                </div>
                <div className="display mt-2 text-lg font-bold leading-none">{offerValue(o)}</div>
                <div className="mt-1 truncate text-xs font-medium text-foreground">{o.name}</div>
                {o.code ? (
                  <div className="mt-2 inline-block rounded-md border border-dashed border-primary/40 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider text-primary">
                    {o.code}
                  </div>
                ) : (
                  <div className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                    <Sparkles className="size-3" /> Auto-applied
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
