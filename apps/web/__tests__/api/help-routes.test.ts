import { describe, it, expect, vi, beforeEach } from 'vitest';

type Sess = { user: { id: string; role: string; name?: string } } | null;
const h = vi.hoisted(() => ({
  session: null as Sess,
  riderSession: null as Sess,
  prisma: {
    helpArticle: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    helpArticleVersion: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    helpArticleFeedback: { upsert: vi.fn() },
    helpCategory: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    helpSearchLog: { create: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
  audit: vi.fn(),
}));
vi.mock('@/server/db', () => ({ prisma: h.prisma }));
vi.mock('@/server/auth', () => ({ auth: async () => h.session }));
vi.mock('@/server/rider-auth', () => ({ auth: async () => h.riderSession }));
vi.mock('@/server/audit', () => ({ audit: h.audit }));
vi.mock('@/server/http/rate-limit', () => ({ rateLimit: async () => ({ ok: true, remaining: 99 }) }));
vi.mock('@/server/log', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { GET as articlesGET } from '@/app/api/help/articles/route';
import { GET as articleGET } from '@/app/api/help/articles/[slug]/route';
import { POST as feedbackPOST } from '@/app/api/help/articles/[slug]/feedback/route';
import { GET as searchGET } from '@/app/api/help/search/route';
import { GET as categoriesGET } from '@/app/api/help/categories/route';
import { GET as riderIndexGET } from '@/app/api/rider/help/route';
import { GET as riderArticleGET } from '@/app/api/rider/help/articles/[slug]/route';
import { GET as riderSearchGET } from '@/app/api/rider/help/search/route';
import { POST as riderFeedbackPOST } from '@/app/api/rider/help/articles/[slug]/feedback/route';
import { GET as pArticlesGET, POST as pArticlesPOST } from '@/app/api/platform/help/articles/route';
import { PATCH as pArticlePATCH, DELETE as pArticleDELETE } from '@/app/api/platform/help/articles/[id]/route';
import { POST as pPublishPOST } from '@/app/api/platform/help/articles/[id]/publish/route';
import { POST as pRestorePOST } from '@/app/api/platform/help/articles/[id]/versions/[versionId]/restore/route';
import { POST as pCategoryPOST } from '@/app/api/platform/help/categories/route';
import { GET as pAnalyticsGET } from '@/app/api/platform/help/analytics/route';

const SUPER = { user: { id: 'su1', role: 'SUPER_ADMIN', name: 'Root' } };
const ADMIN = { user: { id: 'ad1', role: 'ADMIN' } };
const KITCHEN = { user: { id: 'k1', role: 'KITCHEN' } };
const RIDER = { user: { id: 'r1', role: 'RIDER' } };
const CUSTOMER = { user: { id: 'c1', role: 'CUSTOMER' } };

const req = (url: string, init?: RequestInit) => new Request(`http://x${url}`, init);
const json = (body: unknown, method = 'POST') =>
  ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as RequestInit;
const slugCtx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

const row = (o: Record<string, unknown> = {}) => ({
  id: 'a1', slug: 'order-statuses', language: 'en', title: 'Order statuses', summary: 'What each status means',
  body: '## Hi\n\nText', audience: ['RESTAURANT_ADMIN', 'KITCHEN'], tags: ['orders'], status: 'PUBLISHED',
  appArea: 'admin.orders', relatedSlugs: [], sortOrder: 0, version: 1, viewCount: 0, publishedAt: new Date(),
  categoryId: 'c1', category: { slug: 'orders', title: 'Orders' }, createdById: null, updatedById: null,
  createdAt: new Date('2026-10-01'), updatedAt: new Date('2026-10-02'), ...o,
});

const validArticle = {
  slug: 'kot-printing', language: 'en', title: 'Print a KOT', summary: 'How KOT printing works',
  body: '## Steps\n\n1. Open the order', audience: ['KITCHEN'], tags: ['kot'], appArea: 'kitchen.board',
};

beforeEach(() => {
  vi.resetAllMocks();
  h.session = null;
  h.riderSession = null;
  h.prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(h.prisma));
  h.prisma.helpArticle.update.mockResolvedValue(row());
  h.prisma.$executeRaw.mockResolvedValue(1);
});

// ─── Reader: audience filtering ─────────────────────────────────────────────

describe('GET /api/help/articles — audience comes from the session role', () => {
  it.each([
    [null, ['CUSTOMER', 'ALL']],
    [CUSTOMER, ['CUSTOMER', 'ALL']],
    [KITCHEN, ['KITCHEN', 'ALL']],
    [ADMIN, ['RESTAURANT_ADMIN', 'KITCHEN', 'ALL']],
    [RIDER, ['RIDER', 'ALL']],
  ])('%j sees %j', async (session, audiences) => {
    h.session = session as Sess;
    h.prisma.helpArticle.findMany.mockResolvedValue([]);
    const r = await articlesGET(req('/api/help/articles?appArea=admin.orders'));
    expect(r.status).toBe(200);
    const where = h.prisma.helpArticle.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ status: 'PUBLISHED', language: 'en', appArea: 'admin.orders', audience: { hasSome: audiences } });
  });

  it('ignores any audience the client tries to pass', async () => {
    h.session = CUSTOMER;
    h.prisma.helpArticle.findMany.mockResolvedValue([]);
    await articlesGET(req('/api/help/articles?audience=RESTAURANT_ADMIN'));
    expect(h.prisma.helpArticle.findMany.mock.calls[0][0].where.audience).toEqual({ hasSome: ['CUSTOMER', 'ALL'] });
  });

  it('400s on malformed filters', async () => {
    const r = await articlesGET(req('/api/help/articles?appArea=x;drop'));
    expect(r.status).toBe(400);
  });
});

