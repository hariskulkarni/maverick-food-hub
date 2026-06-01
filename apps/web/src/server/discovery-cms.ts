/**
 * Discovery-page CMS — the super-admin-editable config for the public
 * marketplace discovery page (`/restaurants`).
 *
 * Unlike the per-restaurant Storefront CMS (Restaurant.storefrontConfig), this
 * is a SINGLE platform-wide surface. It is persisted as one row in the generic
 * `SiteContent` table under key "discovery" (a JSON blob).
 *
 * Sections (each independently toggle-able + granularly editable):
 *   • seo               — meta title/description, OG image, keywords
 *   • carousel          — full-bleed promo banners (add/remove/reorder + alt/link)
 *   • topOffers         — "Top offers today" strip: heading, limit, pinned ids
 *   • whatsOnYourMind    — food-category tiles (add/remove/reorder + image/alt)
 *   • restaurantsNearby — "Restaurants near you" grid: heading, sort, featured ids
 *   • footer            — site-wide footer: tagline, link columns, social, legal
 *
 * `parseDiscoveryConfig` ALWAYS returns a complete, validated object by merging
 * stored values over sensible defaults — so a fresh platform (no row yet) ships
 * the EXACT same content that is currently hard-coded (DISCOVERY_BANNERS /
 * DISCOVERY_CATEGORIES), and a malformed/partial/legacy blob can never break
 * the page render.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '@/server/db';
import { DISCOVERY_BANNERS } from '@/lib/discovery-banners';
import { DISCOVERY_CATEGORIES } from '@/lib/discovery-categories';
import { wrap, invalidateTag, keys } from '@/server/cache';
// Reuse the per-restaurant hero-size types so the discovery carousel and the
// storefront hero share the SAME 7 width × 8 height presets. The class maps
// also come from there (single source of truth for CSS).
import {
  HERO_WIDTHS,
  HERO_HEIGHTS,
  type HeroWidth,
  type HeroHeight,
} from '@/server/storefront-cms';

/**
 * Local-file existence check for same-origin image URLs.
 *
 * Background: the discovery CMS lets admins upload PNGs that get stored in
 * `public/discovery/<timestamp>-<random>.png` and the URL written into the
 * SiteContent JSON. But if (a) the upload silently lost the file, (b) the
 * file was deleted out-of-band, or (c) DB was synced from another env
 * without the matching public/ asset, the URL points at a 404 — and the
 * customer page renders a pink placeholder.
 *
 * This helper returns true ONLY when the URL is a relative same-origin
 * path AND the file resolves on disk. Absolute URLs (https://…) always
 * pass through — we trust those to handle their own availability.
 */
