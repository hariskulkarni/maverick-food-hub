'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { DISCOVERY_BANNERS } from '@/lib/discovery-banners';

/**
 * FeatureCarousel — the auto-rotating promo banner on the discovery page
 * (`/restaurants`). Each slide is a full-bleed brand banner (2:1 landscape).
 *
 * Optional overlay copy + CTA per slide (CMS-configured):
 *   • `eyebrow`  — small uppercase label above the headline
 *   • `headline` — big bold headline
 *   • `subtext`  — supporting line
 *   • `ctaLabel` + `ctaHref` + `ctaStyle` — accent button
 * `href` makes the entire crisp banner area click-through (independent from
 * the CTA's destination). Overlay only renders when the slide has at least one
 * of {eyebrow, headline, subtext, ctaLabel} set, so legacy "image-only" slides
 * keep their clean look.
 *
 * Behaviour: auto-advances, pauses on hover/touch/CTA-focus, supports swipe +
 * keyboard, shows pagination dots. Full-bleed mobile, contained rounded card
 * desktop. Missing images degrade to a brand gradient with the alt caption.
 */

const AUTOPLAY_MS = 5000;

export type SlideCtaStyle = 'primary' | 'secondary' | 'outline';

/** A renderable slide. */
export interface CarouselSlideData {
  src: string;
  alt: string;
  fallback: string;
  href?: string;
  eyebrow?: string;
  headline?: string;
  subtext?: string;
  ctaLabel?: string;
  ctaHref?: string;
  ctaStyle?: SlideCtaStyle;
}

/**
 * Slides + autoplay are CMS-configurable (super-admin → /platform/discovery-cms).
 * When no `slides` prop is supplied we fall back to the hard-coded
 * DISCOVERY_BANNERS so the carousel always renders.
 */