describe('GET /api/help/articles/[slug]', () => {
  it('404s when the article is not visible to the viewer', async () => {
    h.session = CUSTOMER;
    h.prisma.helpArticle.findMany.mockResolvedValue([]);
    const r = await articleGET(req('/api/help/articles/order-statuses'), slugCtx('order-statuses'));
    expect(r.status).toBe(404);
    expect(h.prisma.helpArticle.findMany.mock.calls[0][0].where).toMatchObject({
      slug: 'order-statuses', status: 'PUBLISHED', audience: { hasSome: ['CUSTOMER', 'ALL'] },
    });
  });

  it('returns parsed blocks, prefers the requested language, falls back to English, counts a view', async () => {
    h.session = ADMIN;
    h.prisma.helpArticle.findMany.mockResolvedValueOnce([row(), row({ id: 'a2', language: 'hi', title: 'ऑर्डर' })]);
    const r = await articleGET(req('/api/help/articles/order-statuses?lang=hi'), slugCtx('order-statuses'));
    const j = await r.json();
    expect(j.article.title).toBe('ऑर्डर');
    expect(j.article.availableLanguages).toEqual(['en', 'hi']);
    expect(j.article.blocks[0]).toEqual({ type: 'h2', inline: [{ t: 'text', v: 'Hi' }] });
    expect(j.article).not.toHaveProperty('searchVector');
    expect(h.prisma.helpArticle.update).toHaveBeenCalledWith({ where: { id: 'a2' }, data: { viewCount: { increment: 1 } } });
  });

  it('404s for a slug that is not slug-shaped without querying', async () => {
    const r = await articleGET(req('/api/help/articles/..%2Fx'), slugCtx("../x'"));
    expect(r.status).toBe(404);
    expect(h.prisma.helpArticle.findMany).not.toHaveBeenCalled();
  });
});

