'use client';
/**
 * One help article: rendered body, "Was this helpful?" feedback (signed-in
 * viewers), related articles and an optional contact-support fallback.
 */
import Link from 'next/link';
import { useState } from 'react';
import { ThumbsUp, ThumbsDown, ChevronLeft, Languages } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { ArticleDto } from '@/server/help/articles';
import { HelpMarkdownView } from './help-markdown-view';
import { ContactSupport } from './contact-support';

export function HelpArticleView({
  article,
  basePath,
  canFeedback,
  showContact,
  showBack = true,
  apiBase = '/api/help',
}: {
  article: ArticleDto;
  basePath: string;
  canFeedback: boolean;
  showContact: boolean;
  showBack?: boolean;
  /** Help API root — '/api/rider/help' for the rider portal. */
  apiBase?: string;
}) {
  const otherLang = article.availableLanguages.find((l) => l !== article.language);
  return (
    <article className="space-y-6">
      {showBack && (
        <Link href={basePath} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden /> All help topics
        </Link>
      )}
      <header>
        {article.category && <div className="text-xs font-semibold uppercase tracking-wider text-primary">{article.category.title}</div>}
        <h1 className="display mt-1 text-2xl font-semibold md:text-3xl">{article.title}</h1>
        <p className="mt-2 text-muted-foreground">{article.summary}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>Updated {new Date(article.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          {otherLang && (
            <Link href={`${basePath}/${article.slug}${otherLang === 'hi' ? '?lang=hi' : ''}`} className="inline-flex items-center gap-1 text-primary underline">
              <Languages className="size-3.5" aria-hidden /> {otherLang === 'hi' ? 'हिंदी में पढ़ें' : 'Read in English'}
            </Link>
          )}
        </div>
      </header>

      <HelpMarkdownView blocks={article.blocks} basePath={basePath} />

      {canFeedback && <FeedbackBox slug={article.slug} language={article.language} apiBase={apiBase} />}

      {article.related.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold">Related articles</h2>
          <ul className="mt-2 space-y-1">
            {article.related.map((r) => (
              <li key={r.slug}>
                <Link href={`${basePath}/${r.slug}${article.language === 'hi' ? '?lang=hi' : ''}`} className="text-sm text-primary underline underline-offset-2">
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {showContact && <ContactSupport context={`Help article: ${article.title} (${article.slug})`} />}
    </article>
  );
}

function FeedbackBox({ slug, language, apiBase }: { slug: string; language: string; apiBase: string }) {
  const [vote, setVote] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function send(helpful: boolean, withComment = false) {
    setBusy(true);
    try {
      const r = await fetch(`${apiBase}/articles/${slug}/feedback?lang=${language}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ helpful, comment: withComment ? comment : null }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? 'Could not send feedback');
      setVote(helpful);
      if (withComment) {
        setSent(true);
        toast.success('Thanks for the feedback');
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border bg-card p-4">
      {sent ? (
        <p className="text-sm">Thanks — your feedback helps us improve this article.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">Was this article helpful?</span>
            <Button size="sm" variant={vote === true ? 'default' : 'outline'} disabled={busy} onClick={() => send(true)}>
              <ThumbsUp aria-hidden /> Yes
            </Button>
            <Button size="sm" variant={vote === false ? 'default' : 'outline'} disabled={busy} onClick={() => send(false)}>
              <ThumbsDown aria-hidden /> No
            </Button>
          </div>
          {vote !== null && (
            <div className="mt-3 space-y-2">
              <label className="text-xs text-muted-foreground" htmlFor={`fb-${slug}`}>
                {vote ? 'Anything we could add? (optional)' : 'What was missing or unclear? (optional)'}
              </label>
              <Textarea id={`fb-${slug}`} value={comment} maxLength={1000} rows={3} onChange={(e) => setComment(e.target.value)} />
              <Button size="sm" disabled={busy || !comment.trim()} onClick={() => send(vote, true)}>
                Send comment
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
