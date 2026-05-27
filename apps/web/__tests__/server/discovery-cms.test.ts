import { describe, it, expect } from 'vitest';
import { parseDiscoveryConfig, defaultDiscoveryConfig } from '@/server/discovery-cms';

describe('discovery-cms config', () => {
  it('returns full defaults for null/garbage', () => {
    expect(parseDiscoveryConfig(null)).toEqual(defaultDiscoveryConfig());
    expect(parseDiscoveryConfig('nope')).toEqual(defaultDiscoveryConfig());
    expect(parseDiscoveryConfig(42)).toEqual(defaultDiscoveryConfig());
  });

  it('seeds the carousel + tiles from the current hard-coded content', () => {
    const d = defaultDiscoveryConfig();
    expect(d.carousel.slides.length).toBeGreaterThan(0);
    expect(d.whatsOnYourMind.tiles.length).toBeGreaterThan(0);
    expect(d.carousel.slides[0].enabled).toBe(true);
  });

  it('merges a partial config over defaults', () => {
    const c = parseDiscoveryConfig({ topOffers: { heading: 'Hot deals' } });
    expect(c.topOffers.heading).toBe('Hot deals');
    expect(c.topOffers.limit).toBe(10); // default kept
    expect(c.carousel.enabled).toBe(true);
  });

  it('clamps the offers limit and carousel autoplay', () => {
    expect(parseDiscoveryConfig({ topOffers: { limit: 999 } }).topOffers.limit).toBe(30);
    expect(parseDiscoveryConfig({ topOffers: { limit: 0 } }).topOffers.limit).toBe(1);
    expect(parseDiscoveryConfig({ carousel: { autoplayMs: 999999 } }).carousel.autoplayMs).toBe(30000);
    expect(parseDiscoveryConfig({ carousel: { autoplayMs: -5 } }).carousel.autoplayMs).toBe(0);
  });

  it('drops carousel slides with no image but keeps valid ones', () => {
    const c = parseDiscoveryConfig({
      carousel: { slides: [{ src: '', alt: 'x' }, { src: '/banners/a.jpg', alt: 'A', href: '/r/a' }] },
    });
    expect(c.carousel.slides).toHaveLength(1);
    expect(c.carousel.slides[0].src).toBe('/banners/a.jpg');
    expect(c.carousel.slides[0].href).toBe('/r/a');
    expect(c.carousel.slides[0].enabled).toBe(true);
  });

  it('normalises category tile slugs and requires a label', () => {
    const c = parseDiscoveryConfig({
      whatsOnYourMind: { tiles: [{ slug: 'Hot Pizza!', label: 'Pizza', image: '/x.jpg' }, { slug: 'no-label', label: '' }] },
    });
    expect(c.whatsOnYourMind.tiles).toHaveLength(1);
    expect(c.whatsOnYourMind.tiles[0].slug).toBe('hot-pizza-');
  });

  it('validates the default sort and keeps pinned id lists', () => {
    expect(parseDiscoveryConfig({ restaurantsNearby: { defaultSort: 'bogus' } }).restaurantsNearby.defaultSort).toBe('newest');
    expect(parseDiscoveryConfig({ restaurantsNearby: { defaultSort: 'name' } }).restaurantsNearby.defaultSort).toBe('name');
    const c = parseDiscoveryConfig({ topOffers: { pinnedOfferIds: ['a', 'b', 123, ''] } });
    expect(c.topOffers.pinnedOfferIds).toEqual(['a', 'b']);
  });

  it('drops footer columns without a title and links without a label', () => {
    const c = parseDiscoveryConfig({
      footer: { columns: [{ title: '', links: [] }, { title: 'Company', links: [{ label: 'About', href: '/about' }, { label: '', href: '/x' }] }] },
    });
    expect(c.footer.columns).toHaveLength(1);
    expect(c.footer.columns[0].title).toBe('Company');
    expect(c.footer.columns[0].links).toHaveLength(1);
  });
});
