/**
 * Storefront CMS config — a WordPress-like, granular page builder.
 *
 * The restaurant admin edits a flexible JSON blob (Restaurant.storefrontConfig)
 * at /admin/storefront to control their public `/r/<slug>` page end-to-end:
 *
 *   • hero        — cover image OR a transitioning carousel of slides
 *   • branding    — tagline + accent colour
 *   • theme       — secondary colour, font pairing, button radius, card style
 *   • announcement— a dismissible top bar (promo / notice)
 *   • about       — a "story" section (title + body + optional image)
 *   • social      — social/contact links rendered in the footer
 *   • seo         — meta title / description / OG image for search + sharing
 *   • footer      — custom footer note
 *   • blocks      — composable content blocks (richtext / image / cta /
 *                   gallery / embed / spacer) placed above OR below the menu
 *   • layout      — section toggles (search/filters/offers/top-sellers) + menu layout
 *
 * `parseStorefrontConfig` ALWAYS returns a complete, validated object by merging
 * stored values over sensible defaults — so a brand-new restaurant (null config)
 * ships with a fully-working, customisable storefront, an OLD config (missing
 * the newer keys) is transparently upgraded, and a partially-saved/oversized/
 * malformed config can never break rendering.
 */

export type HeroType = 'cover' | 'carousel';
export type HeroTransition = 'slide' | 'fade' | 'zoom';
export type MenuLayout = 'list' | 'grid';
export type FontPair = 'modern' | 'classic' | 'playful' | 'editorial';
export type ButtonRadius = 'sharp' | 'rounded' | 'pill';
export type CardStyle = 'flat' | 'shadow' | 'border';
export type BlockType = 'richtext' | 'image' | 'cta' | 'gallery' | 'embed' | 'spacer';
export type BlockPosition = 'top' | 'bottom';
export type Align = 'left' | 'center' | 'right';

export interface HeroSlide {
  src: string;          // image URL (under /public or absolute)
  headline?: string;
  subtext?: string;
  ctaLabel?: string;
  ctaHref?: string;
}

export interface SocialLinks {
  instagram?: string;
  facebook?: string;
  twitter?: string;
  youtube?: string;
  whatsapp?: string;
  website?: string;
}

export interface ContentBlock {
  id: string;
  type: BlockType;
  position: BlockPosition;   // relative to the menu (above / below)
  align: Align;
  title?: string;
  // richtext
  body?: string;
  // image
  src?: string;
  alt?: string;
  // cta
  ctaLabel?: string;
  ctaHref?: string;
  // gallery
  images?: string[];
  // embed (YouTube / Maps / any iframe-able URL)
  embedUrl?: string;
  // spacer
  height?: number;           // px
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
  theme: {
    secondaryColor: string; // hex, secondary accent (gradients / highlights)
    fontPair: FontPair;
    buttonRadius: ButtonRadius;
    cardStyle: CardStyle;
  };
  announcement: {
    enabled: boolean;
    text: string;
    linkLabel: string;
    linkHref: string;
    bgColor: string;        // hex
    textColor: string;      // hex
  };
  about: {
    enabled: boolean;
    title: string;
    body: string;
    imageSrc: string;       // '' ⇒ no image
  };
  social: SocialLinks;
  seo: {
    metaTitle: string;      // '' ⇒ fall back to restaurant name
    metaDescription: string;
    ogImage: string;        // '' ⇒ fall back to hero/cover
  };
  footer: {
    text: string;           // '' ⇒ no custom footer note
  };
  blocks: ContentBlock[];
  layout: {
    showSearch: boolean;
    showFilters: boolean;
    showOffersStrip: boolean;
    showTopSellers: boolean;
    menuLayout: MenuLayout;
  };
}

