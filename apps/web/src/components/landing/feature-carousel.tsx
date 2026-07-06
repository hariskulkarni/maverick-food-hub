'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { DISCOVERY_BANNERS } from '@/lib/discovery-banners';
import {
  HERO_WIDTH_WRAP_CLASS,
  HERO_WIDTH_INNER_CLASS,
  HERO_HEIGHT_CLASS,
  type HeroWidth,
  type HeroHeight,
} from '@/server/storefront-cms';

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
  // ── Video slides ──────────────────────────────────────────────────────────
  mediaType?: 'image' | 'video';
  /** Direct .mp4/.webm URL, or a YouTube/Vimeo link (auto-embedded). */
  videoSrc?: string;
  /** Poster image; falls back to `src`. */
  poster?: string;
  videoAutoplay?: boolean;
  videoLoop?: boolean;
  videoMuted?: boolean;
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

// ── Video helpers ────────────────────────────────────────────────────────────
type VideoKind = 'file' | 'youtube' | 'vimeo' | 'none';
function videoInfo(raw: string): { kind: VideoKind; id?: string; embedBase?: string; fileUrl?: string; mime?: string } {
  const v = (raw || '').trim();
  if (!v) return { kind: 'none' };
  const yt = v.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  if (yt) return { kind: 'youtube', id: yt[1], embedBase: `https://www.youtube.com/embed/${yt[1]}` };
  const vm = v.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return { kind: 'vimeo', id: vm[1], embedBase: `https://player.vimeo.com/video/${vm[1]}` };
  const clean = v.split('?')[0].toLowerCase();
  const ext = clean.slice(clean.lastIndexOf('.') + 1);
  const mime = ext === 'webm' ? 'video/webm' : (ext === 'ogg' || ext === 'ogv') ? 'video/ogg' : ext === 'mov' ? 'video/quicktime' : 'video/mp4';
  return { kind: 'file', fileUrl: v, mime };
}

/** Respect the OS "reduce motion" setting — suppress video autoplay when set. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

/**
 * Crisp media layer of a slide: <img> for image slides, a muted-autoplay-loop
 * <video> for uploaded/direct files, or a background <iframe> for YouTube /
 * Vimeo. Falls back to the poster (or image) when autoplay is suppressed
 * (reduced-motion) or the slide isn't the active one.
 */
function SlideMedia({ s, isActive, objectFit, objectPosition, kenBurns, onError }: {
  s: CarouselSlideData;
  isActive: boolean;
  objectFit: string;
  objectPosition: string;
  kenBurns: boolean;
  onError: () => void;
}) {
  const reduced = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isVideo = s.mediaType === 'video' && !!s.videoSrc;
  // The still image shown for inactive slides / reduced-motion / non-autoplay.
  const stillPoster = s.poster || s.src || undefined;
  // The <video> poster must NEVER fall back to s.src (a different image) — that
  // is what caused the hero to flash a wrong image for a frame before the video
  // decoded. Only an explicit poster is used; otherwise the video shows its own
  // first frame over a black backdrop.
  const videoPoster = s.poster || undefined;
  const autoplay = (s.videoAutoplay ?? true) && !reduced && isActive;

  // React doesn't reliably reflect `muted` to the DOM property (which browsers
  // require for autoplay). Force it via the ref + (re)start on activation.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = s.videoMuted ?? true;
    if (autoplay) { el.play?.().catch(() => { /* autoplay blocked — poster stays */ }); }
    else { el.pause?.(); }
  }, [autoplay, s.videoMuted]);

  const imgEl = (src: string) => (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt={s.alt}
      loading={isActive ? 'eager' : 'lazy'}
      className={'absolute inset-0 h-full w-full ' + (kenBurns ? 'animate-kenburns' : '')}
      style={{ objectFit: objectFit as any, objectPosition }}
      onError={onError}
    />
  );

  if (!isVideo) return imgEl(s.src);

  const info = videoInfo(s.videoSrc as string);

  if (info.kind === 'youtube' || info.kind === 'vimeo') {
    // Not active / reduced-motion → show the poster still instead of the embed.
    if (!autoplay) return stillPoster ? imgEl(stillPoster) : <div className="absolute inset-0 bg-black" />;
    const embed = info.kind === 'youtube'
      ? `${info.embedBase}?autoplay=1&mute=1&loop=1&controls=0&playsinline=1&modestbranding=1&rel=0&showinfo=0&playlist=${info.id}`
      : `${info.embedBase}?background=1&autoplay=1&muted=1&loop=1`;
    return (
      <iframe
        src={embed}
        title={s.alt || 'Hero video'}
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ border: 0 }}
        allow="autoplay; encrypted-media; picture-in-picture"
        loading={isActive ? 'eager' : 'lazy'}
      />
    );
  }

  // Direct file (mp4/webm/ogg/mov)
  return (
    <video
      ref={(el) => {
        videoRef.current = el;
        if (el) {
          // Safari only allows muted inline autoplay when the `muted` ATTRIBUTE
          // is present in the DOM — React's `muted` prop sets the property, not
          // the attribute, so we force it here (plus playsinline for iOS).
          const m = s.videoMuted ?? true;
          el.muted = m;
          el.defaultMuted = m;
          if (m) el.setAttribute('muted', ''); else el.removeAttribute('muted');
          el.setAttribute('playsinline', '');
          el.setAttribute('webkit-playsinline', 'true');
        }
      }}
      suppressHydrationWarning
      className={'absolute inset-0 h-full w-full ' + (kenBurns ? 'animate-kenburns' : '')}
      style={{ objectFit: objectFit as any, objectPosition, backgroundColor: '#000' }}
      poster={videoPoster}
      autoPlay={autoplay}
      loop={s.videoLoop ?? true}
      muted={s.videoMuted ?? true}
      playsInline
      controls={false}
      preload={isActive ? 'auto' : 'metadata'}
      onLoadedData={(e) => { if (autoplay) e.currentTarget.play?.().catch(() => {}); }}
      onCanPlay={(e) => { if (autoplay) e.currentTarget.play?.().catch(() => {}); }}
      onError={onError}
      aria-label={s.alt || 'Hero video'}
    >
      <source src={info.fileUrl} type={info.mime} />
    </video>
  );
}

