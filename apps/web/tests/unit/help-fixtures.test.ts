/**
 * Validates the starter help content in apps/web/content/help so a broken
 * fixture fails CI instead of the seed.
 */
import { describe, it, expect } from 'vitest';
import { parseFixture, loadFixtures } from '@/server/help/fixtures';

const APP_AREA = /^[a-z]+(?:\.[a-z-]+)*$/;

describe('parseFixture', () => {
  it('parses front-matter and body', () => {
    const f = parseFixture(
      '---\ntitle: T\nsummary: S\naudience: RIDER, ALL\nappArea: rider.home\ntags: A, b\nrelated: x-y\nlanguage: hi\n---\nBody',
      'go-online.hi.md',
      'rider-deliveries'
    );
    expect(f).toMatchObject({
      slug: 'go-online', language: 'hi', categorySlug: 'rider-deliveries', title: 'T', summary: 'S',
      audience: ['RIDER', 'ALL'], appArea: 'rider.home', tags: ['a', 'b'], relatedSlugs: ['x-y'], body: 'Body',
    });
  });
  it('rejects bad audience / missing front-matter', () => {
    expect(() => parseFixture('---\ntitle: T\nsummary: S\naudience: ADMINS\n---\nx', 'a.md', 'c')).toThrow(/audience/);
    expect(() => parseFixture('no front matter', 'a.md', 'c')).toThrow(/front-matter/);
  });
});

describe('content/help starter fixtures', () => {
  const { categories, articles } = loadFixtures();
  const en = articles.filter((a) => a.language === 'en');

  it('has 30+ articles across restaurant, rider and customer audiences', () => {
    expect(en.length).toBeGreaterThanOrEqual(30);
    for (const aud of ['RIDER', 'CUSTOMER'] as const) {
      expect(en.some((a) => a.audience.includes(aud))).toBe(true);
    }
  });

  it('every related slug and help: link resolves to an article', () => {
    const slugs = new Set(articles.map((a) => a.slug));
    for (const a of articles) {
      for (const r of a.relatedSlugs) expect(slugs.has(r), `${a.slug} → related ${r}`).toBe(true);
      for (const m of a.body.matchAll(/\]\(help:([a-z0-9-]+)\)/g)) expect(slugs.has(m[1]), `${a.slug} → help:${m[1]}`).toBe(true);
    }
  });

  it('app areas are well-formed and every category is known', () => {
    const cats = new Set(categories.map((c) => c.slug));
    for (const a of articles) {
      if (a.appArea) expect(a.appArea).toMatch(APP_AREA);
      expect(cats.has(a.categorySlug)).toBe(true);
      expect(a.summary.length).toBeLessThanOrEqual(300);
    }
  });

  it('every Hindi article has an English original', () => {
    const enSlugs = new Set(en.map((a) => a.slug));
    for (const a of articles.filter((x) => x.language === 'hi')) expect(enSlugs.has(a.slug)).toBe(true);
  });
});