export const HERO_TRANSITIONS: HeroTransition[] = ['slide', 'fade', 'zoom'];
export const FONT_PAIRS: FontPair[] = ['modern', 'classic', 'playful', 'editorial'];
export const BUTTON_RADII: ButtonRadius[] = ['sharp', 'rounded', 'pill'];
export const CARD_STYLES: CardStyle[] = ['flat', 'shadow', 'border'];
export const BLOCK_TYPES: BlockType[] = ['richtext', 'image', 'cta', 'gallery', 'embed', 'spacer'];

/** CSS font-family stacks for each font pairing (heading, body). */
export const FONT_STACKS: Record<FontPair, { heading: string; body: string }> = {
  modern:    { heading: '"Plus Jakarta Sans", "Inter", system-ui, sans-serif', body: '"Inter", system-ui, sans-serif' },
  classic:   { heading: '"Playfair Display", Georgia, serif',                  body: '"Source Sans 3", system-ui, sans-serif' },
  playful:   { heading: '"Poppins", system-ui, sans-serif',                    body: '"Nunito", system-ui, sans-serif' },
  editorial: { heading: '"Fraunces", Georgia, serif',                          body: '"Newsreader", Georgia, serif' },
};

/** px border-radius for each button-radius preset. */
export const RADIUS_PX: Record<ButtonRadius, number> = { sharp: 4, rounded: 12, pill: 999 };

