'use client';
/**
 * Post-delivery feedback dialog.
 *
 *   Props:
 *     order      — { id, code, deliveredAt }
 *     existing   — current feedback row (or null for "create" mode)
 *     readOnly   — render a summary card with no inputs (window expired)
 *     open / onOpenChange — controlled visibility
 *     onSaved    — called after a successful save / edit
 *
 * Layout (top → bottom):
 *   1. Star-rating triplet (food, delivery, overall)
 *   2. Issue-tag chips (multi-select, friendly labels)
 *   3. Comment textarea (max 500 chars + counter)
 *   4. Optional image uploader
 *   5. "Share comment with rider" checkbox
 *   6. Footer: Save / Update + Cancel
 *
 * 48h countdown chip shows in the header when editing an existing row.
 */
import { useEffect, useMemo, useState } from 'react';
import { Star, Clock, AlertCircle, MessageSquare, ImageIcon, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ImageUploader } from '@/components/image-uploader';
import { cn } from '@/lib/utils';

export interface FeedbackLite {
  id: string;
  orderId: string;
  customerId: string;
  foodRating: number | null;
  deliveryRating: number | null;
  overallRating: number | null;
  comment: string | null;
  issueTags: string[];
  imageUrl: string | null;
  shareCommentWithRider: boolean;
  windowEndsAt: string | Date;
  createdAt: string | Date;
  editedAt: string | Date | null;
}

