/**
 * Help-center read side: categories (listed only when they hold an article
 * the viewer can read), article lists, article detail and feedback. Every query is filtered to PUBLISHED articles whose audience
 * overlaps the viewer's audiences (see audience.ts) — callers pass the
 * audiences derived from the session role, never from the request.
 */
import type { HelpAudience, HelpLanguage, Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { parseHelpMarkdown, type Block } from '@/lib/help-markdown';

export interface ArticleSummaryDto {
  slug: string;
  title: string;
  summary: string;
  appArea: string | null;
  categorySlug: string | null;
}

export interface CategoryDto {
  slug: string;
  title: string;
  description: string | null;
  articles: ArticleSummaryDto[];
}

export interface ArticleDto {
  id: string;
  slug: string;
  language: HelpLanguage;
  title: string;
  summary: string;
  body: string;
  blocks: Block[];
  tags: string[];
  appArea: string | null;
  category: { slug: string; title: string } | null;
  version: number;
  updatedAt: string;
  availableLanguages: HelpLanguage[];
  related: ArticleSummaryDto[];
}

const summarySelect = {
  slug: true,
  title: true,
  summary: true,
  appArea: true,
  category: { select: { slug: true } },
} satisfies Prisma.HelpArticleSelect;

type SummaryRow = Prisma.HelpArticleGetPayload<{ select: typeof summarySelect }>;

function toSummary(r: SummaryRow): ArticleSummaryDto {
  return { slug: r.slug, title: r.title, summary: r.summary, appArea: r.appArea, categorySlug: r.category?.slug ?? null };
}

function visibleWhere(audiences: HelpAudience[], language: HelpLanguage): Prisma.HelpArticleWhereInput {
  return { status: 'PUBLISHED', language, audience: { hasSome: audiences } };
}

export async function listCategories(audiences: HelpAudience[], language: HelpLanguage): Promise<CategoryDto[]> {
  const [categories, articles] = await Promise.all([
    prisma.helpCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }] }),
    prisma.helpArticle.findMany({
      where: visibleWhere(audiences, language),
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      select: summarySelect,
    }),
  ]);
  const byCat = new Map<string | null, ArticleSummaryDto[]>();
  for (const a of articles) {
    const key = a.category?.slug ?? null;
    byCat.set(key, [...(byCat.get(key) ?? []), toSummary(a)]);
  }
  const out: CategoryDto[] = categories
    .filter((c) => byCat.has(c.slug))
    .map((c) => ({ slug: c.slug, title: c.title, description: c.description, articles: byCat.get(c.slug) ?? [] }));
  const loose = byCat.get(null);
  if (loose?.length) out.push({ slug: 'general', title: 'General', description: null, articles: loose });
  return out;
}

export async function listArticles(opts: {
  audiences: HelpAudience[];
  language: HelpLanguage;
  appArea?: string | null;
  categorySlug?: string | null;
  limit?: number;
}): Promise<ArticleSummaryDto[]> {
  const where: Prisma.HelpArticleWhereInput = visibleWhere(opts.audiences, opts.language);
  if (opts.appArea) where.appArea = opts.appArea;
  if (opts.categorySlug) where.category = { slug: opts.categorySlug };
  const rows = await prisma.helpArticle.findMany({
    where,
    orderBy: [{ sortOrder: 'asc' }, { viewCount: 'desc' }],
    take: Math.min(opts.limit ?? 50, 200),
    select: summarySelect,
  });
  return rows.map(toSummary);
}

/**
 * Article by slug in the requested language, falling back to English when
 * there is no translation. Returns null when missing or not visible to the
 * viewer (callers 404 — never reveal that a restricted article exists).
 */
export async function getArticle(
  slug: string,
  audiences: HelpAudience[],
  language: HelpLanguage,
  { countView = true }: { countView?: boolean } = {}
): Promise<ArticleDto | null> {
  const variants = await prisma.helpArticle.findMany({
    where: { slug, status: 'PUBLISHED', audience: { hasSome: audiences } },
    include: { category: { select: { slug: true, title: true } } },
  });
  const a = variants.find((v) => v.language === language) ?? variants.find((v) => v.language === 'en') ?? variants[0];
  if (!a) return null;

  const related = a.relatedSlugs.length
    ? await prisma.helpArticle.findMany({
        where: { slug: { in: a.relatedSlugs }, ...visibleWhere(audiences, a.language) },
        select: summarySelect,
      })
    : [];
  if (countView) {
    await prisma.helpArticle.update({ where: { id: a.id }, data: { viewCount: { increment: 1 } } }).catch(() => {});
  }
  return {
    id: a.id,
    slug: a.slug,
    language: a.language,
    title: a.title,
    summary: a.summary,
    body: a.body,
    blocks: parseHelpMarkdown(a.body),
    tags: a.tags,
    appArea: a.appArea,
    category: a.category,
    version: a.version,
    updatedAt: a.updatedAt.toISOString(),
    availableLanguages: variants.map((v) => v.language),
    // keep the author's ordering of related slugs
    related: a.relatedSlugs
      .map((s) => related.find((r) => r.slug === s))
      .filter((r): r is SummaryRow => !!r)
      .map(toSummary),
  };
}

/**
 * Upsert the viewer's helpful / not-helpful vote on a visible article.
 * Returns false when the article is missing or not visible.
 */
export async function submitFeedback(input: {
  slug: string;
  language: HelpLanguage;
  audiences: HelpAudience[];
  userId: string;
  role: string;
  helpful: boolean;
  comment?: string | null;
}): Promise<boolean> {
  const variants = await prisma.helpArticle.findMany({
    where: { slug: input.slug, status: 'PUBLISHED', audience: { hasSome: input.audiences } },
    select: { id: true, language: true },
  });
  const a = variants.find((v) => v.language === input.language) ?? variants.find((v) => v.language === 'en') ?? variants[0];
  if (!a) return false;
  const comment = input.comment?.trim() ? input.comment.trim().slice(0, 1000) : null;
  await prisma.helpArticleFeedback.upsert({
    where: { articleId_userId: { articleId: a.id, userId: input.userId } },
    create: { articleId: a.id, userId: input.userId, role: input.role, helpful: input.helpful, comment },
    update: { helpful: input.helpful, comment, role: input.role },
  });
  return true;
}