export function FeatureCarousel({
  slides: slidesProp,
  autoplayMs = DEFAULT_AUTOPLAY_MS,
  transition = 'slide',
  transitionMs = 700,
  aspectRatio = '2:1',
  width,
  height,
}: {
  slides?: CarouselSlideData[];
  autoplayMs?: number;
  transition?: CarouselTransition;
  transitionMs?: number;
  /**
   * Legacy banner shape. Used only as a fallback when neither `height` nor a
   * historical config is present. The newer `height` prop (8 presets) takes
   * precedence so existing pages keep working while new ones get the richer
   * picker.
   */
  aspectRatio?: CarouselAspectRatio;
  /**
   * Hero-size width preset (full-bleed, container, card, narrow…). Controls
   * how wide the carousel renders on the page. Shared with the storefront
   * hero so the size pickers feel identical across both admin surfaces.
   * Defaults to historical behaviour (md:container) when not set.
   */
  width?: HeroWidth;
  /**
   * Hero-size height preset (compact, standard, tall, cinematic 21:9, wide
   * 2:1, classic 16:9, half-screen, full-screen). When set, overrides
   * `aspectRatio`. When NOT set, the carousel falls back to aspectRatio for
   * backwards compatibility.
   */
  height?: HeroHeight;
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

  // Resolve the rendered shape:
  //   • If `height` is set, the hero-size CSS class drives the box (richer
  //     8-preset enum, e.g. half-screen / full-screen / cinematic 21:9).
  //   • Otherwise we fall back to the legacy CSS `aspect-ratio` inline style
  //     using the 4-preset aspectRatio prop, preserving historical behaviour
  //     for any caller that hasn't migrated.
  const useHeroSize = Boolean(height);
  const heightCls = height ? HERO_HEIGHT_CLASS[height] : '';
  const aspectStyle: React.CSSProperties | undefined = useHeroSize
    ? undefined
    : { aspectRatio: ASPECT_TO_CSS[aspectRatio] };

  // Width preset chooses the wrapper class. Default (when `width` is unset)
  // keeps the historical `md:container` look — full-bleed mobile, container
  // desktop. When the admin picks a preset we honour it exactly.
  const wrapCls = width ? HERO_WIDTH_WRAP_CLASS[width] : 'md:container';
  // Inner card classes (rounded corners / shadow / ring) — taken from the
  // width preset when set, otherwise the historical aggressive rounding.
  const innerExtraCls = width
    ? HERO_WIDTH_INNER_CLASS[width]
    : 'rounded-b-[1.75rem] md:rounded-3xl shadow-lg shadow-primary/10';

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
      <div className={wrapCls}>
        <div
          className={`relative w-full overflow-hidden ${innerExtraCls} ${heightCls}`}
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
              useHeroSize={useHeroSize}
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
              useHeroSize={useHeroSize}
            />
          )}

          {/* Prev / next navigation arrows. */}
          {count > 1 && (
            <>
              <button
                type="button"
                onClick={() => go(index - 1)}
                aria-label="Previous slide"
                className="absolute left-2 md:left-3 top-1/2 z-30 -translate-y-1/2 grid size-9 md:size-10 place-items-center rounded-full bg-black/35 text-white backdrop-blur-sm transition hover:bg-black/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
              </button>
              <button
                type="button"
                onClick={() => go(index + 1)}
                aria-label="Next slide"
                className="absolute right-2 md:right-3 top-1/2 z-30 -translate-y-1/2 grid size-9 md:size-10 place-items-center rounded-full bg-black/35 text-white backdrop-blur-sm transition hover:bg-black/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
              </button>
            </>
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
  aspectStyle: React.CSSProperties | undefined;
  transitionMs: number;
  setPaused: (v: boolean) => void;
  /**
   * When true, the parent has set an explicit height (via HERO_HEIGHT_CLASS),
   * so the slide track + each slide must stretch with `h-full` instead of
   * sizing themselves via aspect-ratio.
   */
  useHeroSize: boolean;
}) {
  const { slides, index, count, failed, setFailed, aspectStyle, transitionMs, setPaused, useHeroSize } = props;
  const stretch = useHeroSize ? 'h-full' : '';
  return (
    <div
      className={`flex ease-smooth ${stretch}`}
      style={{ transform: `translateX(-${index * 100}%)`, transition: `transform ${transitionMs}ms` }}
    >
      {slides.map((s, i) => (
        <div
          key={s.src + i}
          className={`w-full shrink-0 ${stretch}`}
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
            useHeroSize={useHeroSize}
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
  aspectStyle: React.CSSProperties | undefined;
  transitionMs: number;
  transition: 'fade' | 'zoom' | 'kenBurns';
  setPaused: (v: boolean) => void;
  useHeroSize: boolean;
}) {
  const { slides, index, count, failed, setFailed, aspectStyle, transitionMs, transition, setPaused, useHeroSize } = props;

  // Outer wrapper takes the aspect ratio in legacy mode, or h-full when a
  // hero-size height class is driving the parent.
  return (
    <div className={`relative w-full ${useHeroSize ? 'h-full' : ''}`} style={aspectStyle}>
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
  /**
   * When true, parent has set explicit height via HERO_HEIGHT_CLASS — SlideContent
   * root should stretch with h-full instead of relying on aspectStyle.
   * Optional + defaults to false so the existing call sites (StackedSlides
   * inner content) keep working unchanged.
   */
  useHeroSize?: boolean;
}) {
  const { slide: s, isActive, isFailed, onError, aspectStyle, kenBurns, tabIndex, onPauseChange, useHeroSize } = props;
  const hasOverlay = Boolean(s.eyebrow || s.headline || s.subtext || s.ctaLabel);
  const objectFit = OBJECT_FIT_CSS[s.objectFit ?? 'contain'];
  const objectPosition = s.focalPoint || 'center';
  // Scrim opacity comes from the CMS field; clamp + map to 0..0.85 so the
  // overlay text stays legible without ever becoming an unmovable wall.
  const scrimMax = Math.min(0.85, Math.max(0, (s.overlayDarkness ?? 60) / 100));
  const overlayPosition = s.overlayPosition ?? 'bottom-left';

  return (
    <div className={`relative w-full overflow-hidden bg-gradient-to-br ${s.fallback} ${useHeroSize ? 'h-full' : ''}`} style={aspectStyle}>
      {/* Blurred backdrop — gives wide screens a designed hero feel even when
          the banner image is centered with object-contain. */}
      {!isFailed && (s.poster || s.src) && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={s.poster || s.src}
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
          <SlideMedia
            s={s}
            isActive={isActive}
            objectFit={objectFit}
            objectPosition={objectPosition}
            kenBurns={kenBurns}
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
