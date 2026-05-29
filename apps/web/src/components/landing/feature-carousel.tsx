'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { DISCOVERY_BANNERS } from '@/lib/discovery-banners';

/**
 * FeatureCarousel — the auto-rotating promo banner on the discovery page.
 *
 * Supports four transitions: 'slide', 'fade', 'zoom', 'kenBurns'. Per-slide
 * image fit (contain/cover/fill/none) + focal point + overlay placement +
 * scrim opacity are CMS-configurable. Carousel-level aspect ratio (2:1, 21:9,
 * 16:9, 1:1) + transition duration are also CMS-configurable.
 *
 * Implementation notes:
 *   • For 'slide' we use the historical translating-track layout because it's
 *     the cheapest paint and the smoothest on phones.
 *   • For 'fade' / 'zoom' / 'kenBurns' we stack all slides absolutely and
 *     swap opacity (+ scale for zoom; + a slow continuous scale for Ken Burns).
 */

const DEFAULT_AUTOPLAY_MS = 5000;

export type SlideCtaStyle = 'primary' | 'secondary' | 'outline';
export type SlideObjectFit = 'contain' | 'cover' | 'fill' | 'none';
export type SlideOverlayPosition =
  | 'bottom-left' | 'bottom-center' | 'bottom-right'
  | 'center'
  | 'top-left' | 'top-center' | 'top-right';
export type CarouselTransition = 'slide' | 'fade' | 'zoom' | 'kenBurns';
export type CarouselAspectRatio = '2:1' | '21:9' | '16:9' | '1:1';

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
  objectFit?: SlideObjectFit;
  focalPoint?: string;
  overlayPosition?: SlideOverlayPosition;
  /** 0-100 — gradient scrim opacity behind the overlay. */
  overlayDarkness?: number;
}

const ASPECT_TO_CSS: Record<CarouselAspectRatio, string> = {
  '2:1':  '2 / 1',
  '21:9': '21 / 9',
  '16:9': '16 / 9',
  '1:1':  '1 / 1',
};
const OBJECT_FIT_CSS: Record<SlideObjectFit, string> = {
  contain: 'contain',
  cover:   'cover',
  fill:    'fill',
  none:    'none',
};

