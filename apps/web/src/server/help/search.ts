/**
 * Help-center search.
 *
 *   1. Postgres full-text search over HelpArticle.searchVector (title weight A,
 *      summary + tags B, body C), ranked with ts_rank_cd, snippets and title
 *      highlights from ts_headline using sentinel markers (HL_START/HL_END —
 *      rendered by clients, never injected as HTML).
 *   2. If FTS finds nothing: pg_trgm word_similarity fallback (typos such as
 *      "ordr staus").
 *   3. If pg_trgm is not installed: case-insensitive substring fallback.
 *
 * Every user-supplied value goes through Prisma's tagged-template parameters
 * ($queryRaw`...${value}`) — never string concatenation — so the query text is
 * fixed and user input can only ever be a bound parameter.
 */
import type { HelpAudience, HelpLanguage } from '@prisma/client';
import { prisma } from '@/server/db';
import { log } from '@/server/log';
import { HL_END, HL_START } from '@/lib/help-markdown';

export const MAX_QUERY_LEN = 100;

/** Trim, strip control chars, collapse whitespace, lower-case, cap length. */
export function normalizeQuery(q: string | null | undefined): string {
  return (q ?? '')
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u27e6\u27e7]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, MAX_QUERY_LEN)
    .trim();
}

export interface SearchHit {
  id: string;
  slug: string;
  title: string;
  /** Title with HL_START/HL_END around matched terms. */
  titleHl: string;
  summary: string;
  /** Body excerpt with HL_START/HL_END around matched terms (may be ''). */
  snippet: string;
  appArea: string | null;
  categorySlug: string | null;
  categoryTitle: string | null;
  rank: number;
}

export interface SearchResult {
  query: string;
  mode: 'fts' | 'fuzzy' | 'basic' | 'empty';
  hits: SearchHit[];
}

interface SearchOpts {
  audiences: HelpAudience[];
  language: HelpLanguage;
  limit?: number;
}

const HEADLINE_OPTS = `StartSel=${HL_START}, StopSel=${HL_END}, MaxFragments=2, MaxWords=22, MinWords=8, FragmentDelimiter=" … "`;
const TITLE_HL_OPTS = `StartSel=${HL_START}, StopSel=${HL_END}, HighlightAll=true`;

type Row = Omit<SearchHit, 'rank'> & { rank: number | string };

function toHits(rows: Row[]): SearchHit[] {
  return rows.map((r) => ({ ...r, snippet: r.snippet.replace(/\s+/g, ' ').trim(), rank: Number(r.rank) }));
}

async function ftsSearch(q: string, o: Required<SearchOpts>): Promise<SearchHit[]> {
  const rows = await prisma.$queryRaw<Row[]>`
    WITH q AS (
      SELECT websearch_to_tsquery('english', ${q}) || websearch_to_tsquery('simple', ${q}) AS query
    ), ranked AS (
      SELECT a.id, a.slug, a.title, a.summary, a.body, a.language, a."appArea", a."categoryId",
             ts_rank_cd(a."searchVector", q.query, 32) AS rank, a."viewCount"
      FROM "HelpArticle" a CROSS JOIN q
      WHERE a.status = 'PUBLISHED'
        AND a.language = ${o.language}::"HelpLanguage"
        AND a.audience && ${o.audiences}::text[]::"HelpAudience"[]
        AND a."searchVector" @@ q.query
      ORDER BY rank DESC, a."viewCount" DESC
      LIMIT ${o.limit}
    )
    SELECT r.id, r.slug, r.title, r.summary, r."appArea", r.rank,
           c.slug AS "categorySlug", c.title AS "categoryTitle",
           ts_headline(CASE WHEN r.language = 'hi' THEN 'simple'::regconfig ELSE 'english'::regconfig END,
                       r.title, q.query, ${TITLE_HL_OPTS}) AS "titleHl",
           ts_headline(CASE WHEN r.language = 'hi' THEN 'simple'::regconfig ELSE 'english'::regconfig END,
                       regexp_replace(r.body, '\\((help:|https?:|/)[^)]*\\)|[#*\`>\\[\\]]', ' ', 'g'),
                       q.query, ${HEADLINE_OPTS}) AS snippet
    FROM ranked r CROSS JOIN q
    LEFT JOIN "HelpCategory" c ON c.id = r."categoryId"
    ORDER BY r.rank DESC, r."viewCount" DESC`;
  return toHits(rows);
}