describe('GET /api/help/categories', () => {
  it('lists only categories holding a visible article', async () => {
    h.session = RIDER;
    h.prisma.helpCategory.findMany.mockResolvedValue([
      { slug: 'rider-earnings', title: 'Earnings', description: null, audience: 'RIDER' },
      { slug: 'orders', title: 'Orders', description: null, audience: 'RESTAURANT_ADMIN' },
    ]);
    h.prisma.helpArticle.findMany.mockResolvedValue([
      { slug: 'withdraw', title: 'Withdraw', summary: 's', appArea: null, category: { slug: 'rider-earnings' } },
    ]);
    const j = await (await categoriesGET(req('/api/help/categories'))).json();
    expect(j.categories.map((c: { slug: string }) => c.slug)).toEqual(['rider-earnings']);
    expect(h.prisma.helpArticle.findMany.mock.calls[0][0].where.audience).toEqual({ hasSome: ['RIDER', 'ALL'] });
  });
});

describe('GET /api/help/search', () => {
  it('searches with session audiences and logs the query + result count', async () => {
    h.session = KITCHEN;
    h.prisma.$queryRaw.mockResolvedValueOnce([
      { id: 'a1', slug: 'kot', title: 'KOT', titleHl: 'KOT', summary: 's', snippet: '', appArea: null, categorySlug: null, categoryTitle: null, rank: 1 },
    ]);
    const j = await (await searchGET(req('/api/help/search?q=KOT%20Printing'))).json();
    expect(j.mode).toBe('fts');
    expect(j.hits).toHaveLength(1);
    expect(h.prisma.$queryRaw.mock.calls[0]).toContainEqual(['KITCHEN', 'ALL']);
    expect(h.prisma.helpSearchLog.create).toHaveBeenCalledWith({
      data: { query: 'kot printing', resultsCount: 1, language: 'en', source: 'web', role: 'KITCHEN', userId: 'k1' },
    });
  });

  it('logs anonymous zero-result searches as public', async () => {
    h.prisma.$queryRaw.mockResolvedValue([]);
    await searchGET(req('/api/help/search?q=gst%20invoice'));
    expect(h.prisma.helpSearchLog.create.mock.calls[0][0].data).toMatchObject({ resultsCount: 0, source: 'public', userId: null });
  });
});

// ─── Feedback ───────────────────────────────────────────────────────────────

describe('POST /api/help/articles/[slug]/feedback', () => {
  it('401s when signed out', async () => {
    const r = await feedbackPOST(req('/x', json({ helpful: true })), slugCtx('order-statuses'));
    expect(r.status).toBe(401);
  });

  it('400s on a bad body', async () => {
    h.session = ADMIN;
    const r = await feedbackPOST(req('/x', json({ helpful: 'yes' })), slugCtx('order-statuses'));
    expect(r.status).toBe(400);
  });

  it('404s when the article is not visible', async () => {
    h.session = CUSTOMER;
    h.prisma.helpArticle.findMany.mockResolvedValue([]);
    const r = await feedbackPOST(req('/x', json({ helpful: true })), slugCtx('order-statuses'));
    expect(r.status).toBe(404);
    expect(h.prisma.helpArticleFeedback.upsert).not.toHaveBeenCalled();
  });

  it('upserts one vote per user with a trimmed comment', async () => {
    h.session = ADMIN;
    h.prisma.helpArticle.findMany.mockResolvedValue([{ id: 'a1', language: 'en' }]);
    const r = await feedbackPOST(req('/x', json({ helpful: false, comment: '  missing reprint steps ' })), slugCtx('order-statuses'));
    expect(r.status).toBe(200);
    expect(h.prisma.helpArticleFeedback.upsert).toHaveBeenCalledWith({
      where: { articleId_userId: { articleId: 'a1', userId: 'ad1' } },
      create: { articleId: 'a1', userId: 'ad1', role: 'ADMIN', helpful: false, comment: 'missing reprint steps' },
      update: { helpful: false, comment: 'missing reprint steps', role: 'ADMIN' },
    });
  });
});

// ─── Rider routes (Bearer via rider-auth) ───────────────────────────────────