function localFileExists(url: string): boolean {
  if (!url) return false;
  if (/^https?:\/\//i.test(url)) return true; // can't easily check remote; trust it
  if (!url.startsWith('/')) return false; // odd relative path — refuse
  // Strip query string and resolve against the Next.js `public/` directory.
  const cleanPath = url.split('?')[0];
  const fullPath = join(process.cwd(), 'public', cleanPath);
  try {
    return existsSync(fullPath);
  } catch {
    return false;
  }
}

export const DISCOVERY_CONTENT_KEY = 'discovery';

export type NearbySort = 'newest' | 'name';

/** Visual style for the CTA button on a carousel slide. */
export type SlideCtaStyle = 'primary' | 'secondary' | 'outline';
export const SLIDE_CTA_STYLES = ['primary', 'secondary', 'outline'] as const;

/** How the banner image fills its 2:1 box. Mirrors CSS object-fit. */
export type SlideObjectFit = 'contain' | 'cover' | 'fill' | 'none';
export const SLIDE_OBJECT_FITS = ['contain', 'cover', 'fill', 'none'] as const;

/** Where the overlay (eyebrow / headline / subtext / CTA) sits over the banner. */
export type SlideOverlayPosition =
  | 'bottom-left' | 'bottom-center' | 'bottom-right'
  | 'center'
  | 'top-left' | 'top-center' | 'top-right';
export const SLIDE_OVERLAY_POSITIONS = [
  'bottom-left', 'bottom-center', 'bottom-right',
  'center',
  'top-left', 'top-center', 'top-right',
] as const;

/** Transition animation between slides. */
export type CarouselTransition = 'slide' | 'fade' | 'zoom' | 'kenBurns';
export const CAROUSEL_TRANSITIONS = ['slide', 'fade', 'zoom', 'kenBurns'] as const;

/** Banner shape. The numbers map to CSS aspect-ratio. */
export type CarouselAspectRatio = '2:1' | '21:9' | '16:9' | '1:1';
export const CAROUSEL_ASPECT_RATIOS = ['2:1', '21:9', '16:9', '1:1'] as const;

export interface CarouselSlide {
  /** Image URL (under /public or absolute). */
  src: string;
  /** Accessible alt text / placeholder caption. */
  alt: string;
  /** Optional whole-slide click-through link. '' ⇒ tapping the image does nothing. */
  href: string;
  /** Tailwind gradient classes for the loading/fallback background. */
  fallback: string;
  /** Hidden slides are kept but not rendered. */
  enabled: boolean;

  // ── Overlay text + CTA (all optional; render only when set) ────────────────
  /** Small uppercase eyebrow label above the headline (e.g. "New this week"). */
  eyebrow: string;
  /** Big headline overlaid on the slide. Blank ⇒ no headline rendered. */
  headline: string;
  /** Supporting line under the headline. Blank ⇒ hidden. */
  subtext: string;
  /** Button label. Blank ⇒ no CTA button rendered. */
  ctaLabel: string;
  /**
   * Button click-through. Falls back to `href` when blank, so editors who want
   * the button to go to the same place as the image-click don't have to set it
   * twice. Independent value when both are set.
   */
  ctaHref: string;
  /** Visual style of the CTA button. Defaults to 'primary'. */
  ctaStyle: SlideCtaStyle;

  // ── RevSlider-style image presentation (all optional, sensible defaults) ──
  /**
   * How the image fills its banner box.
   *   • contain — entire image visible, may letterbox (default — was the old
   *               behaviour)
   *   • cover   — fills the box, may crop. Use with focalPoint to control the
   *               crop anchor.
   *   • fill    — stretches to fill exactly (distorts aspect ratio)
   *   • none    — original size, may overflow
   */
  objectFit: SlideObjectFit;
  /**
   * CSS object-position. When objectFit is 'cover' (or 'none'), this picks the
   * anchor for the visible region. Accepts any CSS value: '50% 50%', 'top',
   * 'center', '20% 80%', etc. Defaults to 'center'.
   */
  focalPoint: string;
  /** Where the overlay (eyebrow/headline/subtext/CTA) sits over the banner. */
  overlayPosition: SlideOverlayPosition;
  /**
   * Scrim opacity behind the overlay, 0-100. The scrim is a soft gradient that
   * keeps overlay text legible over busy banners. 0 = transparent; 100 = solid
   * black. Default 60.
   */
  overlayDarkness: number;
}

export interface CategoryTile {
  /** URL slug → /category/<slug>. */
  slug: string;
  /** Tile label. */
  label: string;
  /** Image URL. */
  image: string;
  /** Accessible alt text ('' ⇒ falls back to label). */
  alt: string;
  enabled: boolean;
}

export interface FooterLink {
  label: string;
  href: string;
}

export interface FooterColumn {
  title: string;
  links: FooterLink[];
}

export interface FooterSocial {
  twitter: string;
  instagram: string;
  facebook: string;
  linkedin: string;
  youtube: string;
}

export interface DiscoveryConfig {
  seo: {
    metaTitle: string;       // '' ⇒ default "All restaurants"
    metaDescription: string;
    ogImage: string;
    keywords: string;        // comma-separated
  };
  carousel: {
    enabled: boolean;
    autoplayMs: number;      // 0 = no autoplay
    /** Animation between slides. */
    transition: CarouselTransition;
    /** Transition duration in ms (200-2000). */
    transitionMs: number;
    /**
     * Legacy banner-shape field (2:1 | 21:9 | 16:9 | 1:1). Preserved on the
     * type for back-compat reads / writes. The renderer prefers `height` (the
     * richer 8-preset enum) when it is set; this stays as a fallback so configs
     * saved before the size-picker upgrade still work.
     */
    aspectRatio: CarouselAspectRatio;
    /**
     * Hero-style width preset (7 options) shared with the per-restaurant
     * storefront hero. Controls how wide the carousel renders on the page —
     * full-bleed, container, card, narrow, etc. See HeroWidth in
     * @/server/storefront-cms.
     */
    width: HeroWidth;
    /**
     * Hero-style height preset (8 options) shared with the per-restaurant
     * storefront hero. Mix of fixed-pixel and aspect-ratio shapes. When set,
     * supersedes the legacy `aspectRatio` field above. See HeroHeight in
     * @/server/storefront-cms.
     */
    height: HeroHeight;
    slides: CarouselSlide[];
  };
  topOffers: {
    enabled: boolean;
    heading: string;
    subheading: string;
    limit: number;           // how many tiles
    pinnedOfferIds: string[]; // shown first, in this order
  };
  whatsOnYourMind: {
    enabled: boolean;
    heading: string;
    tiles: CategoryTile[];
  };
  restaurantsNearby: {
    enabled: boolean;
    eyebrow: string;         // small uppercase label
    heading: string;
    subheading: string;      // '' ⇒ keep the dynamic "Sorted by …" line
    defaultSort: NearbySort;
    featuredRestaurantIds: string[]; // pinned first
  };
  footer: {
    enabled: boolean;
    tagline: string;         // '' ⇒ fall back to brand.tagline
    blurb: string;
    columns: FooterColumn[];
    social: FooterSocial;
    legalLeft: string;       // '' ⇒ default "© YEAR Brand…"
    legalRight: string;
  };
}

// ── primitive coercers (mirror storefront-cms.ts) ───────────────────────────
const clampInt = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
};
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const bool = (v: unknown, dflt: boolean) => (typeof v === 'boolean' ? v : dflt);
const url = (v: unknown, max = 2048) => str(v, max).trim();
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : dflt;
const idList = (v: unknown, max = 50) =>
  Array.isArray(v) ? v.map((x) => str(x, 64).trim()).filter(Boolean).slice(0, max) : [];

