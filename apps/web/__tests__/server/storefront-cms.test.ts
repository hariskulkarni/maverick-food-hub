import { describe, it, expect } from 'vitest';
import { parseStorefrontConfig, defaultStorefrontConfig, effectiveHeroSlides } from '@/server/storefront-cms';

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
    expect(effectiveHeroSlides(carousel, '/cover.jpg')).toEqual([{ src: '/s1.jpg' }]);
  });
});