async function fuzzySearch(q: string, o: Required<SearchOpts>): Promise<SearchHit[]> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT * FROM (
      SELECT a.id, a.slug, a.title, a.title AS "titleHl", a.summary, '' AS snippet, a."appArea",
             c.slug AS "categorySlug", c.title AS "categoryTitle",
             GREATEST(similarity(a.title, ${q}),
                      word_similarity(${q}, a.title || ' ' || a.summary || ' ' || array_to_string(a.tags, ' '))) AS rank
      FROM "HelpArticle" a
      LEFT JOIN "HelpCategory" c ON c.id = a."categoryId"
      WHERE a.status = 'PUBLISHED'
        AND a.language = ${o.language}::"HelpLanguage"
        AND a.audience && ${o.audiences}::text[]::"HelpAudience"[]
    ) s
    WHERE s.rank > 0.3
    ORDER BY s.rank DESC
    LIMIT ${o.limit}`;
  return toHits(rows);
}

async function basicSearch(q: string, o: Required<SearchOpts>): Promise<SearchHit[]> {
  const words = q.split(' ').filter((w) => w.length >= 3).slice(0, 5);
  if (!words.length) return [];
  const rows = await prisma.helpArticle.findMany({
    where: {
      status: 'PUBLISHED',
      language: o.language,
      audience: { hasSome: o.audiences },
      OR: words.flatMap((w) => [
        { title: { contains: w, mode: 'insensitive' as const } },
        { summary: { contains: w, mode: 'insensitive' as const } },
        { body: { contains: w, mode: 'insensitive' as const } },
      ]),
    },
    orderBy: { viewCount: 'desc' },
    take: o.limit,
    select: { id: true, slug: true, title: true, summary: true, appArea: true, category: { select: { slug: true, title: true } } },
  });
  return rows.map((r) => ({
    id: r.id, slug: r.slug, title: r.title, titleHl: r.title, summary: r.summary, snippet: '',
    appArea: r.appArea, categorySlug: r.category?.slug ?? null, categoryTitle: r.category?.title ?? null, rank: 0,
  }));
}

function isMissingTrgm(e: unknown): boolean {
  const s = e instanceof Error ? e.message : String(e);
  return s.includes('42883') || /function (word_)?similarity/i.test(s);
}

export async function searchArticles(rawQuery: string | null | undefined, opts: SearchOpts): Promise<SearchResult> {
  const query = normalizeQuery(rawQuery);
  if (!query || opts.audiences.length === 0) return { query, mode: 'empty', hits: [] };
  const o = { limit: Math.min(Math.max(opts.limit ?? 20, 1), 50), ...opts } as Required<SearchOpts>;

  const fts = await ftsSearch(query, o);
  if (fts.length) return { query, mode: 'fts', hits: fts };
  // Trigram matching on very short queries ("the", "ok") matches nearly
  // everything — only fall back for queries long enough to carry a typo.
  if (query.replace(/\s/g, '').length < 4) return { query, mode: 'fts', hits: [] };
  try {
    return { query, mode: 'fuzzy', hits: await fuzzySearch(query, o) };
  } catch (e) {
    if (!isMissingTrgm(e)) throw e;
    log.warn({ err: String(e) }, 'help search: pg_trgm unavailable, using basic fallback');
    return { query, mode: 'basic', hits: await basicSearch(query, o) };
  }
}

/** Record a search for content-gap reporting. Never throws. */
export async function logSearch(entry: {
  query: string;
  resultsCount: number;
  language: HelpLanguage;
  source: 'web' | 'rider' | 'public';
  role?: string | null;
  userId?: string | null;
}): Promise<void> {
  if (!entry.query) return;
  try {
    await prisma.helpSearchLog.create({
      data: {
        query: entry.query,
        resultsCount: entry.resultsCount,
        language: entry.language,
        source: entry.source,
        role: entry.role ?? null,
        userId: entry.userId ?? null,
      },
    });
  } catch (e) {
    log.warn({ err: String(e) }, 'help search log write failed');
  }
}

/**
 * Recompute an article's weighted tsvector. Called after every write so search
 * works without DB triggers (and therefore also on `prisma db push` databases).
 */
export async function refreshSearchVector(articleId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "HelpArticle" a SET "searchVector" =
      setweight(to_tsvector(cfg.c, coalesce(a.title, '')), 'A') ||
      setweight(to_tsvector(cfg.c, coalesce(a.summary, '') || ' ' || array_to_string(a.tags, ' ')), 'B') ||
      setweight(to_tsvector(cfg.c, coalesce(a.body, '')), 'C')
    FROM (SELECT CASE WHEN language = 'hi' THEN 'simple'::regconfig ELSE 'english'::regconfig END AS c
          FROM "HelpArticle" WHERE id = ${articleId}) cfg
    WHERE a.id = ${articleId}`;
}