export function FeatureCarousel({
  slides: slidesProp,
  autoplayMs = AUTOPLAY_MS,
}: {
  slides?: CarouselSlideData[];
  autoplayMs?: number;
} = {}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState<Record<number, boolean>>({});
  const slides: CarouselSlideData[] =
    slidesProp && slidesProp.length > 0 ? slidesProp : DISCOVERY_BANNERS;
  const count = slides.length;
  const touchStartX = useRef<number | null>(null);

  const go = useCallback((next: number) => {
    setIndex(((next % count) + count) % count);
  }, [count]);

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

  if (count === 0) return null;

  return (
    <section
      className="reveal md:pt-6"
      aria-label="Promoted highlights"
      aria-roledescription="carousel"
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') go(index + 1);
        if (e.key === 'ArrowLeft') go(index - 1);
      }}
      tabIndex={0}
    >
      <div className="md:container">
        <div
          className="relative w-full overflow-hidden rounded-b-[1.75rem] md:rounded-3xl shadow-lg shadow-primary/10"
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
            {slides.map((s, i) => {
              const hasOverlay = Boolean(s.eyebrow || s.headline || s.subtext || s.ctaLabel);
              return (
                <div
                  key={s.src + i}
                  className="w-full shrink-0"
                  role="group"
                  aria-roledescription="slide"
                  aria-label={`${i + 1} of ${count}`}
                  aria-hidden={i !== index}
                >
                  {/* Full-width band: brand-gradient base + blurred copy of the banner
                      fills the sides on wide screens so the slide reads as a designed hero. */}
                  <div className={`relative w-full overflow-hidden bg-gradient-to-br ${s.fallback}`}>
                    {!failed[i] && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={s.src}
                        alt=""
                        aria-hidden="true"
                        loading={i === 0 ? 'eager' : 'lazy'}
                        className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl"
                        style={{ position: 'absolute', inset: 0, height: '100%', width: '100%', objectFit: 'cover' }}
                      />
                    )}
                    {/* subtle wash so the blurred backdrop doesn't fight the banner */}
                    <div className="pointer-events-none absolute inset-0 bg-black/10" />

                    {/* Crisp, fully-visible banner — a true 2:1, centered and never cropped. */}
                    <div className="relative mx-auto w-full max-w-[760px]" style={{ maxWidth: '760px', marginInline: 'auto' }}>
                      <div className="relative aspect-[2/1] w-full" style={{ aspectRatio: '2 / 1' }}>
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
                            style={{ position: 'absolute', inset: 0, height: '100%', width: '100%', objectFit: 'contain' }}
                            onError={() => setFailed((f) => ({ ...f, [i]: true }))}
                          />
                        )}

                        {/* Optional click-through (CMS-configured) — covers the crisp banner
                            only so swipe + keyboard nav still work around it. z-10 keeps
                            it under the CTA (z-20) so the button's click wins. */}
                        {s.href && (
                          <a
                            href={s.href}
                            aria-label={s.alt || `Slide ${i + 1}`}
                            tabIndex={i === index ? 0 : -1}
                            className="absolute inset-0 z-10"
                          />
                        )}

                        {/* Overlay: legibility scrim + text + CTA. Pointer-events-none on
                            the wrapper so it doesn't eat the image's click-through; the
                            CTA below re-enables pointer events for itself. */}
                        {hasOverlay && (
                          <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-end">
                            {/* gradient scrim only at the bottom 60% so the top of the banner
                                stays crisp + uncovered */}
                            <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/65 via-black/30 to-transparent" />
                            <div className="relative p-4 md:p-6 lg:p-8 text-white">
                              {s.eyebrow && (
                                <div className="mb-1.5 inline-flex rounded-full bg-white/15 backdrop-blur px-2.5 py-0.5 text-[10px] md:text-xs font-semibold uppercase tracking-[0.12em]">
                                  {s.eyebrow}
                                </div>
                              )}
                              {s.headline && (
                                <h3 className="display text-xl md:text-3xl lg:text-4xl font-extrabold leading-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.4)]">
                                  {s.headline}
                                </h3>
                              )}
                              {s.subtext && (
                                <p className="mt-1.5 max-w-[44ch] text-xs md:text-sm text-white/90 drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)]">
                                  {s.subtext}
                                </p>
                              )}
                              {s.ctaLabel && (
                                <div className="mt-3 md:mt-4 pointer-events-auto">
                                  <CtaButton
                                    label={s.ctaLabel}
                                    href={s.ctaHref || s.href || '#'}
                                    style={s.ctaStyle ?? 'primary'}
                                    onFocus={() => setPaused(true)}
                                    onBlur={() => setPaused(false)}
                                    tabIndex={i === index ? 0 : -1}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination dots */}
          {count > 1 && (
            <div className="absolute inset-x-0 bottom-3 z-30 flex items-center justify-center gap-1.5">
              {slides.map((s, i) => (
                <button
                  key={s.src + i}
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

/** Visually distinct CTA pill. Stops propagation so a click on it doesn't also
 *  trigger the underlying slide click-through. */
function CtaButton({
  label,
  href,
  style,
  onFocus,
  onBlur,
  tabIndex,
}: {
  label: string;
  href: string;
  style: SlideCtaStyle;
  onFocus?: () => void;
  onBlur?: () => void;
  tabIndex?: number;
}) {
  const base =
    'group/cta inline-flex items-center gap-1.5 rounded-full px-4 py-2 md:px-5 md:py-2.5 ' +
    'text-xs md:text-sm font-semibold tracking-wide ' +
    'transition-all duration-300 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80';
  const styles: Record<SlideCtaStyle, string> = {
    primary:
      'bg-primary text-primary-foreground shadow-lg shadow-black/30 hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5',
    secondary:
      'bg-white text-foreground shadow-lg shadow-black/30 hover:shadow-xl hover:bg-white/95 hover:-translate-y-0.5',
    outline:
      'border border-white/80 text-white backdrop-blur-sm bg-white/10 hover:bg-white/20 hover:border-white',
  };
  return (
    <a
      href={href}
      className={`${base} ${styles[style]}`}
      onClick={(e) => e.stopPropagation()}
      onFocus={onFocus}
      onBlur={onBlur}
      tabIndex={tabIndex}
    >
      {label}
      <ArrowRight className="size-3.5 md:size-4 transition-transform duration-300 group-hover/cta:translate-x-0.5" />
    </a>
  );
}
