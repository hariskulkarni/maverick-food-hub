/**
 * Parser for the starter help-article fixtures in apps/web/content/help:
 *
 *   content/help/categories.json
 *   content/help/<category-slug>/<slug>.md      (English)
 *   content/help/<category-slug>/<slug>.hi.md   (Hindi)
 *
 * Each .md file has a small "key: value" front-matter block (see
 * parseFixture). Pure — the seed script (prisma/seed-help.ts) does the I/O.
 */
import type { HelpAudience, HelpLanguage } from '@prisma/client';
import { ALL_AUDIENCES } from './audience';

export interface FixtureArticle {
  slug: string;
  language: HelpLanguage;
  categorySlug: string;
  title: string;
  summary: string;
  body: string;
  audience: HelpAudience[];
  tags: string[];
  appArea: string | null;
  relatedSlugs: string[];
  sortOrder: number;
}

export interface FixtureCategory {
  slug: string;
  title: string;
  description?: string;
  audience: HelpAudience;
  sortOrder: number;
}

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * @param text      file contents
 * @param fileName  e.g. "accept-orders.md" or "accept-orders.hi.md"
 * @param categorySlug  parent directory name
 */
export function parseFixture(text: string, fileName: string, categorySlug: string): FixtureArticle {
  const m = text.replace(/\r\n?/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`${categorySlug}/${fileName}: missing front-matter block`);
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  const fileMatch = fileName.match(/^([a-z0-9-]+?)(?:\.(hi|en))?\.md$/);
  if (!fileMatch) throw new Error(`${categorySlug}/${fileName}: bad file name`);
  const slug = fileMatch[1];
  const language = (meta.language || fileMatch[2] || 'en') as HelpLanguage;
  if (language !== 'en' && language !== 'hi') throw new Error(`${slug}: bad language "${language}"`);
  const audience = list(meta.audience) as HelpAudience[];
  if (!audience.length || audience.some((a) => !ALL_AUDIENCES.includes(a))) {
    throw new Error(`${slug}: bad audience "${meta.audience ?? ''}"`);
  }
  if (!meta.title || !meta.summary) throw new Error(`${slug}: title and summary are required`);
  const body = m[2].trim();
  if (!body) throw new Error(`${slug}: empty body`);
  return {
    slug,
    language,
    categorySlug,
    title: meta.title,
    summary: meta.summary.slice(0, 300),
    body,
    audience,
    tags: list(meta.tags).map((t) => t.toLowerCase()).slice(0, 20),
    appArea: meta.appArea || null,
    relatedSlugs: list(meta.related),
    sortOrder: Number(meta.sortOrder) || 0,
  };
}
