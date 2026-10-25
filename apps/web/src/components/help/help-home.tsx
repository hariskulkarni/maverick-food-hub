'use client';
/**
 * Help-center landing: search box (debounced, /api/help/search) over a list of
 * categories with their articles. Used by /admin/help, /kitchen/help and /faq.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Search, ChevronRight, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { CategoryDto } from '@/server/help/articles';
import { Highlighted } from './help-markdown-view';

interface Hit {
  slug: string;
  title: string;
  titleHl: string;
  summary: string;
  snippet: string;
  categoryTitle: string | null;
}

export function HelpHome({
  categories,
  basePath,
  lang,
  searchPlaceholder = 'Search help articles…',
}: {
  categories: CategoryDto[];
  basePath: string;
  lang: 'en' | 'hi';
  searchPlaceholder?: string;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setHits(null);
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/help/search?q=${encodeURIComponent(query)}&lang=${lang}`, { signal: ctrl.signal });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error ?? 'Search failed');
        setHits(j.hits ?? []);
        setError(null);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message || 'Search failed');
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, lang]);

  const suffix = lang === 'hi' ? '?lang=hi' : '';

  return (
    <div className="space-y-6">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label="Search help articles"
          className="h-11 pl-9"
          maxLength={100}
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden />}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {hits !== null ? (
        <section aria-live="polite">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">
            {hits.length ? `${hits.length} result${hits.length === 1 ? '' : 's'}` : 'No articles match that search.'}
          </h2>
          {hits.length === 0 && (
            <p className="text-sm text-muted-foreground">Try different words, or browse the topics below.</p>
          )}
          <ul className="divide-y rounded-xl border bg-card">
            {hits.map((h) => (
              <li key={h.slug}>
                <Link href={`${basePath}/${h.slug}${suffix}`} className="block p-4 hover:bg-accent/50">
                  <div className="font-medium"><Highlighted text={h.titleHl} /></div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {h.snippet ? <Highlighted text={h.snippet} /> : h.summary}
                  </p>
                  {h.categoryTitle && <div className="mt-1 text-xs text-muted-foreground/80">{h.categoryTitle}</div>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {categories.length === 0 ? (
        <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
          No help articles have been published yet.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {categories.map((c) => (
            <section key={c.slug} id={c.slug} className="scroll-mt-24 rounded-xl border bg-card p-4">
              <h2 className="display text-base font-semibold">{c.title}</h2>
              {c.description && <p className="mt-0.5 text-xs text-muted-foreground">{c.description}</p>}
              <ul className="mt-3 space-y-1">
                {c.articles.map((a) => (
                  <li key={a.slug}>
                    <Link
                      href={`${basePath}/${a.slug}${suffix}`}
                      className="group flex items-start justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50"
                    >
                      <span>{a.title}</span>
                      <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
