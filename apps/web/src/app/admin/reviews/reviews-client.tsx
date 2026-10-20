'use client';
import { useCallback, useEffect, useState } from 'react';
import { Bot, CheckCircle2, MessageSquareReply, RefreshCw, Sparkles, Star } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LogoMark } from '@/components/brand/logo';
import { cn } from '@/lib/utils';
import { reportApiError } from '@/lib/api-error';

type ReplyState = 'DRAFT' | 'PENDING_APPROVAL' | 'POSTED' | 'FAILED' | 'SKIPPED';

type Review = {
  id: string;
  reviewerName: string | null;
  rating: number;
  comment: string | null;
  reviewCreatedAt: string;
  reply: { state: ReplyState; text: string | null; source: string | null; postedAt: string | null } | null;
};

const STATE_FILTERS: { key: string; label: string }[] = [
  { key: '', label: 'All replies' },
  { key: 'PENDING_APPROVAL', label: 'Pending approval' },
  { key: 'POSTED', label: 'Posted' },
  { key: 'FAILED', label: 'Failed' },
  { key: 'SKIPPED', label: 'Skipped' },
];

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${n} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden="true"
          className={cn('h-4 w-4', i <= n ? 'fill-amber-400 text-amber-400' : 'fill-transparent text-muted-foreground/30')}
        />
      ))}
    </span>
  );
}

function fmt(d: string | null) {
  return d ? new Date(d).toLocaleString() : '';
}

function relTime(d: string | null) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  const mo = Math.floor(days / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

const PILL_BASE = 'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors';
const pillCls = (on: boolean) =>
  cn(PILL_BASE, on ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent');

function StatusPill({ state }: { state: ReplyState }) {
  const map: Record<ReplyState, { label: string; cls: string }> = {
    POSTED: { label: 'Posted', cls: 'border-success/30 bg-success/10 text-success' },
    PENDING_APPROVAL: { label: 'Draft - pending', cls: 'border-warning/40 bg-warning/10 text-warning' },
    DRAFT: { label: 'Draft', cls: 'border-warning/40 bg-warning/10 text-warning' },
    FAILED: { label: 'Failed', cls: 'border-destructive/30 bg-destructive/10 text-destructive' },
    SKIPPED: { label: 'Skipped', cls: 'border-border bg-muted text-muted-foreground' },
  };
  const m = map[state];
  return <span className={cn('rounded-full border px-2.5 py-0.5 text-xs font-medium', m.cls)}>{m.label}</span>;
}

function Avatar({ name }: { name: string | null }) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 font-display text-base font-semibold text-primary ring-1 ring-primary/20"
    >
      {initial}
    </span>
  );
}