/** Defaults seed from the CURRENT hard-coded content so first load is identical. */
export function defaultDiscoveryConfig(): DiscoveryConfig {
  return {
    seo: {
      metaTitle: '',
      metaDescription: '',
      ogImage: '',
      keywords: '',
    },
    carousel: {
      enabled: true,
      autoplayMs: 5000,
      transition: 'slide' as CarouselTransition,
      transitionMs: 700,
      aspectRatio: '2:1' as CarouselAspectRatio,
      // The historical /restaurants carousel rendered full-bleed on phones
      // and inside md:container on desktop. The closest preset that preserves
      // that look is 'mobile-gutter' (full desktop, breathing room on phone).
      // Customers picking a new preset will override this. We keep 'wide'
      // (aspect 2:1, capped at 64vh) as the default height — same as the
      // legacy aspectRatio '2:1' so visual behaviour is unchanged for users
      // who haven't touched the new picker yet.
      width: 'mobile-gutter' as HeroWidth,
      height: 'wide' as HeroHeight,
      slides: DISCOVERY_BANNERS.map((b) => ({
        src: b.src,
        alt: b.alt,
        href: '',
        fallback: b.fallback,
        enabled: true,
        eyebrow: '',
        headline: '',
        subtext: '',
        ctaLabel: '',
        ctaHref: '',
        ctaStyle: 'primary' as SlideCtaStyle,
        objectFit: 'contain' as SlideObjectFit,
        focalPoint: 'center',
        overlayPosition: 'bottom-left' as SlideOverlayPosition,
        overlayDarkness: 60,
      })),
    },
    topOffers: {
      enabled: true,
      heading: 'Top offers today',
      subheading: '',
      limit: 10,
      pinnedOfferIds: [],
    },
    whatsOnYourMind: {
      enabled: true,
      heading: "What's on your mind?",
      tiles: DISCOVERY_CATEGORIES.map((c) => ({
        slug: c.slug,
        label: c.label,
        image: c.image,
        alt: c.label,
        enabled: true,
      })),
    },
    restaurantsNearby: {
      enabled: true,
      eyebrow: 'Restaurants near you',
      heading: "Pick what you're hungry for",
      subheading: '',
      defaultSort: 'newest',
      featuredRestaurantIds: [],
    },
    footer: {
      enabled: true,
      tagline: '',
      blurb:
        'A two-sided food marketplace — customers order, restaurants cook, our riders deliver. Built and operated from Andhra Pradesh, India.',
      columns: [
        {
          title: 'Company',
          links: [
            { label: 'About', href: '/about' },
            { label: 'Careers', href: '/careers' },
            { label: 'Contact', href: '/contact' },
            { label: 'Blog', href: '#' },
          ],
        },
        {
          title: 'For partners',
          links: [
            { label: 'Add your restaurant', href: '/signup/restaurant' },
            { label: 'Become a rider', href: '/signup/rider' },
            { label: 'How it works', href: '/#how-it-works' },
            { label: 'Restaurant login', href: '/login?role=staff' },
          ],
        },
        {
          title: 'Support',
          links: [
            { label: 'Help & FAQ', href: '/faq' },
            { label: 'Contact us', href: '/contact' },
            { label: 'Track your order', href: '/track' },
            { label: 'My orders', href: '/orders' },
          ],
        },
        {
          title: 'Legal',
          links: [
            { label: 'Privacy Policy', href: '/privacy' },
            { label: 'Terms of Service', href: '/terms' },
            { label: 'Refund & Cancellation', href: '/refunds' },
            { label: 'Cookie Policy', href: '/cookies' },
          ],
        },
      ],
      social: { twitter: '', instagram: '', facebook: '', linkedin: '', youtube: '' },
      legalLeft: '',
      legalRight: 'Built with care for kitchens, customers and riders.',
    },
  };
}

