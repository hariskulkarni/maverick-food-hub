'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageWithFallback } from '@/components/image-with-fallback';
import { HeartButton } from '@/components/heart-button';
import {
  HERO_WIDTH_WRAP_CLASS,
  HERO_WIDTH_INNER_CLASS,
  HERO_HEIGHT_CLASS,
  type HeroWidth,
  type HeroHeight,
} from '@/server/storefront-cms';
import { HERO_FIT_CLASS, HERO_POSITION_CLASS, type HeroFit, type HeroPosition } from '@/server/storefront-cms';

/**
 * StorefrontHeroCarousel — a CMS-configurable, mobile-first hero carousel for
 * a restaurant storefront.
 *
 * Width/height are driven by the storefront CMS (HeroWidth / HeroHeight
 * presets). The wrapper applies the width preset (full-bleed, container,
 * card, narrow, etc.) and the inner image stage applies the height preset
 * (fixed heights OR aspect ratios). Both class maps live in
 * @/server/storefront-cms so the admin live preview and the customer page
 * render identically (single source of truth).
 *
 * Each slide can carry an optional headline / subtext / CTA which are overlaid
 * (bottom-left) with a legibility gradient; the CTA uses the restaurant's
 * accent colour. Transition (slide / fade / zoom) and autoplay are
 * CMS-configurable. Slides are absolutely stacked so any transition applies
 * uniformly. The favourite toggle floats top-right; missing images degrade to a
 * branded gradient via <ImageWithFallback>.
 */

const DEFAULT_AUTOPLAY_MS = 5000;
type Transition = 'slide' | 'fade' | 'zoom';

export interface HeroCarouselSlide {
  src: string;
  headline?: string;
  subtext?: string;
  ctaLabel?: string;
  ctaHref?: string;
}

export function StorefrontHeroCarousel({
  slides,
  alt,
  restaurantId,
  isAuthed,
  favInitial,
  transition = 'slide',
  autoplayMs = DEFAULT_AUTOPLAY_MS,
  accentColor = '#f23e5c',
  width = 'full-bleed',
  height = 'wide',
  imageFit = 'cover',
  imagePosition = 'center',
}: {
  slides: HeroCarouselSlide[];
  alt: string;
  restaurantId: string;
  isAuthed: boolean;
  favInitial: boolean;
  transition?: Transition;
  autoplayMs?: number;
  accentColor?: string;
  /**
   * CMS-configured width preset. See HeroWidth in @/server/storefront-cms for
   * the full list and what each preset looks like. Defaults to 'full-bleed'
   * to preserve historical behaviour.
   */
  width?: HeroWidth;
  /**
   * CMS-configured height preset. See HeroHeight in @/server/storefront-cms.
   * Defaults to 'wide' (aspect 2:1, max 64vh) which is the historical carousel
   * shape.
   */
  height?: HeroHeight;
  imageFit?: HeroFit;
  imagePosition?: HeroPosition;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = slides.length;
  const touchStartX = useRef<number | null>(null);

  const go = useCallback((next: number) => setIndex(((next % count) + count) % count), [count]);

  useEffect(() => {
    if (paused || count <= 1 || autoplayMs <= 0) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % count), autoplayMs);
    return () => window.clearInterval(id);
  }, [paused, count, autoplayMs]);

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

  // The width preset drives the OUTER wrapper (full-bleed, container, card,
  // narrow…); the height preset drives the INNER image stage (fixed height OR
  // aspect ratio). Card/box-style width presets also round the inner stage so
  // it visually reads as a hosted card. See @/server/storefront-cms for the
  // exact CSS for each preset.
  const wrapCls = HERO_WIDTH_WRAP_CLASS[width] ?? HERO_WIDTH_WRAP_CLASS['full-bleed'];
  const innerCls = HERO_WIDTH_INNER_CLASS[width] ?? '';
  const stageCls = HERO_HEIGHT_CLASS[height] ?? HERO_HEIGHT_CLASS['wide'];

  return (
    <section className={`relative ${wrapCls}`} aria-label={`${alt} highlights`} aria-roledescription="carousel">
      <div
        className={`relative w-full overflow-hidden bg-muted ${innerCls}`}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className={`relative w-full ${stageCls}`}>

          {slides.map((s, i) => {
            const active = i === index;
            const style: React.CSSProperties =
              transition === 'slide'
                ? { transform: `translateX(${(i - index) * 100}%)`, opacity: 1 }
                : transition === 'zoom'
                ? { opacity: active ? 1 : 0, transform: active ? 'scale(1)' : 'scale(1.06)' }
                : { opacity: active ? 1 : 0 }; // fade
            const hasCaption = !!(s.headline || s.subtext || (s.ctaLabel && s.ctaHref));
            return (
              <div
                key={i}
                className="absolute inset-0 h-full w-full transition-all duration-700 ease-smooth"
                style={style}
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${count}`}
                aria-hidden={!active}
              >
                <ImageWithFallback src={s.src} alt={`${alt} — ${s.headline ?? `promotion ${i + 1}`}`} fill priority={i === 0} sizes="100vw" className={`${HERO_FIT_CLASS[imageFit]} ${HERO_POSITION_CLASS[imagePosition]}`} />
                {hasCaption && (
                  <>
                    <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 p-5 md:p-8 max-w-2xl">
                      {s.headline && <h2 className="display text-xl md:text-3xl font-bold text-white drop-shadow">{s.headline}</h2>}
                      {s.subtext && <p className="mt-1 text-sm md:text-base text-white/90 drop-shadow line-clamp-2">{s.subtext}</p>}
                      {s.ctaLabel && s.ctaHref && (
                        <a href={s.ctaHref} className="mt-3 inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-[1.03]" style={{ backgroundColor: accentColor }}>
                          {s.ctaLabel}
                        </a>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="absolute right-4 top-4 z-10">
          <HeartButton
            restaurantId={restaurantId}
            initial={favInitial}
            requireAuth={!isAuthed}
            variant="glass"
            label={favInitial ? 'Remove restaurant from favorites' : 'Add restaurant to favorites'}
          />
        </div>

        {count > 1 && (
          <div className="absolute inset-x-0 bottom-3 z-10 flex items-center justify-center gap-1.5">
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => go(i)}
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === index}
                className={`h-1.5 rounded-full shadow ring-1 ring-black/10 transition-all duration-300 ${i === index ? 'w-6 bg-white' : 'w-1.5 bg-white/60 hover:bg-white/90'}`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
