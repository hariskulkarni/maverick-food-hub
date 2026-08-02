import { describe, it, expect } from 'vitest';
import { parseStorefrontConfig, defaultStorefrontConfig, effectiveHeroSlides, themeStyleVars } from '@/server/storefront-cms';

describe('storefront-cms config', () => {
  it('returns full defaults for null/garbage', () => {
    expect(parseStorefrontConfig(null)).toEqual(defaultStorefrontConfig());
    expect(parseStorefrontConfig('nope')).toEqual(defaultStorefrontConfig());
    expect(parseStorefrontConfig(42)).toEqual(defaultStorefrontConfig());
  });

  it('merges a partial config over defaults', () => {
    const c = parseStorefrontConfig({ branding: { tagline: 'Best biryani in town' } });
    expect(c.branding.tagline).toBe('Best biryani in town');
    expect(c.branding.accentColor).toBe('#f23e5c'); // default kept
    expect(c.layout.showSearch).toBe(true);
  });

  it('validates accent color hex; rejects bad values', () => {
    expect(parseStorefrontConfig({ branding: { accentColor: '#abc' } }).branding.accentColor).toBe('#abc');
    expect(parseStorefrontConfig({ branding: { accentColor: 'red' } }).branding.accentColor).toBe('#f23e5c');
  });

  it('clamps autoplay and validates transition', () => {
    expect(parseStorefrontConfig({ hero: { autoplayMs: 999999 } }).hero.autoplayMs).toBe(30000);
    expect(parseStorefrontConfig({ hero: { autoplayMs: -5 } }).hero.autoplayMs).toBe(0);
    expect(parseStorefrontConfig({ hero: { transition: 'spin' } }).hero.transition).toBe('slide');
    expect(parseStorefrontConfig({ hero: { transition: 'fade' } }).hero.transition).toBe('fade');
  });

  it('falls back to default hero width + height when missing (legacy config)', () => {
    const c = parseStorefrontConfig({ hero: { type: 'cover' } });
    // Defaults preserve historical look so existing storefronts don't change.
    expect(c.hero.width).toBe('full-bleed');
    expect(c.hero.height).toBe('wide');
  });

  it('parses every valid hero width preset', () => {
    for (const w of ['full-bleed','wide-95','container','card','narrow','reading','mobile-gutter'] as const) {
      expect(parseStorefrontConfig({ hero: { width: w } }).hero.width).toBe(w);
    }
  });

  it('parses every valid hero height preset', () => {
    for (const h of ['compact','standard','tall','cinematic','wide','classic','half-screen','full-screen'] as const) {
      expect(parseStorefrontConfig({ hero: { height: h } }).hero.height).toBe(h);
    }
  });

  it('rejects garbage hero width / height and falls back to defaults', () => {
    const c = parseStorefrontConfig({ hero: { width: 'bogus-width', height: 42 } });
    expect(c.hero.width).toBe('full-bleed');
    expect(c.hero.height).toBe('wide');
  });

  it('parses + caps slides and drops invalid ones', () => {
    const c = parseStorefrontConfig({
      hero: { type: 'carousel', slides: [{ src: '/a.jpg', headline: 'Hi' }, { src: '' }, { nope: 1 }] },
    });
    expect(c.hero.type).toBe('carousel');
    expect(c.hero.slides).toHaveLength(1);
    expect(c.hero.slides[0]).toMatchObject({ src: '/a.jpg', headline: 'Hi' });
  });

  it('effectiveHeroSlides falls back to cover image when no carousel slides', () => {
    const d = defaultStorefrontConfig();
    expect(effectiveHeroSlides(d, '/cover.jpg')).toEqual([{ src: '/cover.jpg' }]);
    const carousel = parseStorefrontConfig({ hero: { type: 'carousel', slides: [{ src: '/s1.jpg' }] } });
    // The point here is that the carousel slide wins over the cover image.
    // Parsed slides are normalised (mediaType, video fields...), so match on
    // intent rather than pinning the whole shape.
    expect(effectiveHeroSlides(carousel, '/cover.jpg')).toMatchObject([{ src: '/s1.jpg' }]);
  });

  // ─── WordPress-like expansion ───────────────────────────────────────────

  it('upgrades a legacy config (missing new keys) to full defaults', () => {
    const legacy = { hero: { type: 'cover' }, branding: { tagline: 'X' }, layout: { showSearch: false } };
    const c = parseStorefrontConfig(legacy);
    expect(c.theme).toEqual(defaultStorefrontConfig().theme);
    expect(c.announcement.enabled).toBe(false);
    expect(c.about.enabled).toBe(false);
    expect(c.social).toEqual({});
    expect(c.seo).toEqual({ metaTitle: '', metaDescription: '', ogImage: '' });
    expect(c.blocks).toEqual([]);
    expect(c.layout.showSearch).toBe(false); // legacy value preserved
  });

  it('validates theme enums + colours', () => {
    const c = parseStorefrontConfig({
      theme: { secondaryColor: '#0af', fontPair: 'classic', buttonRadius: 'sharp', cardStyle: 'border' },
    });
    expect(c.theme).toEqual({ secondaryColor: '#0af', fontPair: 'classic', buttonRadius: 'sharp', cardStyle: 'border' });
    const bad = parseStorefrontConfig({ theme: { secondaryColor: 'purple', fontPair: 'comic', buttonRadius: 'huge', cardStyle: 'x' } });
    expect(bad.theme).toEqual(defaultStorefrontConfig().theme);
  });

  it('parses announcement + about + footer', () => {
    const c = parseStorefrontConfig({
      announcement: { enabled: true, text: 'Free delivery today!', linkLabel: 'Order', linkHref: '/menu', bgColor: '#000', textColor: '#fff' },
      about: { enabled: true, title: 'Since 1990', body: 'We grill over open flame.', imageSrc: '/story.jpg' },
      footer: { text: 'FSSAI 12345 · © Flavrly' },
    });
    expect(c.announcement).toEqual({ enabled: true, text: 'Free delivery today!', linkLabel: 'Order', linkHref: '/menu', bgColor: '#000', textColor: '#fff' });
    expect(c.about.enabled).toBe(true);
    expect(c.about.title).toBe('Since 1990');
    expect(c.footer.text).toBe('FSSAI 12345 · © Flavrly');
  });

  it('keeps only known social keys with non-empty values', () => {
    const c = parseStorefrontConfig({
      social: { instagram: 'https://instagram.com/x', facebook: '', tiktok: 'https://t', whatsapp: '+91...' },
    });
    expect(c.social).toEqual({ instagram: 'https://instagram.com/x', whatsapp: '+91...' });
    expect((c.social as any).tiktok).toBeUndefined();
  });

  it('parses content blocks per-type, drops empties, caps at 30', () => {
    const c = parseStorefrontConfig({
      blocks: [
        { id: 'a', type: 'richtext', position: 'top', body: 'Hello' },
        { type: 'image', src: '/p.jpg', alt: 'Plate' },
        { type: 'image' },                       // no src → dropped
        { type: 'gallery', images: ['/1.jpg', '/2.jpg', ''] },
        { type: 'gallery', images: [] },          // empty → dropped
        { type: 'embed', embedUrl: 'https://youtube.com/embed/x' },
        { type: 'embed' },                        // no url → dropped
        { type: 'cta', title: 'Book', ctaLabel: 'Reserve', ctaHref: '/reserve' },
        { type: 'spacer', height: 9999 },         // clamped
        { type: 'bogus' },                        // unknown → richtext (kept, empty body)
      ],
    });
    const kept = c.blocks;
    expect(kept).toHaveLength(7);
    expect(kept[0]).toMatchObject({ id: 'a', type: 'richtext', position: 'top', body: 'Hello' });
    expect(kept.find((b) => b.type === 'image')).toMatchObject({ src: '/p.jpg', alt: 'Plate' });
    expect(kept.find((b) => b.type === 'gallery')!.images).toEqual(['/1.jpg', '/2.jpg']);
    expect(kept.find((b) => b.type === 'spacer')!.height).toBe(240);
    // every block gets a stable id
    expect(kept.every((b) => typeof b.id === 'string' && b.id.length > 0)).toBe(true);
  });

  it('caps blocks at 30', () => {
    const many = Array.from({ length: 50 }, () => ({ type: 'spacer', height: 20 }));
    expect(parseStorefrontConfig({ blocks: many }).blocks).toHaveLength(30);
  });

  it('parses SEO fields with length bounds', () => {
    const c = parseStorefrontConfig({ seo: { metaTitle: 'T', metaDescription: 'D', ogImage: '/og.png' } });
    expect(c.seo).toEqual({ metaTitle: 'T', metaDescription: 'D', ogImage: '/og.png' });
    const long = parseStorefrontConfig({ seo: { metaTitle: 'x'.repeat(500) } });
    expect(long.seo.metaTitle.length).toBe(120);
  });

  it('themeStyleVars exposes CSS custom props from the theme', () => {
    const c = parseStorefrontConfig({ branding: { accentColor: '#123456' }, theme: { secondaryColor: '#abcdef', buttonRadius: 'sharp', fontPair: 'classic' } });
    const v = themeStyleVars(c);
    expect(v['--sf-accent']).toBe('#123456');
    expect(v['--sf-secondary']).toBe('#abcdef');
    expect(v['--sf-btn-radius']).toBe('4px');
    expect(v['--sf-font-heading']).toContain('Playfair');
  });
});