export function FeatureCarousel({
  slides: slidesProp,
  autoplayMs = DEFAULT_AUTOPLAY_MS,
  transition = 'slide',
  transitionMs = 700,
  aspectRatio = '2:1',
}: {
  slides?: CarouselSlideData[];
  autoplayMs?: number;
  transition?: CarouselTransition;
  transitionMs?: number;
  aspectRatio?: CarouselAspectRatio;
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

  const aspectStyle = { aspectRatio: ASPECT_TO_CSS[aspectRatio] } as React.CSSProperties;

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
          {transition === 'slide' ? (
            <SlidingTrack
              slides={slides}
              index={index}
              count={count}
              failed={failed}
              setFailed={setFailed}
              aspectStyle={aspectStyle}
              transitionMs={transitionMs}
              setPaused={setPaused}
            />
          ) : (
            <StackedSlides
              slides={slides}
              index={index}
              count={count}
              failed={failed}
              setFailed={setFailed}
              aspectStyle={aspectStyle}
              transitionMs={transitionMs}
              transition={transition}
              setPaused={setPaused}
            />
          )}

          {/* Pagination dots — shared across both modes. */}
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

// ─────────────────────────────── SLIDE MODE ──────────────────────────────────
// A horizontally-translating track. Cheapest paint, smoothest on phones, used
// when transition === 'slide' (the historical default).
function SlidingTrack(props: {
  slides: CarouselSlideData[];
  index: number;
  count: number;
  failed: Record<number, boolean>;
  setFailed: (f: (prev: Record<number, boolean>) => Record<number, boolean>) => void;
  aspectStyle: React.CSSProperties;
  transitionMs: number;
  setPaused: (v: boolean) => void;
}) {
  const { slides, index, count, failed, setFailed, aspectStyle, transitionMs, setPaused } = props;
  return (
    <div
      className="flex ease-[cubic-bezier(0.2,0.7,0.3,1)]"
      style={{ transform: `translateX(-${index * 100}%)`, transition: `transform ${transitionMs}ms` }}
    >
      {slides.map((s, i) => (
        <div
          key={s.src + i}
          className="w-full shrink-0"
          role="group"
          aria-roledescription="slide"
          aria-label={`${i + 1} of ${count}`}
          aria-hidden={i !== index}
        >
          <SlideContent
            slide={s}
            isActive={i === index}
            isFailed={Boolean(failed[i])}
            onError={() => setFailed((f) => ({ ...f, [i]: true }))}
            aspectStyle={aspectStyle}
            kenBurns={false}
            tabIndex={i === index ? 0 : -1}
            onPauseChange={setPaused}
          />
        </div>
      ))}
    </div>
  );
}

// ────────────────────────────── STACKED MODE ─────────────────────────────────
// All slides absolutely stacked; the active one gets opacity 1 (+ scale 1 for
// zoom; + slow Ken Burns scale animation when transition === 'kenBurns').
function StackedSlides(props: {
  slides: CarouselSlideData[];
  index: number;
  count: number;
  failed: Record<number, boolean>;
  setFailed: (f: (prev: Record<number, boolean>) => Record<number, boolean>) => void;
  aspectStyle: React.CSSProperties;
  transitionMs: number;
  transition: 'fade' | 'zoom' | 'kenBurns';
  setPaused: (v: boolean) => void;
}) {
  const { slides, index, count, failed, setFailed, aspectStyle, transitionMs, transition, setPaused } = props;

  // Outer wrapper takes the aspect ratio. Inner slides are absolutely stacked.
  return (
    <div className="relative w-full" style={aspectStyle}>
      {slides.map((s, i) => {
        const isActive = i === index;
        const fadeStyle: React.CSSProperties = {
          opacity: isActive ? 1 : 0,
          transition: `opacity ${transitionMs}ms ease-out, transform ${transitionMs}ms ease-out`,
          transform: transition === 'zoom'
            ? (isActive ? 'scale(1)' : 'scale(1.06)')
            : undefined,
          pointerEvents: isActive ? 'auto' : 'none',
        };
        return (
          <div
            key={s.src + i}
            className="absolute inset-0"
            style={fadeStyle}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${count}`}
            aria-hidden={!isActive}
          >
            <SlideContent
              slide={s}
              isActive={isActive}
              isFailed={Boolean(failed[i])}
              onError={() => setFailed((f) => ({ ...f, [i]: true }))}
              aspectStyle={undefined}
              kenBurns={transition === 'kenBurns' && isActive}
              tabIndex={isActive ? 0 : -1}
              onPauseChange={setPaused}
            />
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────── SLIDE CONTENT ───────────────────────────────
// Single slide's visual content: blurred backdrop + crisp banner image with
// object-fit/position + image-click overlay link + scrim + overlay text+CTA.
// Shared by both the sliding-track mode and the stacked mode.
function SlideContent(props: {
  slide: CarouselSlideData;
  isActive: boolean;
  isFailed: boolean;
  onError: () => void;
  /** When set, applied to the inner banner box (sliding-mode passes this). */
  aspectStyle: React.CSSProperties | undefined;
  /** When true, the crisp image gets a slow continuous Ken-Burns scale. */
  kenBurns: boolean;
  tabIndex: number;
  onPauseChange: (v: boolean) => void;
}) {
  const { slide: s, isActive, isFailed, onError, aspectStyle, kenBurns, tabIndex, onPauseChange } = props;
  const hasOverlay = Boolean(s.eyebrow || s.headline || s.subtext || s.ctaLabel);
  const objectFit = OBJECT_FIT_CSS[s.objectFit ?? 'contain'];
  const objectPosition = s.focalPoint || 'center';
  // Scrim opacity comes from the CMS field; clamp + map to 0..0.85 so the
  // overlay text stays legible without ever becoming an unmovable wall.
  const scrimMax = Math.min(0.85, Math.max(0, (s.overlayDarkness ?? 60) / 100));
  const overlayPosition = s.overlayPosition ?? 'bottom-left';

  return (
    <div className={`relative w-full overflow-hidden bg-gradient-to-br ${s.fallback}`} style={aspectStyle}>
      {/* Blurred backdrop — gives wide screens a designed hero feel even when
          the banner image is centered with object-contain. */}
      {!isFailed && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={s.src}
          alt=""
          aria-hidden="true"
          loading="lazy"
          className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl"
        />
      )}
      <div className="pointer-events-none absolute inset-0 bg-black/10" />

      {/* Crisp banner image. object-fit + object-position are CMS-driven. */}
      <div className="relative h-full w-full">
        {isFailed ? (
          <div className="flex h-full w-full items-center justify-center p-6 text-center">
            <span className="display text-lg md:text-3xl font-extrabold text-white drop-shadow">{s.alt}</span>
          </div>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={s.src}
            alt={s.alt}
            loading={isActive ? 'eager' : 'lazy'}
            className={
              'absolute inset-0 h-full w-full ' +
              (kenBurns ? 'animate-kenburns' : '')
            }
            style={{ objectFit: objectFit as any, objectPosition }}
            onError={onError}
          />
        )}

        {/* Optional whole-slide image-click. z-10 so the CTA at z-20 still wins. */}
        {s.href && (
          <a
            href={s.href}
            aria-label={s.alt || 'Slide'}
            tabIndex={tabIndex}
            className="absolute inset-0 z-10"
          />
        )}

        {/* Overlay (scrim + text + CTA). Placement comes from overlayPosition. */}
        {hasOverlay && (
          <div className={`pointer-events-none absolute inset-0 z-20 flex ${alignClassesFor(overlayPosition)}`}>
            {/* Scrim — direction depends on placement so the gradient is
                always darkest under the text, not opposite to it. */}
            <div
              className="absolute inset-0"
              style={{ background: scrimGradient(overlayPosition, scrimMax) }}
            />
            <div className={`relative p-4 md:p-6 lg:p-8 text-white ${textAlignFor(overlayPosition)} max-w-xl`}>
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
                    onFocus={() => onPauseChange(true)}
                    onBlur={() => onPauseChange(false)}
                    tabIndex={tabIndex}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────── HELPERS ─────────────────────────────────
function alignClassesFor(p: SlideOverlayPosition): string {
  switch (p) {
    case 'top-left':      return 'items-start justify-start';
    case 'top-center':    return 'items-start justify-center';
    case 'top-right':     return 'items-start justify-end';
    case 'center':        return 'items-center justify-center';
    case 'bottom-center': return 'items-end justify-center';
    case 'bottom-right':  return 'items-end justify-end';
    case 'bottom-left':
    default:              return 'items-end justify-start';
  }
}
function textAlignFor(p: SlideOverlayPosition): string {
  if (p === 'center' || p === 'top-center' || p === 'bottom-center') return 'text-center';
  if (p === 'top-right' || p === 'bottom-right') return 'text-right';
  return 'text-left';
}
/** Soft gradient that's darkest behind the text and fades away from it,
 *  so the scrim feels intentional instead of like a flat shade. */
function scrimGradient(p: SlideOverlayPosition, max: number): string {
  const dark = `rgba(0,0,0,${max})`;
  const mid = `rgba(0,0,0,${(max * 0.4).toFixed(3)})`;
  const fade = 'rgba(0,0,0,0)';
  switch (p) {
    case 'top-left':
    case 'top-center':
    case 'top-right':
      return `linear-gradient(to bottom, ${dark}, ${mid} 60%, ${fade})`;
    case 'center':
      return `radial-gradient(circle at center, ${dark}, ${mid} 40%, ${fade} 75%)`;
    case 'bottom-center':
    case 'bottom-right':
    case 'bottom-left':
    default:
      return `linear-gradient(to top, ${dark}, ${mid} 60%, ${fade})`;
  }
}

function CtaButton({
  label, href, style, onFocus, onBlur, tabIndex,
}: {
  label: string; href: string; style: SlideCtaStyle;
  onFocus?: () => void; onBlur?: () => void; tabIndex?: number;
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