function parseSlide(s: unknown): CarouselSlide | null {
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>;
  const src = url(o.src);
  if (!src) return null;
  return {
    src,
    alt: str(o.alt, 240),
    href: url(o.href),
    fallback: str(o.fallback, 200) || 'from-[#ff5a2c] via-[#ff3b30] to-[#e0286f]',
    enabled: bool(o.enabled, true),
    eyebrow: str(o.eyebrow, 60),
    headline: str(o.headline, 120),
    subtext: str(o.subtext, 240),
    ctaLabel: str(o.ctaLabel, 40),
    ctaHref: url(o.ctaHref),
    ctaStyle: oneOf<SlideCtaStyle>(o.ctaStyle, SLIDE_CTA_STYLES, 'primary'),
    objectFit: oneOf<SlideObjectFit>(o.objectFit, SLIDE_OBJECT_FITS, 'contain'),
    focalPoint: str(o.focalPoint, 40) || 'center',
    overlayPosition: oneOf<SlideOverlayPosition>(o.overlayPosition, SLIDE_OVERLAY_POSITIONS, 'bottom-left'),
    overlayDarkness: clampInt(o.overlayDarkness, 0, 100, 60),
  };
}

/**
 * Resolve the best fallback image for a tile from the curated catalogue.
 * Matches by slug first, then by label-keyword (so "Indian Breads" picks up
 * the "breads" curated image). Returns '' if no match — the client-side
 * ImageWithFallback cascade in `whats-on-your-mind.tsx` has a generic
 * food-image as the final ladder rung in that case.
 */
