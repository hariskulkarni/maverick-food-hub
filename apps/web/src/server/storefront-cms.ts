/**
 * Storefront CMS config.
 *
 * The restaurant admin edits a flexible JSON blob (Restaurant.storefrontConfig)
 * at /admin/storefront to control their public `/r/<slug>` page: the hero
 * (cover image OR a transitioning carousel of slides), branding (tagline +
 * accent), and layout toggles (search/filters/offers/top-sellers, grid vs
 * list). `parseStorefrontConfig` always returns a complete, validated object by
 * merging stored values over sensible defaults — so a brand-new restaurant
 * (null config) ships with a fully-working, customisable storefront, and a
 * partially-saved config never breaks rendering.
 */

export type HeroType = 'cover' | 'carousel';
export type HeroTransition = 'slide' | 'fade' | 'zoom';
export type MenuLayout = 'list' | 'grid';

export interface HeroSlide {
  src: string;          // image URL (under /public or absolute)
  headline?: string;
  subtext?: string;
  ctaLabel?: string;
  ctaHref?: string;
}

export interface StorefrontConfig {
  hero: {
    type: HeroType;
    transition: HeroTransition;
    autoplayMs: number;     // 0 = no autoplay
    slides: HeroSlide[];
  };
  branding: {
    tagline: string;        // '' ⇒ fall back to Restaurant.tagline
    accentColor: string;    // hex, drives storefront accent
  };
  layout: {
    showSearch: boolean;
    showFilters: boolean;
    showOffersStrip: boolean;
    showTopSellers: boolean;
    menuLayout: MenuLayout;
  };
}

export const HERO_TRANSITIONS: HeroTransition[] = ['slide', 'fade', 'zoom'];

export function defaultStorefrontConfig(): StorefrontConfig {
  return {
    hero: { type: 'cover', transition: 'slide', autoplayMs: 5000, slides: [] },
    branding: { tagline: '', accentColor: '#f23e5c' },
    layout: {
      showSearch: true,
      showFilters: true,
      showOffersStrip: true,
      showTopSellers: true,
      menuLayout: 'list',
    },
  };
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const clampInt = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
};
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const bool = (v: unknown, dflt: boolean) => (typeof v === 'boolean' ? v : dflt);

function parseSlide(s: unknown): HeroSlide | null {
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>;
  const src = str(o.src, 2048).trim();
  if (!src) return null;
  return {
    src,
    headline: str(o.headline, 120) || undefined,
    subtext: str(o.subtext, 240) || undefined,
    ctaLabel: str(o.ctaLabel, 40) || undefined,
    ctaHref: str(o.ctaHref, 2048) || undefined,
  };
}

/** Merge a stored (possibly partial / untrusted) config over defaults. Never throws. */
export function parseStorefrontConfig(raw: unknown): StorefrontConfig {
  const d = defaultStorefrontConfig();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, any>;
  const hero = r.hero ?? {};
  const branding = r.branding ?? {};
  const layout = r.layout ?? {};
  const slides = Array.isArray(hero.slides)
    ? hero.slides.map(parseSlide).filter((x: HeroSlide | null): x is HeroSlide => !!x).slice(0, 10)
    : d.hero.slides;
  const accent = HEX.test(str(branding.accentColor)) ? str(branding.accentColor) : d.branding.accentColor;
  const transition: HeroTransition = HERO_TRANSITIONS.includes(hero.transition) ? hero.transition : d.hero.transition;
  const type: HeroType = hero.type === 'carousel' ? 'carousel' : 'cover';
  return {
    hero: { type, transition, autoplayMs: clampInt(hero.autoplayMs, 0, 30000, d.hero.autoplayMs), slides },
    branding: { tagline: str(branding.tagline, 160), accentColor: accent },
    layout: {
      showSearch: bool(layout.showSearch, d.layout.showSearch),
      showFilters: bool(layout.showFilters, d.layout.showFilters),
      showOffersStrip: bool(layout.showOffersStrip, d.layout.showOffersStrip),
      showTopSellers: bool(layout.showTopSellers, d.layout.showTopSellers),
      menuLayout: layout.menuLayout === 'grid' ? 'grid' : 'list',
    },
  };
}

/**
 * Effective hero slides for rendering: if the admin configured a carousel with
 * slides, use them; otherwise fall back to the cover/logo image so the hero is
 * never empty.
 */
export function effectiveHeroSlides(cfg: StorefrontConfig, fallbackImage: string): HeroSlide[] {
  if (cfg.hero.type === 'carousel' && cfg.hero.slides.length > 0) return cfg.hero.slides;
  return [{ src: fallbackImage }];
}
