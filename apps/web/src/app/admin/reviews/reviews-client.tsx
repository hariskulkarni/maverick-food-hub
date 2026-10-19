'use client';
import { useCallback, useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
    <span className="inline-flex" aria-label={`${n} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`h-4 w-4 ${i <= n ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40'}`} />
      ))}
    </span>
  );
}

function fmt(d: string | null) {
  return d ? new Date(d).toLocaleString() : '';
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
      <div className="flex flex-wrap items-center gap-2">
        <Stars n={r.rating} />
        <span className="font-medium">{r.reviewerName ?? 'Anonymous'}</span>
        <span className="text-xs text-muted-foreground">{fmt(r.reviewCreatedAt)}</span>
        {r.reply && (
          <span className="rounded bg-muted px-2 py-0.5 text-xs">{r.reply.state.replace('_', ' ').toLowerCase()}</span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="display text-2xl font-semibold">Reviews</h1>
        <div className="flex flex-wrap items-center gap-2">
          {syncMsg && (
            <span className="text-sm text-muted-foreground" role="status">
              {syncMsg.text}
              {syncMsg.notConnected && (
                <>
                  {' '}
                  <a href="/admin/settings" className="underline">Open settings</a>
                </>
              )}
            </span>
          )}
          <Button variant="outline" disabled={syncing} onClick={sync}>
            {syncing ? 'Syncing…' : 'Sync from Google'}
          </Button>
          <select
            aria-label="Filter by rating"
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={rating}
            onChange={(e) => setRating(e.target.value)}
          >
            <option value="">All ratings</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>{n} star{n > 1 ? 's' : ''}</option>
            ))}
          </select>
          <select
            aria-label="Filter by reply state"
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            {STATE_FILTERS.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {drafts.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Draft inbox ({drafts.length})</h2>
          {drafts.map((r) => (
            <Card key={r.id}>
              <CardContent className="space-y-3 p-4">
                {header(r)}
                {r.comment && <p className="text-sm">{r.comment}</p>}
                <textarea
                  className="w-full rounded-md border bg-background p-2 text-sm"
                  rows={4}
                  value={texts[r.id] ?? r.reply?.text ?? ''}
                  onChange={(e) => setTexts((t) => ({ ...t, [r.id]: e.target.value }))}
                />
                <div className="flex gap-2">
                  <Button disabled={busy[r.id]} onClick={() => approve(r)}>Approve &amp; Post</Button>
                  <Button variant="outline" disabled={busy[r.id]} onClick={() => act(r.id, 'generate')}>
                    Regenerate
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">All reviews</h2>
        {!loading && others.length === 0 && <p className="text-sm text-muted-foreground">No reviews found.</p>}
        {others.map((r) => (
          <Card key={r.id}>
            <CardContent className="space-y-3 p-4">
              {header(r)}
              {r.comment && <p className="text-sm">{r.comment}</p>}
              {r.reply?.state === 'POSTED' ? (
                <div className="rounded-md bg-muted/50 p-3 text-sm">
                  <p>{r.reply.text}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Posted {fmt(r.reply.postedAt)}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <textarea
                    className="w-full rounded-md border bg-background p-2 text-sm"
                    rows={3}
                    placeholder="Write a reply…"
                    value={texts[r.id] ?? ''}
                    onChange={(e) => setTexts((t) => ({ ...t, [r.id]: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={busy[r.id]}
                      onClick={() => act(r.id, 'generate')}
                    >
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