export function ReviewsClient() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState('');
  const [state, setState] = useState('');
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ text: string; notConnected?: boolean } | null>(null);
  // Per-review textarea content (draft edits and manual replies).
  const [texts, setTexts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (rating) qs.set('rating', rating);
      if (state) qs.set('state', state);
      const r = await fetch(`/api/admin/reviews?${qs.toString()}`, { cache: 'no-store' });
      if (!r.ok) {
        await reportApiError(r, 'Could not load reviews');
        return;
      }
      const data = (await r.json()) as { reviews: Review[] };
      setReviews(data.reviews);
    } catch {
      toast.error('Could not load reviews');
    } finally {
      setLoading(false);
    }
  }, [rating, state]);

  useEffect(() => {
    load();
  }, [load]);

  async function sync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await fetch('/api/admin/reviews/sync', { method: 'POST' });
      if (r.status === 409) {
        setSyncMsg({ text: 'Connect Google Business first', notConnected: true });
        return;
      }
      if (!r.ok) {
        await reportApiError(r, 'Google sync failed');
        return;
      }
      const d = (await r.json()) as { synced: number; created: number };
      setSyncMsg({ text: `Synced ${d.synced} (${d.created} new)` });
      await load();
    } catch {
      toast.error('Google sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function act(id: string, action: 'generate' | 'approve' | 'reply', text?: string) {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      const r = await fetch(`/api/admin/reviews/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: action === 'reply' ? JSON.stringify({ text }) : undefined,
      });
      if (!r.ok) {
        await reportApiError(r, 'Action failed');
        return;
      }
      toast.success(action === 'generate' ? 'Draft generated' : 'Reply posted');
      setTexts((t) => {
        const { [id]: _drop, ...rest } = t;
        return rest;
      });
      await load();
    } catch {
      toast.error('Action failed');
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  const drafts = reviews.filter((r) => r.reply?.state === 'PENDING_APPROVAL');
  const others = reviews.filter((r) => r.reply?.state !== 'PENDING_APPROVAL');

  function approve(r: Review) {
    const original = r.reply?.text ?? '';
    const edited = texts[r.id] ?? original;
    if (edited.trim() === original.trim()) return act(r.id, 'approve');
    return act(r.id, 'reply', edited.trim());
  }

  function header(r: Review) {
    return (
      <div className="flex items-start gap-3">
        <Avatar name={r.reviewerName} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate font-medium">{r.reviewerName ?? 'Anonymous'}</span>
            <span className="text-xs text-muted-foreground" title={fmt(r.reviewCreatedAt)}>
              {relTime(r.reviewCreatedAt)}
            </span>
          </div>
          <Stars n={r.rating} />
        </div>
        {r.reply && <StatusPill state={r.reply.state} />}
      </div>
    );
  }

  const noFilters = !rating && !state;

  return (
    <div className="space-y-6 overflow-x-hidden px-4 py-4 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <LogoMark className="h-11 w-11 shrink-0 drop-shadow-sm" />
          <div>
            <h1 className="display text-2xl font-semibold leading-tight">
              <span className="text-gradient-brand">Google Reviews</span>
            </h1>
            <p className="text-sm text-muted-foreground">Read what guests say and reply with AI-assisted drafts.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {syncMsg && (
            <span className="text-sm text-muted-foreground" role="status">
              {syncMsg.text}
              {syncMsg.notConnected && (
                <>
                  {' '}
                  <a href="/admin/settings" className="text-primary underline">Open settings</a>
                </>
              )}
            </span>
          )}
          <Button variant="outline" className="gap-2 rounded-full" disabled={syncing} onClick={sync}>
            <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} aria-hidden="true" />
            {syncing ? 'Syncing…' : 'Sync from Google'}
          </Button>
        </div>
      </header>

      <div className="space-y-2" role="group" aria-label="Filters">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Rating</span>
          <button type="button" aria-pressed={rating === ''} className={pillCls(rating === '')} onClick={() => setRating('')}>
            All
          </button>
          {[5, 4, 3, 2, 1].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={rating === String(n)}
              className={cn(pillCls(rating === String(n)), 'inline-flex items-center gap-1')}
              onClick={() => setRating(String(n))}
            >
              {n}
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Reply</span>
          {STATE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={state === f.key}
              className={pillCls(state === f.key)}
              onClick={() => setState(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="space-y-3" role="status" aria-label="Loading reviews">
          {[0, 1].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border bg-muted/40" />
          ))}
        </div>
      )}

      {drafts.length > 0 && (
        <section className="space-y-3 rounded-2xl border border-warning/40 bg-warning/5 p-3 sm:p-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="h-5 w-5 text-warning" aria-hidden="true" />
            Draft inbox
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">{drafts.length}</span>
          </h2>
          {drafts.map((r) => (
            <Card key={r.id} className="border-l-4 border-l-warning shadow-sm">
              <CardContent className="space-y-3 p-4">
                {header(r)}
                {r.comment && <p className="whitespace-pre-wrap break-words text-sm">{r.comment}</p>}
                <div className="space-y-2 rounded-xl border border-warning/30 bg-warning/5 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
                    <Bot className="h-3.5 w-3.5" aria-hidden="true" /> Suggested reply - edit before posting
                  </p>
                  <textarea
                    aria-label="Draft reply"
                    className="w-full rounded-md border bg-background p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    rows={4}
                    value={texts[r.id] ?? r.reply?.text ?? ''}
                    onChange={(e) => setTexts((t) => ({ ...t, [r.id]: e.target.value }))}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button className="gap-2" disabled={busy[r.id]} onClick={() => approve(r)}>
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      Approve &amp; Post
                    </Button>
                    <Button variant="outline" className="gap-2" disabled={busy[r.id]} onClick={() => act(r.id, 'generate')}>
                      <RefreshCw className="h-4 w-4" aria-hidden="true" />
                      Regenerate
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">All reviews</h2>
        {!loading && others.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-4 py-12 text-center">
            <div className="relative">
              <div className="absolute inset-0 -z-10 scale-150 rounded-full bg-primary/10 blur-2xl" aria-hidden="true" />
              <LogoMark className="h-16 w-16 drop-shadow" />
            </div>
            <div className="flex gap-0.5" aria-hidden="true">
              {[1, 2, 3, 4, 5].map((i) => (
                <Star key={i} className="h-4 w-4 fill-amber-400/60 text-amber-400/60" />
              ))}
            </div>
            <p className="font-medium">{noFilters ? 'No reviews yet' : 'No reviews match these filters'}</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {noFilters
                ? 'Connect Google in Settings → Reviews and hit Sync.'
                : 'Try clearing a filter to see more reviews.'}
            </p>
          </div>
        )}
        {others.map((r) => (
          <Card key={r.id} className="shadow-sm transition-shadow hover:shadow-md">
            <CardContent className="space-y-3 p-4">
              {header(r)}
              {r.comment && <p className="whitespace-pre-wrap break-words text-sm">{r.comment}</p>}
              {r.reply?.state === 'POSTED' ? (
                <div className="ml-4 rounded-2xl rounded-tl-sm border border-success/20 bg-success/5 p-3 text-sm sm:ml-12">
                  <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-success">
                    <MessageSquareReply className="h-3.5 w-3.5" aria-hidden="true" /> Your reply
                  </p>
                  <p className="whitespace-pre-wrap break-words">{r.reply.text}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Posted {fmt(r.reply.postedAt)}</p>
                </div>
              ) : (
                <div className="space-y-2 rounded-xl bg-muted/40 p-3">
                  <textarea
                    aria-label="Reply"
                    className="w-full rounded-md border bg-background p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    rows={3}
                    placeholder="Write a reply…"
                    value={texts[r.id] ?? ''}
                    onChange={(e) => setTexts((t) => ({ ...t, [r.id]: e.target.value }))}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" className="gap-2" disabled={busy[r.id]} onClick={() => act(r.id, 'generate')}>
                      <Sparkles className="h-4 w-4" aria-hidden="true" />
                      Generate draft
                    </Button>
                    <Button
                      disabled={busy[r.id] || !(texts[r.id] ?? '').trim()}
                      onClick={() => act(r.id, 'reply', (texts[r.id] ?? '').trim())}
                    >
                      Post reply
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