function curatedTileImage(slug: string, label: string): string {
  const bySlug = DISCOVERY_CATEGORIES.find((c) => c.slug === slug);
  if (bySlug?.image) return bySlug.image;
  const labelLow = label.toLowerCase();
  const byLabel = DISCOVERY_CATEGORIES.find(
    (c) => c.label.toLowerCase() === labelLow || c.match.some((m) => labelLow.includes(m)),
  );
  return byLabel?.image ?? '';
}

function parseTile(t: unknown): CategoryTile | null {
  if (!t || typeof t !== 'object') return null;
  const o = t as Record<string, unknown>;
  const slug = str(o.slug, 64).trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const label = str(o.label, 60).trim();
  if (!slug || !label) return null;
  // Two-step image resolution:
  //   (a) If the admin saved an explicit URL, use it — UNLESS it's a
  //       local same-origin path whose file no longer exists on disk
  //       (orphaned CMS upload, env-mismatched DB sync, accidental
  //       deletion). In that case treat the URL as missing.
  //   (b) Fall back to the curated catalog image by slug or label match.
  //   (c) Final fallback to '' lets the client cascade pick a generic.
  //
  // This is the load-bearing fix for "the tile shows a pink placeholder
  // even though the CMS says it has an image" — the URL in the DB is a
  // 404 on prod, and we now detect that at render time.
  const explicitImage = url(o.image);
  const usableImage = explicitImage && localFileExists(explicitImage)
    ? explicitImage
    : '';
  return {
    slug,
    label,
    image: usableImage || curatedTileImage(slug, label),
    alt: str(o.alt, 160),
    enabled: bool(o.enabled, true),
  };
}

function parseLink(l: unknown): FooterLink | null {
  if (!l || typeof l !== 'object') return null;
  const o = l as Record<string, unknown>;
  const label = str(o.label, 60).trim();
  if (!label) return null;
  return { label, href: url(o.href) || '#' };
}

function parseColumn(c: unknown): FooterColumn | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Record<string, unknown>;
  const title = str(o.title, 60).trim();
  if (!title) return null;
  const links = Array.isArray(o.links)
    ? o.links.map(parseLink).filter((x): x is FooterLink => !!x).slice(0, 10)
    : [];
  return { title, links };
}