describe('rider help routes', () => {
  it.each([
    ['index', () => riderIndexGET(req('/api/rider/help'))],
    ['article', () => riderArticleGET(req('/api/rider/help/articles/x'), slugCtx('x'))],
    ['search', () => riderSearchGET(req('/api/rider/help/search?q=payout'))],
    ['feedback', () => riderFeedbackPOST(req('/x', json({ helpful: true })), slugCtx('x'))],
  ])('%s: 403 without a rider session (none / customer)', async (_n, call) => {
    h.riderSession = null;
    expect((await call()).status).toBe(403);
    h.riderSession = CUSTOMER;
    expect((await call()).status).toBe(403);
    expect(h.prisma.helpArticle.findMany).not.toHaveBeenCalled();
  });

  it('rider sees rider + all audiences only', async () => {
    h.riderSession = RIDER;
    h.prisma.helpCategory.findMany.mockResolvedValue([]);
    h.prisma.helpArticle.findMany.mockResolvedValue([]);
    const r = await riderIndexGET(req('/api/rider/help?lang=hi'));
    expect(r.status).toBe(200);
    expect(h.prisma.helpArticle.findMany.mock.calls[0][0].where).toMatchObject({ language: 'hi', audience: { hasSome: ['RIDER', 'ALL'] } });
  });

  it('rider feedback is stored against the rider user', async () => {
    h.riderSession = RIDER;
    h.prisma.helpArticle.findMany.mockResolvedValue([{ id: 'a9', language: 'en' }]);
    const r = await riderFeedbackPOST(req('/x', json({ helpful: true })), slugCtx('rider-go-online'));
    expect(r.status).toBe(200);
    expect(h.prisma.helpArticleFeedback.upsert.mock.calls[0][0].create).toMatchObject({ userId: 'r1', role: 'RIDER', helpful: true });
  });
});

// ─── Platform authoring: SUPER_ADMIN only ───────────────────────────────────

