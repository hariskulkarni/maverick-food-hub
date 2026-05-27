'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DISCOVERY_BANNERS } from '@/lib/discovery-banners';

/**
 * FeatureCarousel — the auto-rotating promo banner on the discovery page
 * (`/restaurants`). Image-based: each slide is a full-bleed brand banner
 * (2:1 landscape) from `public/banners/`, configured in
 * `@/lib/discovery-banners`.
 *
 * Behaviour: auto-advances, pauses on hover/touch, supports swipe + keyboard,
 * and shows pagination dots. Full-bleed + square-ish on mobile (native-app
 * hero feel), contained rounded card on desktop. If a banner file is missing,
 * the slide falls back to a branded gradient with the caption so the carousel
 * never shows a broken image.
 */

const AUTOPLAY_MS = 5000;

export function FeatureCarousel() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState<Record<number, boolean>>({});
  const slides = DISCOVERY_BANNERS;
  const count = slides.length;
  const touchStartX = useRef<number | null>(null);

  const go = useCallback((next: number) => {
    setIndex(((next % count) + count) % count);
  }, [count]);

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

  if (count === 0) return null;

  return (
    <section
      className="reveal md:pt-6"
      aria-label="Bowl & Barbeque highlights"
      aria-roledescription="carousel"
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') go(index + 1);
        if (e.key === 'ArrowLeft') go(index - 1);
      }}
      tabIndex={0}
    >
      <div className="md:container">
        {/* The banners are a true 2:1. We keep the slide box at 2:1 so the image
            fills it edge-to-edge with no crop and no gradient margins, and cap
            the WIDTH on larger screens (not the height) so a full-width 2:1 hero
            doesn't grow to a full-screen height — width 760px → 380px tall. */}
        <div
          className="relative mx-auto w-full max-w-[760px] overflow-hidden rounded-b-[1.75rem] md:rounded-3xl shadow-lg shadow-primary/10"
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
            {slides.map((s, i) => (
              <div
                key={s.src}
                className="w-full shrink-0"
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${count}`}
                aria-hidden={i !== index}
              >
                {/* Banners are a true 2:1. The box is locked to 2:1 and the image
                    uses object-contain, so the whole banner fills it edge-to-edge
                    with no crop and no gradient margin (the width cap on the parent
                    keeps the overall height sensible). aspectRatio is ALSO set
                    inline (not just the Tailwind class) so the box stays bounded
                    even during a brief FOUC / soft-nav window before the stylesheet
                    applies — without it the raw <img> would paint at its full
                    intrinsic ~3780px. */}
                <div
                  className={`relative aspect-[2/1] w-full overflow-hidden bg-gradient-to-br ${s.fallback}`}
                  style={{ aspectRatio: '2 / 1' }}
                >
                  {failed[i] ? (
                    <div className="flex h-full w-full items-center justify-center p-6 text-center">
                      <span className="display text-lg md:text-3xl font-extrabold text-white drop-shadow">
                        {s.alt}
                      </span>
                    </div>
                  ) : (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={s.src}
                      alt={s.alt}
                      loading={i === 0 ? 'eager' : 'lazy'}
                      className="absolute inset-0 h-full w-full object-contain"
                      // Inline styles mirror the classes so the image stays
                      // pinned to (and contained within) the 2:1 box even before
                      // Tailwind applies — kills the "giant image until refresh".
                      style={{ position: 'absolute', inset: 0, height: '100%', width: '100%', objectFit: 'contain' }}
                      onError={() => setFailed((f) => ({ ...f, [i]: true }))}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Pagination dots */}
          {count > 1 && (
            <div className="absolute inset-x-0 bottom-3 z-20 flex items-center justify-center gap-1.5">
              {slides.map((s, i) => (
                <button
                  key={s.src}
                  type="button"
                  onClick={() => go(i)}
                  aria-label={`Go to slide ${i + 1}`}
                  aria-current={i === index}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === index ? 'w-6 bg-white' : 'w-1.5 bg-white/55 hover:bg-white/80'
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
