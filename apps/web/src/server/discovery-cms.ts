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

import { prisma } from '@/server/db';
import { DISCOVERY_BANNERS } from '@/lib/discovery-banners';
import { DISCOVERY_CATEGORIES } from '@/lib/discovery-categories';

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
    /** Banner shape. */
    aspectRatio: CarouselAspectRatio;
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

function parseTile(t: unknown): CategoryTile | null {
  if (!t || typeof t !== 'object') return null;
  const o = t as Record<string, unknown>;
  const slug = str(o.slug, 64).trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const label = str(o.label, 60).trim();
  if (!slug || !label) return null;
  return {
    slug,
    label,
    image: url(o.image),
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

/** Read the live discovery config (defaults when no row / on any error). */
export async function getDiscoveryConfig(): Promise<DiscoveryConfig> {
  try {
    const row = await (prisma as any).siteContent.findUnique({ where: { key: DISCOVERY_CONTENT_KEY } });
    return parseDiscoveryConfig(row?.data);
  } catch {
    return defaultDiscoveryConfig();
  }
}

/** Validate + persist the discovery config. Returns the parsed (clean) config. */
export async function saveDiscoveryConfig(raw: unknown, updatedBy?: string): Promise<DiscoveryConfig> {
  const clean = parseDiscoveryConfig(raw);
  await (prisma as any).siteContent.upsert({
    where: { key: DISCOVERY_CONTENT_KEY },
    create: { key: DISCOVERY_CONTENT_KEY, data: clean as any, updatedBy: updatedBy ?? null },
    update: { data: clean as any, updatedBy: updatedBy ?? null },
  });
  return clean;
}
