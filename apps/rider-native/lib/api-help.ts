/**
 * Help center API + offline cache for the rider app.
 *
 * Talks to /api/rider/help/* (Bearer token attached by apiRequest). Every
 * successful fetch of the topic index or of an article is written to a small
 * JSON cache in the app's document directory, so the last-fetched help content
 * stays readable with no connection. Search needs the network; offline, the
 * screen falls back to filtering the cached index locally.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { apiRequest } from './api';

export type HelpLang = 'en' | 'hi';

export type Inline =
  | { t: 'text' | 'bold' | 'italic' | 'code'; v: string }
  | { t: 'link'; v: string; href: string };

export type Block =
  | { type: 'h2' | 'h3' | 'p' | 'note'; inline: Inline[] }
  | { type: 'ul' | 'ol'; items: Inline[][] };

export interface HelpArticleSummary {
  slug: string;
  title: string;
  summary: string;
  appArea: string | null;
  categorySlug: string | null;
}

export interface HelpCategory {
  slug: string;
  title: string;
  description: string | null;
  articles: HelpArticleSummary[];
}

export interface HelpArticle {
  id: string;
  slug: string;
  language: HelpLang;
  title: string;
  summary: string;
  blocks: Block[];
  category: { slug: string; title: string } | null;
  updatedAt: string;
  availableLanguages: HelpLang[];
  related: HelpArticleSummary[];
}

export interface HelpSearchHit {
  slug: string;
  title: string;
  titleHl: string;
  summary: string;
  snippet: string;
  categoryTitle: string | null;
}

/** Matches the server's search-highlight sentinels (⟦ … ⟧). */
export const HL_START = '⟦';
export const HL_END = '⟧';

export function splitHighlight(s: string): { v: string; hit: boolean }[] {
  const out: { v: string; hit: boolean }[] = [];
  const re = new RegExp(`${HL_START}([^${HL_END}]*)${HL_END}`, 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ v: s.slice(last, m.index), hit: false });
    out.push({ v: m[1], hit: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ v: s.slice(last), hit: false });
  return out;
}

// ─── Offline cache ───────────────────────────────────────────────────────────

interface Cached<T> {
  savedAt: string;
  data: T;
}

function cacheDir(): Directory {
  const dir = new Directory(Paths.document, 'help-cache');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function cacheFile(key: string): File {
  return new File(cacheDir(), `${key.replace(/[^a-z0-9-]/gi, '_')}.json`);
}

function writeCache<T>(key: string, data: T): void {
  try {
    const f = cacheFile(key);
    f.write(JSON.stringify({ savedAt: new Date().toISOString(), data } satisfies Cached<T>));
  } catch {
    // Cache is best-effort — never break the screen over it.
  }
}

export async function readCache<T>(key: string): Promise<Cached<T> | null> {
  try {
    const f = cacheFile(key);
    if (!f.exists) return null;
    return JSON.parse(await f.text()) as Cached<T>;
  } catch {
    return null;
  }
}

export const indexKey = (lang: HelpLang) => `index-${lang}`;
export const articleKey = (slug: string, lang: HelpLang) => `article-${lang}-${slug}`;

// ─── API ─────────────────────────────────────────────────────────────────────

export const help = {
  async categories(lang: HelpLang): Promise<HelpCategory[]> {
    const r = await apiRequest<{ categories: HelpCategory[] }>(`/api/rider/help?lang=${lang}`);
    writeCache(indexKey(lang), r.categories);
    return r.categories;
  },

  async article(slug: string, lang: HelpLang): Promise<HelpArticle> {
    const r = await apiRequest<{ article: HelpArticle }>(
      `/api/rider/help/articles/${encodeURIComponent(slug)}?lang=${lang}`
    );
    writeCache(articleKey(slug, lang), r.article);
    return r.article;
  },

  async search(q: string, lang: HelpLang): Promise<HelpSearchHit[]> {
    const r = await apiRequest<{ hits: HelpSearchHit[] }>(
      `/api/rider/help/search?q=${encodeURIComponent(q)}&lang=${lang}`
    );
    return r.hits;
  },

  feedback(slug: string, lang: HelpLang, helpful: boolean, comment?: string): Promise<{ ok: true }> {
    return apiRequest(`/api/rider/help/articles/${encodeURIComponent(slug)}/feedback?lang=${lang}`, {
      method: 'POST',
      body: { helpful, comment: comment?.trim() ? comment.trim() : null },
    });
  },
};