describe('platform help authoring routes', () => {
  const writes: [string, () => Promise<Response>][] = [
    ['list', () => pArticlesGET()],
    ['create', () => pArticlesPOST(req('/x', json(validArticle)))],
    ['update', () => pArticlePATCH(req('/x', json({ title: 'New title' }, 'PATCH')), idCtx('a1'))],
    ['delete', () => pArticleDELETE(req('/x', { method: 'DELETE' }), idCtx('a1'))],
    ['publish', () => pPublishPOST(req('/x', json({ published: true })), idCtx('a1'))],
    ['restore', () => pRestorePOST(req('/x', { method: 'POST' }), { params: Promise.resolve({ id: 'a1', versionId: 'v1' }) })],
    ['category', () => pCategoryPOST(req('/x', json({ slug: 'orders', title: 'Orders' })))],
    ['analytics', () => pAnalyticsGET(req('/x'))],
  ];

  it.each(writes)('%s: 401 signed out, 403 for ADMIN / KITCHEN / RIDER / platform roles', async (_n, call) => {
    h.session = null;
    expect((await call()).status).toBe(401);
    for (const role of ['ADMIN', 'KITCHEN', 'RIDER', 'CUSTOMER', 'ADMIN_ASSIST', 'DEVELOPER']) {
      h.session = { user: { id: 'u', role } };
      expect((await call()).status).toBe(403);
    }
    expect(h.prisma.helpArticle.create).not.toHaveBeenCalled();
    expect(h.prisma.helpArticle.update).not.toHaveBeenCalled();
    expect(h.prisma.helpArticle.delete).not.toHaveBeenCalled();
  });

  it('create: validates, writes version 1 with author, refreshes search vector, audits', async () => {
    h.session = SUPER;
    h.prisma.helpArticle.findFirst.mockResolvedValue(null);
    h.prisma.helpArticle.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => row({ ...data, id: 'n1' }));
    const r = await pArticlesPOST(req('/x', json({ ...validArticle, publish: true })));
    expect(r.status).toBe(201);
    const data = h.prisma.helpArticle.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ slug: 'kot-printing', status: 'PUBLISHED', version: 1, createdById: 'su1' });
    expect(h.prisma.helpArticleVersion.create.mock.calls[0][0].data).toMatchObject({
      articleId: 'n1', version: 1, authorId: 'su1', authorName: 'Root', note: 'created',
    });
    expect(h.prisma.$executeRaw).toHaveBeenCalled();
    expect(h.audit).toHaveBeenCalledWith('help.article.create', expect.objectContaining({ actorId: 'su1', entityId: 'n1' }));
  });

  it('create: 400 on invalid slug / missing audience, 409 on duplicate slug', async () => {
    h.session = SUPER;
    expect((await pArticlesPOST(req('/x', json({ ...validArticle, slug: 'Bad Slug!' })))).status).toBe(400);
    expect((await pArticlesPOST(req('/x', json({ ...validArticle, audience: [] })))).status).toBe(400);
    h.prisma.helpArticle.findFirst.mockResolvedValue({ id: 'other' });
    expect((await pArticlesPOST(req('/x', json(validArticle)))).status).toBe(409);
  });

  it('update: bumps version and snapshots with the change note', async () => {
    h.session = SUPER;
    h.prisma.helpArticle.findUnique.mockResolvedValue(row({ version: 3 }));
    h.prisma.helpArticle.update.mockResolvedValue(row({ version: 4, title: 'New title' }));
    const r = await pArticlePATCH(req('/x', json({ title: 'New title', note: 'typo' }, 'PATCH')), idCtx('a1'));
    expect(r.status).toBe(200);
    expect(h.prisma.helpArticle.update.mock.calls[0][0].data).toMatchObject({ title: 'New title', version: { increment: 1 }, updatedById: 'su1' });
    expect(h.prisma.helpArticleVersion.create.mock.calls[0][0].data).toMatchObject({ version: 4, note: 'typo', authorId: 'su1' });
  });

  it('restore: re-applies an old snapshot as a new version', async () => {
    h.session = SUPER;
    h.prisma.helpArticleVersion.findFirst.mockResolvedValue({
      id: 'v1', articleId: 'a1', version: 1, title: 'Old', summary: 'old s', body: 'old body',
      audience: ['KITCHEN'], tags: [], appArea: null, categoryId: null,
    });
    h.prisma.helpArticle.findUnique.mockResolvedValue(row({ version: 5 }));
    h.prisma.helpArticle.update.mockResolvedValue(row({ version: 6, title: 'Old' }));
    const r = await pRestorePOST(req('/x', { method: 'POST' }), { params: Promise.resolve({ id: 'a1', versionId: 'v1' }) });
    expect(r.status).toBe(200);
    expect(h.prisma.helpArticleVersion.findFirst).toHaveBeenCalledWith({ where: { id: 'v1', articleId: 'a1' } });
    expect(h.prisma.helpArticle.update.mock.calls[0][0].data).toMatchObject({ title: 'Old', body: 'old body', version: { increment: 1 } });
    expect(h.prisma.helpArticleVersion.create.mock.calls[0][0].data.note).toBe('restored from v1');
  });

  it('publish / unpublish toggles status and audits', async () => {
    h.session = SUPER;
    h.prisma.helpArticle.findUnique.mockResolvedValue({ status: 'PUBLISHED' });
    h.prisma.helpArticle.update.mockResolvedValue(row({ status: 'DRAFT', publishedAt: null }));
    const r = await pPublishPOST(req('/x', json({ published: false })), idCtx('a1'));
    expect((await r.json()).article.status).toBe('DRAFT');
    expect(h.prisma.helpArticle.update.mock.calls[0][0].data).toMatchObject({ status: 'DRAFT', publishedAt: null });
    expect(h.audit).toHaveBeenCalledWith('help.article.unpublish', expect.anything());
  });
});