/** Merge a stored (possibly partial / untrusted / legacy) config over defaults. Never throws. */
export function parseDiscoveryConfig(raw: unknown): DiscoveryConfig {
  const d = defaultDiscoveryConfig();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, any>;
  const seo = r.seo ?? {};
  const carousel = r.carousel ?? {};
  const topOffers = r.topOffers ?? {};
  const woym = r.whatsOnYourMind ?? {};
  const nearby = r.restaurantsNearby ?? {};
  const footer = r.footer ?? {};
  const social = footer.social ?? {};

  const slides = Array.isArray(carousel.slides)
    ? carousel.slides.map(parseSlide).filter((x: CarouselSlide | null): x is CarouselSlide => !!x).slice(0, 12)
    : d.carousel.slides;
  const tiles = Array.isArray(woym.tiles)
    ? woym.tiles.map(parseTile).filter((x: CategoryTile | null): x is CategoryTile => !!x).slice(0, 30)
    : d.whatsOnYourMind.tiles;
  const columns = Array.isArray(footer.columns)
    ? footer.columns.map(parseColumn).filter((x: FooterColumn | null): x is FooterColumn => !!x).slice(0, 6)
    : d.footer.columns;

  return {
    seo: {
      metaTitle: str(seo.metaTitle, 120),
      metaDescription: str(seo.metaDescription, 320),
      ogImage: url(seo.ogImage),
      keywords: str(seo.keywords, 320),
    },
    carousel: {
      enabled: bool(carousel.enabled, d.carousel.enabled),
      autoplayMs: clampInt(carousel.autoplayMs, 0, 30000, d.carousel.autoplayMs),
      transition: oneOf<CarouselTransition>(carousel.transition, CAROUSEL_TRANSITIONS, d.carousel.transition),
      transitionMs: clampInt(carousel.transitionMs, 200, 2000, d.carousel.transitionMs),
      aspectRatio: oneOf<CarouselAspectRatio>(carousel.aspectRatio, CAROUSEL_ASPECT_RATIOS, d.carousel.aspectRatio),
      // New width/height presets (see HeroWidth / HeroHeight). Both fall back
      // to defaults when missing so legacy configs render the same as before.
      width: oneOf<HeroWidth>(carousel.width, HERO_WIDTHS, d.carousel.width),
      height: oneOf<HeroHeight>(carousel.height, HERO_HEIGHTS, d.carousel.height),
      slides,
    },
    topOffers: {
      enabled: bool(topOffers.enabled, d.topOffers.enabled),
      heading: str(topOffers.heading, 80) || d.topOffers.heading,
      subheading: str(topOffers.subheading, 200),
      limit: clampInt(topOffers.limit, 1, 30, d.topOffers.limit),
      pinnedOfferIds: idList(topOffers.pinnedOfferIds),
    },
    whatsOnYourMind: {
      enabled: bool(woym.enabled, d.whatsOnYourMind.enabled),
      heading: str(woym.heading, 80) || d.whatsOnYourMind.heading,
      tiles,
    },
    restaurantsNearby: {
      enabled: bool(nearby.enabled, d.restaurantsNearby.enabled),
      eyebrow: str(nearby.eyebrow, 80) || d.restaurantsNearby.eyebrow,
      heading: str(nearby.heading, 120) || d.restaurantsNearby.heading,
      subheading: str(nearby.subheading, 240),
      defaultSort: oneOf<NearbySort>(nearby.defaultSort, ['newest', 'name'], d.restaurantsNearby.defaultSort),
      featuredRestaurantIds: idList(nearby.featuredRestaurantIds),
    },
    footer: {
      enabled: bool(footer.enabled, d.footer.enabled),
      tagline: str(footer.tagline, 160),
      blurb: str(footer.blurb, 600) || d.footer.blurb,
      columns,
      social: {
        twitter: url(social.twitter),
        instagram: url(social.instagram),
        facebook: url(social.facebook),
        linkedin: url(social.linkedin),
        youtube: url(social.youtube),
      },
      legalLeft: str(footer.legalLeft, 200),
      legalRight: str(footer.legalRight, 200) || d.footer.legalRight,
    },
  };
}

/**
 * Read the live discovery config (defaults when no row / on any error).
 *
 * Hot path: every customer page-load reads this. We cache it for 5 minutes
 * with a 30s stale-while-revalidate window — admins edit it rarely, customers
 * see it constantly. `saveDiscoveryConfig` invalidates the tag below, so an
 * admin change shows up on the very next read.
 */
export async function getDiscoveryConfig(): Promise<DiscoveryConfig> {
  const cached = await wrap<DiscoveryConfig>(
    [keys.discoveryConfig()],
    { ttlMs: 5 * 60_000, staleMs: 30_000, tags: ['discovery:config'], label: 'discovery.config' },
    async () => {
      try {
        const row = await (prisma as any).siteContent.findUnique({ where: { key: DISCOVERY_CONTENT_KEY } });
        return parseDiscoveryConfig(row?.data);
      } catch {
        return defaultDiscoveryConfig();
      }
    },
  );
  // wrap returns the cached value or the result of compute. Both are guaranteed
  // non-null here because parseDiscoveryConfig always returns a real object.
  return cached ?? defaultDiscoveryConfig();
}

/** Validate + persist the discovery config. Returns the parsed (clean) config. */
export async function saveDiscoveryConfig(raw: unknown, updatedBy?: string): Promise<DiscoveryConfig> {
  const clean = parseDiscoveryConfig(raw);
  await (prisma as any).siteContent.upsert({
    where: { key: DISCOVERY_CONTENT_KEY },
    create: { key: DISCOVERY_CONTENT_KEY, data: clean as any, updatedBy: updatedBy ?? null },
    update: { data: clean as any, updatedBy: updatedBy ?? null },
  });
  // Stamp the cache so the next read picks up the change immediately.
  await invalidateTag('discovery:config');
  return clean;
}
