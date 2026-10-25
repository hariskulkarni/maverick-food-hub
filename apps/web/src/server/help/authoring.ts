/**
 * Help-center authoring (SUPER_ADMIN only — enforced by the route handlers).
 *
 * Every content write bumps HelpArticle.version and stores an immutable
 * HelpArticleVersion snapshot (author + timestamp), so any revision can be
 * viewed and restored. Restoring writes the old content as a NEW version —
 * history is never rewritten. The search vector is refreshed after each write.
 */
import { z } from 'zod';
import type { HelpArticle, Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { refreshSearchVector } from './search';

export interface Actor {
  id: string;
  name?: string | null;
  role?: string | null;
}

const slug = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'use lowercase letters, numbers and dashes');
const audienceEnum = z.enum(['RESTAURANT_ADMIN', 'KITCHEN', 'RIDER', 'CUSTOMER', 'ALL']);

export const ArticleInput = z.object({
  slug,
  language: z.enum(['en', 'hi']).default('en'),
  title: z.string().trim().min(3).max(200),
  summary: z.string().trim().min(3).max(300),
  body: z.string().trim().min(1).max(50_000),
  audience: z.array(audienceEnum).min(1).max(5),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).default([]),
  appArea: z
    .string()
    .trim()
    .max(60)
    .regex(/^[a-z]+(?:\.[a-z-]+)*$/, 'e.g. admin.orders')
    .nullish()
    .or(z.literal('').transform(() => null)),
  relatedSlugs: z.array(slug).max(10).default([]),
  categoryId: z.string().min(1).nullish(),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
export type ArticleInputT = z.infer<typeof ArticleInput>;

/** PATCH body: every field optional, slug/language editable too. */
export const ArticlePatch = ArticleInput.partial().extend({ note: z.string().trim().max(200).optional() });

export const CategoryInput = z.object({
  slug,
  title: z.string().trim().min(2).max(100),
  description: z.string().trim().max(300).nullish(),
  audience: audienceEnum.default('ALL'),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

function snapshot(a: HelpArticle, actor: Actor, note: string): Prisma.HelpArticleVersionUncheckedCreateInput {
  return {
    articleId: a.id,
    version: a.version,
    title: a.title,
    summary: a.summary,
    body: a.body,
    audience: a.audience,
    tags: a.tags,
    appArea: a.appArea,
    categoryId: a.categoryId,
    note,
    authorId: actor.id,
    authorName: actor.name ?? null,
  };
}

export class HelpConflictError extends Error {}

async function assertSlugFree(slugValue: string, language: string, exceptId?: string) {
  const clash = await prisma.helpArticle.findFirst({
    where: { slug: slugValue, language: language as 'en' | 'hi', ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new HelpConflictError(`An article with slug "${slugValue}" (${language}) already exists.`);
}

export async function createArticle(
  input: ArticleInputT,
  actor: Actor,
  opts: { publish?: boolean; note?: string } = {}
): Promise<HelpArticle> {
  await assertSlugFree(input.slug, input.language);
  const article = await prisma.$transaction(async (tx) => {
    const a = await tx.helpArticle.create({
      data: {
        ...input,
        appArea: input.appArea ?? null,
        categoryId: input.categoryId ?? null,
        version: 1,
        status: opts.publish ? 'PUBLISHED' : 'DRAFT',
        publishedAt: opts.publish ? new Date() : null,
        createdById: actor.id,
        updatedById: actor.id,
      },
    });
    await tx.helpArticleVersion.create({ data: snapshot(a, actor, opts.note ?? 'created') });
    return a;
  });
  await refreshSearchVector(article.id);
  await audit('help.article.create', {
    actorId: actor.id,
    actorRole: actor.role,
    entityType: 'HelpArticle',
    entityId: article.id,
    after: { slug: article.slug, language: article.language, title: article.title },
  });
  return article;
}

export async function updateArticle(
  id: string,
  patch: z.infer<typeof ArticlePatch>,
  actor: Actor
): Promise<HelpArticle | null> {
  const before = await prisma.helpArticle.findUnique({ where: { id } });
  if (!before) return null;
  const { note, ...data } = patch;
  if ((data.slug && data.slug !== before.slug) || (data.language && data.language !== before.language)) {
    await assertSlugFree(data.slug ?? before.slug, data.language ?? before.language, id);
  }
  const updated = await prisma.$transaction(async (tx) => {
    const a = await tx.helpArticle.update({
      where: { id },
      data: { ...data, version: { increment: 1 }, updatedById: actor.id },
    });
    await tx.helpArticleVersion.create({ data: snapshot(a, actor, note || 'edited') });
    return a;
  });
  await refreshSearchVector(id);
  await audit('help.article.update', {
    actorId: actor.id,
    actorRole: actor.role,
    entityType: 'HelpArticle',
    entityId: id,
    before: { version: before.version, title: before.title, status: before.status },
    after: { version: updated.version, title: updated.title, status: updated.status },
  });
  return updated;
}

export async function setPublished(id: string, published: boolean, actor: Actor): Promise<HelpArticle | null> {
  const before = await prisma.helpArticle.findUnique({ where: { id }, select: { status: true } });
  if (!before) return null;
  const a = await prisma.helpArticle.update({
    where: { id },
    data: {
      status: published ? 'PUBLISHED' : 'DRAFT',
      publishedAt: published ? new Date() : null,
      updatedById: actor.id,
    },
  });
  await audit(published ? 'help.article.publish' : 'help.article.unpublish', {
    actorId: actor.id,
    actorRole: actor.role,
    entityType: 'HelpArticle',
    entityId: id,
    before,
    after: { status: a.status },
  });
  return a;
}

export async function restoreVersion(id: string, versionId: string, actor: Actor): Promise<HelpArticle | null> {
  const v = await prisma.helpArticleVersion.findFirst({ where: { id: versionId, articleId: id } });
  if (!v) return null;
  return updateArticle(
    id,
    {
      title: v.title,
      summary: v.summary,
      body: v.body,
      audience: v.audience,
      tags: v.tags,
      appArea: v.appArea,
      categoryId: v.categoryId,
      note: `restored from v${v.version}`,
    },
    actor
  );
}

export async function deleteArticle(id: string, actor: Actor): Promise<boolean> {
  const a = await prisma.helpArticle.findUnique({ where: { id }, select: { slug: true, language: true, title: true } });
  if (!a) return false;
  await prisma.helpArticle.delete({ where: { id } });
  await audit('help.article.delete', {
    actorId: actor.id,
    actorRole: actor.role,
    entityType: 'HelpArticle',
    entityId: id,
    before: a,
  });
  return true;
}

// ─── Analytics ──────────────────────────────────────────────────────────────

export interface HelpAnalytics {
  totals: { articles: number; published: number; views: number; feedback: number; helpfulPct: number | null; searches30d: number; zeroResult30d: number };
  articles: { id: string; slug: string; language: string; title: string; status: string; views: number; yes: number; no: number; helpfulPct: number | null }[];
  topSearches: { query: string; count: number; avgResults: number }[];
  zeroResultSearches: { query: string; count: number; lastAt: string }[];
  recentComments: { slug: string; title: string; helpful: boolean; comment: string; createdAt: string }[];
}

const pct = (yes: number, no: number) => (yes + no ? Math.round((yes / (yes + no)) * 100) : null);

export async function helpAnalytics(days = 30): Promise<HelpAnalytics> {
  const since = new Date(Date.now() - days * 86_400_000);
  const [articles, votes, top, zero, searches30d, comments] = await Promise.all([
    prisma.helpArticle.findMany({
      select: { id: true, slug: true, language: true, title: true, status: true, viewCount: true },
      orderBy: { viewCount: 'desc' },
    }),
    prisma.helpArticleFeedback.groupBy({ by: ['articleId', 'helpful'], _count: { _all: true } }),
    prisma.helpSearchLog.groupBy({
      by: ['query'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _avg: { resultsCount: true },
      orderBy: { _count: { query: 'desc' } },
      take: 20,
    }),
    prisma.helpSearchLog.groupBy({
      by: ['query'],
      where: { createdAt: { gte: since }, resultsCount: 0 },
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: { _count: { query: 'desc' } },
      take: 20,
    }),
    prisma.helpSearchLog.count({ where: { createdAt: { gte: since } } }),
    prisma.helpArticleFeedback.findMany({
      where: { comment: { not: null } },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: { helpful: true, comment: true, updatedAt: true, article: { select: { slug: true, title: true } } },
    }),
  ]);
  const vote = new Map<string, { yes: number; no: number }>();
  for (const v of votes) {
    const cur = vote.get(v.articleId) ?? { yes: 0, no: 0 };
    if (v.helpful) cur.yes += v._count._all;
    else cur.no += v._count._all;
    vote.set(v.articleId, cur);
  }
  const rows = articles.map((a) => {
    const v = vote.get(a.id) ?? { yes: 0, no: 0 };
    return { id: a.id, slug: a.slug, language: a.language, title: a.title, status: a.status, views: a.viewCount, yes: v.yes, no: v.no, helpfulPct: pct(v.yes, v.no) };
  });
  const yes = rows.reduce((s, r) => s + r.yes, 0);
  const no = rows.reduce((s, r) => s + r.no, 0);
  return {
    totals: {
      articles: rows.length,
      published: rows.filter((r) => r.status === 'PUBLISHED').length,
      views: rows.reduce((s, r) => s + r.views, 0),
      feedback: yes + no,
      helpfulPct: pct(yes, no),
      searches30d,
      zeroResult30d: zero.reduce((s, z) => s + z._count._all, 0),
    },
    articles: rows,
    topSearches: top.map((t) => ({ query: t.query, count: t._count._all, avgResults: Math.round((t._avg.resultsCount ?? 0) * 10) / 10 })),
    zeroResultSearches: zero.map((z) => ({ query: z.query, count: z._count._all, lastAt: (z._max.createdAt ?? since).toISOString() })),
    recentComments: comments.map((c) => ({ slug: c.article.slug, title: c.article.title, helpful: c.helpful, comment: c.comment ?? '', createdAt: c.updatedAt.toISOString() })),
  };
}