interface Props {
  order: { id: string; code: string; deliveredAt: string | Date | null };
  existing?: FeedbackLite | null;
  readOnly?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

const TAGS: { value: string; label: string }[] = [
  { value: 'LATE_DELIVERY', label: 'Late delivery' },
  { value: 'MISSING_ITEM', label: 'Missing item' },
  { value: 'WRONG_ITEM', label: 'Wrong item' },
  { value: 'COLD_FOOD', label: 'Cold food' },
  { value: 'PACKAGING_ISSUE', label: 'Packaging issue' },
  { value: 'RIDER_BEHAVIOR', label: 'Rider behaviour' },
  { value: 'FOOD_QUALITY', label: 'Food quality' }
];
const TAG_LABEL: Record<string, string> = Object.fromEntries(TAGS.map((t) => [t.value, t.label]));

export function FeedbackDialog({ order, existing, readOnly, open, onOpenChange, onSaved }: Props) {
  const isEditing = !!existing && !readOnly;

  const [foodRating, setFoodRating] = useState<number | null>(existing?.foodRating ?? null);
  const [deliveryRating, setDeliveryRating] = useState<number | null>(existing?.deliveryRating ?? null);
  const [overallRating, setOverallRating] = useState<number | null>(existing?.overallRating ?? null);
  const [comment, setComment] = useState<string>(existing?.comment ?? '');
  const [tags, setTags] = useState<string[]>(existing?.issueTags ?? []);
  const [imageUrl, setImageUrl] = useState<string | null>(existing?.imageUrl ?? null);
  const [shareWithRider, setShareWithRider] = useState<boolean>(existing?.shareCommentWithRider ?? false);
  const [busy, setBusy] = useState(false);

  // Re-seed form whenever `existing` changes (re-opening the dialog
  // for a different order shouldn't show stale state).
  useEffect(() => {
    setFoodRating(existing?.foodRating ?? null);
    setDeliveryRating(existing?.deliveryRating ?? null);
    setOverallRating(existing?.overallRating ?? null);
    setComment(existing?.comment ?? '');
    setTags(existing?.issueTags ?? []);
    setImageUrl(existing?.imageUrl ?? null);
    setShareWithRider(existing?.shareCommentWithRider ?? false);
  }, [existing?.id, open]);

  const hasAnyInput =
    foodRating != null || deliveryRating != null || overallRating != null || tags.length > 0;

  const windowEndsAt = useMemo(() => {
    if (existing?.windowEndsAt) return new Date(existing.windowEndsAt);
    if (!order.deliveredAt) return null;
    return new Date(new Date(order.deliveredAt).getTime() + 48 * 60 * 60 * 1000);
  }, [existing?.windowEndsAt, order.deliveredAt]);

  function toggleTag(t: string) {
    setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  async function save() {
    if (!hasAnyInput) return;
    setBusy(true);
    try {
      const method = existing ? 'PATCH' : 'POST';
      const res = await fetch(`/api/customer/orders/${order.id}/feedback`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          foodRating: foodRating ?? undefined,
          deliveryRating: deliveryRating ?? undefined,
          overallRating: overallRating ?? undefined,
          comment: comment.trim() ? comment.trim() : undefined,
          issueTags: tags,
          imageUrl: imageUrl ?? undefined,
          shareCommentWithRider: shareWithRider
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.reason ? `Couldn't save: ${humanReason(body.reason)}` : 'Could not save feedback');
        return;
      }
      toast.success(existing ? 'Feedback updated' : 'Thanks for the feedback!');
      onSaved?.();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle>
                {readOnly ? 'Your feedback' : existing ? 'Edit your feedback' : 'How was your order?'}
              </DialogTitle>
              <DialogDescription>
                Order <span className="font-mono">{order.code}</span>
                {existing?.createdAt && (
                  <> · Submitted {timeAgo(new Date(existing.createdAt))}</>
                )}
              </DialogDescription>
            </div>
            {isEditing && windowEndsAt && <CountdownChip endsAt={windowEndsAt} />}
          </div>
        </DialogHeader>

        {readOnly && existing ? (
          <ReadOnlySummary feedback={existing} />
        ) : (
          <div className="space-y-5">
            <RatingRow label="Food" value={foodRating} onChange={setFoodRating} />
            <RatingRow label="Delivery" value={deliveryRating} onChange={setDeliveryRating} />
            <RatingRow label="Overall" value={overallRating} onChange={setOverallRating} />

            <div>
              <div className="text-sm font-medium mb-2">Anything specific? (optional)</div>
              <div className="flex flex-wrap gap-2">
                {TAGS.map((t) => {
                  const active = tags.includes(t.value);
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => toggleTag(t.value)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-all tap-press',
                        active
                          ? 'border-primary bg-primary text-primary-foreground shadow-sm shadow-primary/30'
                          : 'border-border bg-card hover:border-primary hover:text-primary'
                      )}
                    >
                      {active && <X className="size-3" />}
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="fb-comment" className="text-sm font-medium inline-flex items-center gap-1.5">
                  <MessageSquare className="size-3.5 text-muted-foreground" /> Tell us more (optional)
                </label>
                <span className={cn('text-[11px]', comment.length > 480 ? 'text-warning' : 'text-muted-foreground')}>
                  {comment.length}/500
                </span>
              </div>
              <Textarea
                id="fb-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, 500))}
                placeholder="What stood out? What could be better?"
                rows={4}
              />
            </div>

            <div>
              <div className="text-sm font-medium mb-2 inline-flex items-center gap-1.5">
                <ImageIcon className="size-3.5 text-muted-foreground" /> Add a photo (optional)
              </div>
              <ImageUploader
                value={imageUrl}
                onChange={setImageUrl}
                folder="feedback"
                uploadUrl="/api/uploads"
                aspect="video"
                hint="Helpful when reporting missing items, packaging issues, or food quality"
              />
            </div>

            <label className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={shareWithRider}
                onChange={(e) => setShareWithRider(e.target.checked)}
                className="mt-0.5 size-4 accent-primary"
              />
              <span className="text-sm">
                <span className="font-medium">Share my comment with the rider</span>
                <span className="block text-xs text-muted-foreground">
                  By default, the rider only sees your delivery rating. Tick this if your comment is meant for them.
                </span>
              </span>
            </label>
          </div>
        )}

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button onClick={save} disabled={!hasAnyInput || busy}>
              <Send className="size-4" />
              {busy ? 'Saving…' : existing ? 'Update feedback' : 'Save feedback'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────

function RatingRow({
  label,
  value,
  onChange
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => {
          const active = value != null && n <= value;
          return (
            <button
              key={n}
              type="button"
              aria-label={`${label} ${n} star${n > 1 ? 's' : ''}`}
              onClick={() => onChange(value === n ? null : n)}
              className={cn(
                'rounded-full p-1 transition-transform hover:scale-110 tap-press',
                active ? 'text-warning' : 'text-muted-foreground/40 hover:text-warning/70'
              )}
            >
              <Star className={cn('size-6', active && 'fill-warning')} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CountdownChip({ endsAt }: { endsAt: Date }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const remainMs = endsAt.getTime() - now.getTime();
  if (remainMs <= 0) {
    return (
      <Badge variant="muted" className="shrink-0">
        <Clock className="size-3 mr-1" /> Closed
      </Badge>
    );
  }
  const totalMin = Math.floor(remainMs / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return (
    <Badge variant={h < 6 ? 'warning' : 'default'} className="shrink-0">
      <Clock className="size-3 mr-1" /> Edit window: {h}h {m}m
    </Badge>
  );
}

function ReadOnlySummary({ feedback }: { feedback: FeedbackLite }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
        <SummaryStars label="Food" value={feedback.foodRating} />
        <SummaryStars label="Delivery" value={feedback.deliveryRating} />
        <SummaryStars label="Overall" value={feedback.overallRating} />
        {feedback.issueTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {feedback.issueTags.map((t) => (
              <Badge key={t} variant="muted">
                {TAG_LABEL[t] ?? t}
              </Badge>
            ))}
          </div>
        )}
        {feedback.comment && (
          <p className="text-sm text-foreground whitespace-pre-wrap border-l-2 border-primary/40 pl-3">
            {feedback.comment}
          </p>
        )}
        {feedback.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={feedback.imageUrl}
            alt="Feedback attachment"
            className="rounded-lg w-full max-h-60 object-cover border"
          />
        )}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <AlertCircle className="size-3.5" />
        The 48-hour edit window has closed. This feedback is now read-only.
      </div>
    </div>
  );
}

function SummaryStars({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium">{label}</span>
      {value == null ? (
        <span className="text-xs text-muted-foreground">Not rated</span>
      ) : (
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star
              key={n}
              className={cn('size-4', n <= value ? 'fill-warning text-warning' : 'text-muted-foreground/30')}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

function humanReason(reason: string): string {
  switch (reason) {
    case 'not_delivered':
      return 'order is not delivered yet';
    case 'window_expired':
      return '48-hour window has closed';
    case 'already_submitted':
      return 'feedback already submitted for this order';
    case 'not_owner':
      return 'you do not own this order';
    default:
      return reason;
  }
}

function timeAgo(d: Date): string {
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}
