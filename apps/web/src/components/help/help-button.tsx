'use client';
/**
 * Contextual help: a small "?" button that opens the published articles
 * tagged with an app-area key (e.g. "admin.orders") in a dialog, and shows a
 * chosen article inline. Drop it next to a page heading; it has no effect on
 * the page's own logic.
 */
import Link from 'next/link';
import { useState } from 'react';
import { HelpCircle, ChevronLeft, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import type { ArticleDto, ArticleSummaryDto } from '@/server/help/articles';
import { HelpMarkdownView } from './help-markdown-view';
import { cn } from '@/lib/utils';

export function HelpButton({
  appArea,
  basePath = '/admin/help',
  label = 'Help for this page',
  className,
}: {
  appArea: string;
  basePath?: string;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ArticleSummaryDto[] | null>(null);
  const [article, setArticle] = useState<ArticleDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load<T>(url: string): Promise<T | null> {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(url);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? 'Could not load help');
      return j as T;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function onOpenChange(next: boolean) {
    setOpen(next);
    if (next && list === null) {
      const j = await load<{ articles: ArticleSummaryDto[] }>(`/api/help/articles?appArea=${encodeURIComponent(appArea)}`);
      if (j) setList(j.articles);
    }
    if (!next) setArticle(null);
  }

  async function openArticle(slug: string) {
    const j = await load<{ article: ArticleDto }>(`/api/help/articles/${slug}`);
    if (j) setArticle(j.article);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className={cn(
            'inline-grid size-8 shrink-0 place-items-center rounded-full border bg-card text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className
          )}
        >
          <HelpCircle className="size-4" aria-hidden />
        </button>
      </DialogTrigger>
      <DialogContent className="md:max-w-xl">
        <DialogHeader>
          <DialogTitle>{article ? article.title : 'Help for this page'}</DialogTitle>
          <DialogDescription>{article ? article.summary : 'Guides for what you can do here.'}</DialogDescription>
        </DialogHeader>
        {loading && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" aria-label="Loading" />}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {article ? (
          <div className="space-y-4">
            <button type="button" onClick={() => setArticle(null)} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ChevronLeft className="size-4" aria-hidden /> Back
            </button>
            <HelpMarkdownView blocks={article.blocks} basePath={basePath} />
            <Link href={`${basePath}/${article.slug}`} className="text-sm text-primary underline">
              Open in the help center (rate this article)
            </Link>
          </div>
        ) : list ? (
          <div className="space-y-3">
            {list.length === 0 ? (
              <p className="text-sm text-muted-foreground">No guides for this page yet.</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {list.map((a) => (
                  <li key={a.slug}>
                    <button type="button" onClick={() => openArticle(a.slug)} className="block w-full p-3 text-left hover:bg-accent/50">
                      <div className="text-sm font-medium">{a.title}</div>
                      <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.summary}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Link href={basePath} className="text-sm text-primary underline">
              Browse all help topics
            </Link>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
