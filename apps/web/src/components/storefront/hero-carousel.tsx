'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ImageWithFallback } from '@/components/image-with-fallback';
import { HeartButton } from '@/components/heart-button';

/**
 * StorefrontHeroCarousel — a full-bleed, mobile-first image carousel that
 * replaces the single cover-image hero on a restaurant storefront.
 *
 * The banner artwork is self-branded (2:1), so the carousel keeps a 2:1 aspect
 * box (no crop) on mobile and caps its height on large screens. Auto-advances,
 * pauses on hover/touch, supports swipe + keyboard dots, and degrades to a
 * gradient placeholder per slide if an image file is missing. The favourite
 * toggle is retained, floating top-right.
 */

const AUTOPLAY_MS = 5000;

export function StorefrontHeroCarousel({
  images,
  alt,
  restaurantId,
  isAuthed,
  favInitial
}: {
  images: string[];
  alt: string;
  restaurantId: string;
  isAuthed: boolean;
  favInitial: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = images.length;
  const touchStartX = useRef<number | null>(null);

  const go = useCallback((next: number) => setIndex(((next % count) + count) % count), [count]);

  useEffect(() => {
    if (paused || count <= 1) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % count), AUTOPLAY_MS);
    return () => window.clearInterval(id);
  }, [paused, count]);

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
    <section className="relative" aria-label={`${alt} highlights`} aria-roledescription="carousel">
      <div
        className="relative w-full overflow-hidden bg-muted"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* 2:1 box matches the banner artwork (no crop) on mobile; capped on
            large screens so it never dominates the viewport. */}
        <div className="relative aspect-[2/1] max-h-[64vh] w-full">
          <div
            className="flex h-full transition-transform duration-700 ease-[cubic-bezier(0.2,0.7,0.3,1)]"
            style={{ transform: `translateX(-${index * 100}%)` }}
          >
            {images.map((src, i) => (
              <div
                key={src}
                className="relative h-full w-full shrink-0"
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${count}`}
                aria-hidden={i !== index}
              >
                <ImageWithFallback
                  src={src}
                  alt={`${alt} — promotion ${i + 1}`}
                  fill
                  priority={i === 0}
                  sizes="100vw"
                  className="object-cover"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Favourite toggle — top-right, glass backdrop (kept from the hero). */}
        <div className="absolute right-4 top-4 z-10">
          <HeartButton
            restaurantId={restaurantId}
            initial={favInitial}
            requireAuth={!isAuthed}
            variant="glass"
            label={favInitial ? 'Remove restaurant from favorites' : 'Add restaurant to favorites'}
          />
        </div>

        {/* Pagination dots */}
        {count > 1 && (
          <div className="absolute inset-x-0 bottom-3 z-10 flex items-center justify-center gap-1.5">
            {images.map((src, i) => (
              <button
                key={src}
                type="button"
                onClick={() => go(i)}
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === index}
                className={`h-1.5 rounded-full shadow ring-1 ring-black/10 transition-all duration-300 ${
                  i === index ? 'w-6 bg-white' : 'w-1.5 bg-white/60 hover:bg-white/90'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
