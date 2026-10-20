'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

interface MyReview {
  id: string;
  orderId: string;
  orderCode: string | null;
  restaurant: { name: string; slug: string } | null;
  foodRating: number | null;
  deliveryRating: number | null;
  overallRating: number | null;
  comment: string | null;
  issueTags: string[];
  imageUrl: string | null;
  shareCommentWithRider: boolean;
  sharePublicly: boolean;
  createdAt: string;
  windowEndsAt: string;
  canEdit: boolean;
  reply: { text: string; at: string | null } | null;
}

export function ReviewsClient() {
  const [reviews, setReviews] = useState<MyReview[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [overall, setOverall] = useState(5);
  const [comment, setComment] = useState('');
  const [share, setShare] = useState(false);
  const [sharePublic, setSharePublic] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/customer/reviews');
    setReviews(res.ok ? (await res.json()).reviews : []);
  }, []);
  useEffect(() => { load(); }, [load]);

  function startEdit(r: MyReview) {
    setEditing(r.id); setOverall(r.overallRating ?? 5); setComment(r.comment ?? ''); setShare(r.shareCommentWithRider); setSharePublic(!!r.sharePublicly); setErr(null);
  }

  async function save(r: MyReview) {
    // PATCH replaces all fields, so carry over the ones this form doesn't edit.
    const res = await fetch(`/api/customer/orders/${r.orderId}/feedback`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(r.foodRating != null ? { foodRating: r.foodRating } : {}),
        ...(r.deliveryRating != null ? { deliveryRating: r.deliveryRating } : {}),
        overallRating: overall,
        comment: comment || undefined,
        issueTags: r.issueTags,
        ...(r.imageUrl ? { imageUrl: r.imageUrl } : {}),
        shareCommentWithRider: share,
        sharePublicly: sharePublic,
      }),
    });
    if (res.ok) { setEditing(null); await load(); }
    else setErr(res.status === 409 ? 'The 48-hour edit window has closed.' : 'Could not save. Please try again.');
  }

  if (!reviews) return <p className="mt-4 text-sm text-muted-foreground">Loading…</p>;
  if (reviews.length === 0) return <p className="mt-4 text-sm text-muted-foreground">You have not reviewed any orders yet.</p>;

  return (
    <ul className="mt-4 grid gap-3">
      {reviews.map((r) => (
        <li key={r.id} className="rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-medium">{r.restaurant?.name ?? 'Restaurant'} <span className="text-xs text-muted-foreground">#{r.orderCode}</span></div>
            <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleDateString('en-IN')}</span>
          </div>
          {editing === r.id ? (
            <div className="mt-3 grid gap-3">
              <label className="text-sm">Overall rating
                <select className="ml-2 min-h-10 rounded-md border bg-background px-2" value={overall} onChange={(e) => setOverall(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <textarea className="w-full rounded-md border bg-background p-2 text-sm" rows={3} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Comment" />
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={share} onChange={(e) => setShare(e.target.checked)} />
                <span>Share my comment with the rider</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={sharePublic} onChange={(e) => setSharePublic(e.target.checked)} />
                <span>Show my comment on the public page
                  <span className="block text-xs text-muted-foreground">Your first name, rating and comment will be visible to anyone on the restaurant&apos;s page.</span>
                </span>
              </label>
              {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
              <div className="flex gap-2">
                <Button className="min-h-10" onClick={() => save(r)}>Save</Button>
                <Button className="min-h-10" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <>
              <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {r.overallRating != null && <div>Overall: {r.overallRating}/5</div>}
                {r.foodRating != null && <div>Food: {r.foodRating}/5</div>}
                {r.deliveryRating != null && <div>Delivery: {r.deliveryRating}/5</div>}
              </dl>
              {r.comment && <p className="mt-2 text-sm break-words">{r.comment}</p>}
              {r.reply && (
                <div className="mt-3 rounded-lg bg-muted/60 border-l-4 border-primary px-3 py-2 text-sm">
                  <p className="text-xs font-semibold text-muted-foreground">Response from the restaurant</p>
                  <p className="mt-1 break-words">{r.reply.text}</p>
                </div>
              )}
              <div className="mt-3">
                {r.canEdit
                  ? <Button className="min-h-10" variant="outline" onClick={() => startEdit(r)}>Edit (until {new Date(r.windowEndsAt).toLocaleString('en-IN')})</Button>
                  : <p className="text-xs text-muted-foreground">Editing closed (48-hour window passed).</p>}
              </div>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
