'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Star, CheckCircle2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GoogleReviewBlock } from '@/components/reviews/google-review-button';
import { reportApiError } from '@/lib/api-error';
import { cn } from '@/lib/utils';
import type { FeedbackContext } from '@/server/reviews/review-link';

const LABELS = ['', 'Poor', 'Not great', 'Okay', 'Good', 'Excellent'];

export function FeedbackLinkClient({ ctx, initialRating = 0 }: { ctx: FeedbackContext; initialRating?: number }) {
  const [rating, setRating] = useState(initialRating);
  const [comment, setComment] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ ticketOpened: boolean } | null>(null);
  const isQr = !ctx.order;
  const trackUrl = `/api/review-requests/${encodeURIComponent(ctx.token)}/google`;

  async function submit() {
    if (!rating) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/review-requests/${encodeURIComponent(ctx.token)}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment, ...(isQr ? { contactName, contactPhone } : {}) }),
      });
      if (!r.ok) {
        await reportApiError(r, 'Could not save your feedback');
        return;
      }
      const d = await r.json();
      setDone({ ticketOpened: !!d.ticketOpened });
      toast.success('Thanks for your feedback!');
    } finally {
      setBusy(false);
    }
  }

  const showForm = ctx.canSubmit && !done;

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6 sm:py-10">
      <div className="mb-5 flex items-center gap-3">
        {ctx.restaurant.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ctx.restaurant.logoUrl} alt="" className="size-12 shrink-0 rounded-xl border object-cover" />
        ) : null}
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight">{ctx.restaurant.name}</h1>
          <p className="text-sm text-muted-foreground">
            {ctx.order ? `How was your order ${ctx.order.code}?` : 'How was your visit?'}
          </p>
        </div>
      </div>

      {ctx.order && ctx.order.items.length > 0 && (
        <p className="mb-4 text-sm text-muted-foreground">
          {ctx.order.items.slice(0, 4).map((i) => `${i.quantity} × ${i.name}`).join(', ')}
          {ctx.order.items.length > 4 ? ` +${ctx.order.items.length - 4} more` : ''}
        </p>
      )}

      <Card className="mb-4 rounded-2xl">
        <CardContent className="p-4 sm:p-5">
          {showForm ? (
            <div className="grid gap-4">
              <div>
                <div className="mb-2 text-sm font-medium">Your rating</div>
                <div className="flex gap-1" role="radiogroup" aria-label="Rating">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={rating === n}
                      aria-label={`${n} star${n > 1 ? 's' : ''}`}
                      onClick={() => setRating(n)}
                      className="grid size-11 place-items-center rounded-lg hover:bg-muted"
                    >
                      <Star className={cn('size-8', n <= rating ? 'fill-warning text-warning' : 'text-muted-foreground')} />
                    </button>
                  ))}
                </div>
                <div className="mt-1 h-5 text-sm text-muted-foreground">{LABELS[rating]}</div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="fb-comment">Comment (optional)</Label>
                <Textarea id="fb-comment" maxLength={500} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Tell the restaurant what went well or what to fix" />
              </div>
              {isQr && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="fb-name">Name (optional)</Label>
                    <Input id="fb-name" maxLength={80} value={contactName} onChange={(e) => setContactName(e.target.value)} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="fb-phone">Phone, if you&apos;d like a call back (optional)</Label>
                    <Input id="fb-phone" type="tel" maxLength={40} value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
                  </div>
                </div>
              )}
              <Button onClick={submit} disabled={!rating || busy} className="h-11 w-full sm:w-auto">
                <Send className="size-4" /> {busy ? 'Sending…' : 'Send feedback'}
              </Button>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
              <div className="text-sm">
                {done ? (
                  <>
                    <div className="font-medium">Thanks for your feedback!</div>
                    {done.ticketOpened && (
                      <p className="mt-1 text-muted-foreground">
                        We&apos;re sorry it wasn&apos;t great. The restaurant has been notified and may reach out to make it right.
                      </p>
                    )}
                  </>
                ) : ctx.existing ? (
                  <div className="font-medium">You already rated this{ctx.existing.rating ? ` ${ctx.existing.rating}/5` : ''}. Thank you!</div>
                ) : ctx.closedReason === 'window_expired' ? (
                  <div className="font-medium">The feedback window for this order has closed.</div>
                ) : (
                  <div className="font-medium">Feedback opens once your order is delivered.</div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Same block, same place, at every rating — before and after submitting. */}
      <GoogleReviewBlock href={ctx.googleUrl} trackUrl={trackUrl} />

      {ctx.order && (
        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Link href={`/rv/${encodeURIComponent(ctx.token)}/stop`} className="underline">Stop review requests</Link>
        </p>
      )}
    </div>
  );
}