export function defaultStorefrontConfig(): StorefrontConfig {
  return {
    hero: { type: 'cover', transition: 'slide', autoplayMs: 5000, slides: [] },
    branding: { tagline: '', accentColor: '#f23e5c' },
    theme: { secondaryColor: '#7c3aed', fontPair: 'modern', buttonRadius: 'pill', cardStyle: 'shadow' },
    announcement: { enabled: false, text: '', linkLabel: '', linkHref: '', bgColor: '#111827', textColor: '#ffffff' },
    about: { enabled: false, title: 'Our story', body: '', imageSrc: '' },
    social: {},
    seo: { metaTitle: '', metaDescription: '', ogImage: '' },
    footer: { text: '' },
    blocks: [],
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
const hex = (v: unknown, dflt: string) => (HEX.test(str(v)) ? str(v) : dflt);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : dflt);
/** A URL/path field: trimmed, length-bounded, '' when absent. */
const url = (v: unknown, max = 2048) => str(v, max).trim();

function parseSlide(s: unknown): HeroSlide | null {
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>;
  const src = url(o.src);
  if (!src) return null;
  return {
    src,
    headline: str(o.headline, 120) || undefined,
    subtext: str(o.subtext, 240) || undefined,
    ctaLabel: str(o.ctaLabel, 40) || undefined,
    ctaHref: url(o.ctaHref) || undefined,
  };
}

let blockSeq = 0;
function parseBlock(b: unknown): ContentBlock | null {
  if (!b || typeof b !== 'object') return null;
  const o = b as Record<string, unknown>;
  const type = oneOf<BlockType>(o.type, BLOCK_TYPES, 'richtext');
  const id = str(o.id, 64) || `blk_${Date.now().toString(36)}_${(blockSeq++).toString(36)}`;
  const base: ContentBlock = {
    id,
    type,
    position: oneOf<BlockPosition>(o.position, ['top', 'bottom'], 'bottom'),
    align: oneOf<Align>(o.align, ['left', 'center', 'right'], 'left'),
    title: str(o.title, 160) || undefined,
  };
  switch (type) {
    case 'richtext':
      base.body = str(o.body, 4000) || undefined;
      break;
    case 'image':
      base.src = url(o.src) || undefined;
      base.alt = str(o.alt, 200) || undefined;
      if (!base.src) return null; // an image block with no image is meaningless
      break;
    case 'cta':
      base.body = str(o.body, 600) || undefined;
      base.ctaLabel = str(o.ctaLabel, 60) || undefined;
      base.ctaHref = url(o.ctaHref) || undefined;
      break;
    case 'gallery': {
      const imgs = Array.isArray(o.images) ? o.images.map((x) => url(x)).filter(Boolean).slice(0, 12) : [];
      base.images = imgs;
      if (imgs.length === 0) return null;
      break;
    }
    case 'embed':
      base.embedUrl = url(o.embedUrl) || undefined;
      if (!base.embedUrl) return null;
      break;
    case 'spacer':
      base.height = clampInt(o.height, 8, 240, 48);
      break;
  }
  return base;
}

function parseSocial(raw: unknown): SocialLinks {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  const out: SocialLinks = {};
  for (const k of ['instagram', 'facebook', 'twitter', 'youtube', 'whatsapp', 'website'] as const) {
    const v = url(o[k]);
    if (v) out[k] = v;
  }
  return out;
}

/** Merge a stored (possibly partial / untrusted / legacy) config over defaults. Never throws. */
export function parseStorefrontConfig(raw: unknown): StorefrontConfig {
  const d = defaultStorefrontConfig();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, any>;
  const hero = r.hero ?? {};
  const branding = r.branding ?? {};
  const theme = r.theme ?? {};
  const announcement = r.announcement ?? {};
  const about = r.about ?? {};
  const seo = r.seo ?? {};
  const footer = r.footer ?? {};
  const layout = r.layout ?? {};

  const slides = Array.isArray(hero.slides)
    ? hero.slides.map(parseSlide).filter((x: HeroSlide | null): x is HeroSlide => !!x).slice(0, 10)
    : d.hero.slides;
  const blocks = Array.isArray(r.blocks)
    ? r.blocks.map(parseBlock).filter((x: ContentBlock | null): x is ContentBlock => !!x).slice(0, 30)
    : d.blocks;

  return {
    hero: {
      type: hero.type === 'carousel' ? 'carousel' : 'cover',
      transition: oneOf<HeroTransition>(hero.transition, HERO_TRANSITIONS, d.hero.transition),
      autoplayMs: clampInt(hero.autoplayMs, 0, 30000, d.hero.autoplayMs),
      slides,
    },
    branding: {
      tagline: str(branding.tagline, 160),
      accentColor: hex(branding.accentColor, d.branding.accentColor),
    },
    theme: {
      secondaryColor: hex(theme.secondaryColor, d.theme.secondaryColor),
      fontPair: oneOf<FontPair>(theme.fontPair, FONT_PAIRS, d.theme.fontPair),
      buttonRadius: oneOf<ButtonRadius>(theme.buttonRadius, BUTTON_RADII, d.theme.buttonRadius),
      cardStyle: oneOf<CardStyle>(theme.cardStyle, CARD_STYLES, d.theme.cardStyle),
    },
    announcement: {
      enabled: bool(announcement.enabled, d.announcement.enabled),
      text: str(announcement.text, 240),
      linkLabel: str(announcement.linkLabel, 60),
      linkHref: url(announcement.linkHref),
      bgColor: hex(announcement.bgColor, d.announcement.bgColor),
      textColor: hex(announcement.textColor, d.announcement.textColor),
    },
    about: {
      enabled: bool(about.enabled, d.about.enabled),
      title: str(about.title, 120) || d.about.title,
      body: str(about.body, 4000),
      imageSrc: url(about.imageSrc),
    },
    social: parseSocial(r.social),
    seo: {
      metaTitle: str(seo.metaTitle, 120),
      metaDescription: str(seo.metaDescription, 320),
      ogImage: url(seo.ogImage),
    },
    footer: { text: str(footer.text, 600) },
    blocks,
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

/**
 * CSS custom properties + font stack derived from the theme, applied as inline
 * style on the storefront wrapper. Keeps theming contained to the new CMS
 * sections + accent-driven controls without overriding the global design tokens.
 */
export function themeStyleVars(cfg: StorefrontConfig): Record<string, string> {
  const fonts = FONT_STACKS[cfg.theme.fontPair];
  return {
    '--sf-accent': cfg.branding.accentColor,
    '--sf-secondary': cfg.theme.secondaryColor,
    '--sf-btn-radius': `${RADIUS_PX[cfg.theme.buttonRadius]}px`,
    '--sf-font-heading': fonts.heading,
    '--sf-font-body': fonts.body,
  };
}
