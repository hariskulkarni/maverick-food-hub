'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BarChart3, Clock, RefreshCw, Search, Sparkles, Star } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LogoMark } from '@/components/brand/logo';
import { cn } from '@/lib/utils';
import { reportApiError } from '@/lib/api-error';
import { ReviewCard, type Review, type Template } from './review-card';

export { GOOGLE_REPLY_URL } from './review-card';

const STATE_FILTERS: { key: string; label: string }[] = [
  { key: '', label: 'All replies' },
  { key: 'PENDING_APPROVAL', label: 'Pending approval' },
  { key: 'DRAFT', label: 'Saved drafts' },
  { key: 'POSTED', label: 'Posted' },
  { key: 'FAILED', label: 'Failed' },
  { key: 'SKIPPED', label: 'Skipped' },
];

const PILL_BASE = 'min-h-[36px] rounded-full border px-2.5 py-1 text-xs font-medium transition-colors';
const pillCls = (on: boolean) =>
  cn(PILL_BASE, on ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent');

type ListResponse = { reviews: Review[]; nextCursor: string | null; slaHours: number };

function initialParam(name: string): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get(name) ?? '';
}

export function ReviewsClient() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [linked, setLinked] = useState<Review | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [slaHours, setSlaHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [rating, setRating] = useState('');
  const [state, setState] = useState('');
  const [overdue, setOverdue] = useState(false);
  // Read ?overdue=1 after mount (not during render) to avoid a hydration mismatch.
  useEffect(() => { if (initialParam('overdue') === '1') setOverdue(true); }, []);
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ text: string; notConnected?: boolean } | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const linkedId = useRef(initialParam('review'));

  const query = useCallback((cursor?: string) => {
    const qs = new URLSearchParams();
    if (rating) qs.set('rating', rating);
    if (state) qs.set('state', state);
    if (overdue) qs.set('overdue', '1');
    if (q) qs.set('q', q);
    if (cursor) qs.set('cursor', cursor);
    return `/api/admin/reviews?${qs.toString()}`;
  }, [rating, state, overdue, q]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(query(), { cache: 'no-store' });
      if (!r.ok) { await reportApiError(r, 'Could not load reviews'); return; }
      const data = (await r.json()) as ListResponse;
      setReviews(data.reviews);
      setNextCursor(data.nextCursor);
      setSlaHours(data.slaHours);
      if (linkedId.current) {
        const one = await fetch(`/api/admin/reviews?id=${encodeURIComponent(linkedId.current)}`, { cache: 'no-store' });
        if (one.ok) setLinked(((await one.json()) as ListResponse).reviews[0] ?? null);
      }
    } catch {
      toast.error('Could not load reviews');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 350);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    fetch('/api/admin/reviews/templates', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d) => setTemplates(d.templates ?? []))
      .catch(() => setTemplates([]));
  }, []);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const r = await fetch(query(nextCursor), { cache: 'no-store' });
      if (!r.ok) { await reportApiError(r, 'Could not load more reviews'); return; }
      const data = (await r.json()) as ListResponse;
      setReviews((cur) => [...cur, ...data.reviews.filter((x) => !cur.some((c) => c.id === x.id))]);
      setNextCursor(data.nextCursor);
    } catch {
      toast.error('Could not load more reviews');
    } finally {
      setLoadingMore(false);
    }
  }

  async function sync() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await fetch('/api/admin/reviews/sync', { method: 'POST' });
      if (r.status === 409) {
        // No Business Profile link: fall back to the Places quick-connect, if any.
        const p = await fetch('/api/admin/reviews/places/sync', { method: 'POST' });
        if (p.status === 409) { setSyncMsg({ text: 'Connect Google first', notConnected: true }); return; }
        if (!p.ok) { await reportApiError(p, 'Google sync failed'); return; }
        const pd = (await p.json()) as { synced: number; created: number };
        setSyncMsg({ text: `Synced ${pd.synced} (${pd.created} new)` });
        await load();
        return;
      }
      if (!r.ok) { await reportApiError(r, 'Google sync failed'); return; }
      const d = (await r.json()) as { synced: number; created: number; repliesImported?: number };
      setSyncMsg({ text: `Synced ${d.synced} (${d.created} new${d.repliesImported ? `, ${d.repliesImported} replies imported` : ''})` });
      await load();
    } catch {
      toast.error('Google sync failed');
    } finally {
      setSyncing(false);
    }
  }

  const visible = reviews.filter((r) => r.id !== linked?.id);
  const drafts = visible.filter((r) => r.reply?.state === 'PENDING_APPROVAL');
  const others = visible.filter((r) => r.reply?.state !== 'PENDING_APPROVAL');
  const noFilters = !rating && !state && !overdue && !q;

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
              {syncMsg.notConnected && (<>{' '}<a href="/admin/settings" className="text-primary underline">Open settings</a></>)}
            </span>
          )}
          <Button asChild variant="outline" className="min-h-[44px] gap-2 rounded-full">
            <Link href="/admin/reviews/insights"><BarChart3 className="h-4 w-4" aria-hidden="true" /> Insights</Link>
          </Button>
          <Button variant="outline" className="min-h-[44px] gap-2 rounded-full" disabled={syncing} onClick={sync}>
            <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} aria-hidden="true" />
            {syncing ? 'Syncing…' : 'Sync from Google'}
          </Button>
        </div>
      </header>

      <div className="space-y-2" role="group" aria-label="Filters">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input aria-label="Search reviews" placeholder="Search reviewer or text…" className="pl-9" value={qInput} onChange={(e) => setQInput(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Rating</span>
          <button type="button" aria-pressed={rating === ''} className={pillCls(rating === '')} onClick={() => setRating('')}>All</button>
          {[5, 4, 3, 2, 1].map((n) => (
            <button key={n} type="button" aria-pressed={rating === String(n)}
              className={cn(pillCls(rating === String(n)), 'inline-flex items-center gap-1')} onClick={() => setRating(String(n))}>
              {n}<Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Reply</span>
          {STATE_FILTERS.map((f) => (
            <button key={f.key} type="button" aria-pressed={state === f.key} className={pillCls(state === f.key)} onClick={() => setState(f.key)}>
              {f.label}
            </button>
          ))}
          <button type="button" aria-pressed={overdue} className={cn(pillCls(overdue), 'inline-flex items-center gap-1')} onClick={() => setOverdue((v) => !v)}>
            <Clock className="h-3 w-3" aria-hidden="true" /> Overdue (&gt; {slaHours}h)
          </button>
        </div>
      </div>

      {loading && (
        <div className="space-y-3" role="status" aria-label="Loading reviews">
          {[0, 1].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl border bg-muted/40" />)}
        </div>
      )}

      {linked && (
        <section className="space-y-2" aria-label="Linked review">
          <h2 className="text-sm font-semibold text-muted-foreground">From your alert</h2>
          <ReviewCard r={linked} templates={templates} highlight onChanged={load} />
        </section>
      )}

      {drafts.length > 0 && (
        <section className="space-y-3 rounded-2xl border border-warning/40 bg-warning/5 p-3 sm:p-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="h-5 w-5 text-warning" aria-hidden="true" />
            Draft inbox
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">{drafts.length}</span>
          </h2>
          {drafts.map((r) => <ReviewCard key={r.id} r={r} templates={templates} onChanged={load} />)}
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
            <p className="font-medium">{noFilters ? 'No reviews yet' : 'No reviews match these filters'}</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {noFilters ? 'Connect Google in Settings → Reviews and hit Sync.' : 'Try clearing a filter to see more reviews.'}
            </p>
          </div>
        )}
        {others.map((r) => <ReviewCard key={r.id} r={r} templates={templates} onChanged={load} />)}
        {nextCursor && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" className="min-h-[44px]" disabled={loadingMore} onClick={loadMore}>
              {loadingMore ? 'Loading…' : 'Load more reviews'}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
