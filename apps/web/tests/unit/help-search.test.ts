import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  prisma: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    helpArticle: { findMany: vi.fn() },
    helpSearchLog: { create: vi.fn() },
  },
}));
vi.mock('@/server/db', () => ({ prisma: h.prisma }));
vi.mock('@/server/log', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { normalizeQuery, searchArticles, logSearch, MAX_QUERY_LEN } from '@/server/help/search';

const hit = (o: Record<string, unknown> = {}) => ({
  id: 'a1', slug: 'order-statuses', title: 'Order statuses', titleHl: '⟦Order⟧ statuses', summary: 's',
  snippet: 'the\n  ⟦order⟧   moves', appArea: 'admin.orders', categorySlug: 'orders', categoryTitle: 'Orders', rank: '0.5', ...o,
});

/** Joined static SQL text of a tagged-template call, and its bound values. */
function sqlOf(call: unknown[]): { text: string; values: unknown[] } {
  const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];
  return { text: Array.from(strings).join('?'), values };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('normalizeQuery', () => {
  it('trims, lower-cases, collapses whitespace, strips control chars and highlight sentinels', () => {
    expect(normalizeQuery('  KOT\u0000  Printing\n\t ⟦x⟧ ')).toBe('kot printing x');
  });
  it('caps length', () => {
    expect(normalizeQuery('a'.repeat(500)).length).toBe(MAX_QUERY_LEN);
  });
  it('handles null/undefined', () => {
    expect(normalizeQuery(null)).toBe('');
    expect(normalizeQuery(undefined)).toBe('');
  });
});

describe('searchArticles', () => {
  it('does not touch the DB for an empty query', async () => {
    const r = await searchArticles('   ', { audiences: ['RIDER', 'ALL'], language: 'en' });
    expect(r).toEqual({ query: '', mode: 'empty', hits: [] });
    expect(h.prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('runs FTS with the user query only as bound parameters (SQL injection safe)', async () => {
    h.prisma.$queryRaw.mockResolvedValueOnce([hit()]);
    const evil = `x'); DROP TABLE "HelpArticle"; --`;
    const r = await searchArticles(evil, { audiences: ['RIDER', 'ALL'], language: 'en' });
    expect(r.mode).toBe('fts');
    const { text, values } = sqlOf(h.prisma.$queryRaw.mock.calls[0]);
    expect(text).not.toContain('DROP TABLE');
    expect(text).toContain('websearch_to_tsquery');
    expect(text).toContain('ts_headline');
    expect(text).toContain(`a.status = 'PUBLISHED'`);
    expect(values).toContain(normalizeQuery(evil));
    expect(values).toContainEqual(['RIDER', 'ALL']);
  });

  it('ranks as returned, converts rank to number and tidies snippet whitespace', async () => {
    h.prisma.$queryRaw.mockResolvedValueOnce([hit({ rank: '0.9' }), hit({ slug: 'b', rank: 0.2 })]);
    const r = await searchArticles('order', { audiences: ['KITCHEN', 'ALL'], language: 'en' });
    expect(r.hits.map((x) => [x.slug, x.rank])).toEqual([['order-statuses', 0.9], ['b', 0.2]]);
    expect(r.hits[0].snippet).toBe('the ⟦order⟧ moves');
  });

  it('falls back to pg_trgm similarity when FTS has no match (typos)', async () => {
    h.prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([hit({ snippet: '' })]);
    const r = await searchArticles('ordr staus', { audiences: ['RESTAURANT_ADMIN', 'ALL'], language: 'en' });
    expect(r.mode).toBe('fuzzy');
    const { text, values } = sqlOf(h.prisma.$queryRaw.mock.calls[1]);
    expect(text).toContain('word_similarity');
    expect(values).toContain('ordr staus');
  });

  it('skips the fuzzy fallback for very short queries', async () => {
    h.prisma.$queryRaw.mockResolvedValueOnce([]);
    const r = await searchArticles('the', { audiences: ['RIDER'], language: 'en' });
    expect(r.hits).toEqual([]);
    expect(h.prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('uses the substring fallback when pg_trgm is not installed', async () => {
    h.prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('Raw query failed. Code: `42883`. Message: `function word_similarity(text, text) does not exist`'));
    h.prisma.helpArticle.findMany.mockResolvedValueOnce([
      { id: 'a', slug: 'kot-printing', title: 'KOT printing', summary: 's', appArea: null, category: null },
    ]);
    const r = await searchArticles('kot printer', { audiences: ['KITCHEN', 'ALL'], language: 'en' });
    expect(r.mode).toBe('basic');
    expect(r.hits[0].slug).toBe('kot-printing');
    const where = h.prisma.helpArticle.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ status: 'PUBLISHED', language: 'en', audience: { hasSome: ['KITCHEN', 'ALL'] } });
  });

  it('rethrows unrelated DB errors from the fuzzy step', async () => {
    h.prisma.$queryRaw.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('connection lost'));
    await expect(searchArticles('payouts', { audiences: ['RIDER'], language: 'en' })).rejects.toThrow('connection lost');
  });
});

describe('logSearch', () => {
  it('writes a row and never throws', async () => {
    h.prisma.helpSearchLog.create.mockRejectedValueOnce(new Error('db down'));
    await expect(logSearch({ query: 'x', resultsCount: 0, language: 'en', source: 'web' })).resolves.toBeUndefined();
  });
  it('ignores empty queries', async () => {
    await logSearch({ query: '', resultsCount: 0, language: 'en', source: 'web' });
    expect(h.prisma.helpSearchLog.create).not.toHaveBeenCalled();
  });
});
