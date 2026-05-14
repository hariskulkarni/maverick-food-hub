'use client';
/**
 * Rider feedback list — minimal client component (no interactivity beyond
 * scroll). Every row passed in has ALREADY been redacted by
 * `visibleForRole(_, 'RIDER')` on the server side, so:
 *   - foodRating / overallRating are null and never rendered
 *   - issueTags only contain delivery-side tags (LATE_DELIVERY, RIDER_BEHAVIOR)
 *   - comment is null unless the customer ticked "share with rider"
 *   - imageUrl is null when there were food-related issue tags
 *
 * If anything regresses we want it to be obvious — the column for food
 * rating literally doesn't exist here.
 */
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Star, MessageCircle } from 'lucide-react';

interface Row {
  id: string;
  orderId: string;
  deliveryRating: number | null;
  comment: string | null;
  issueTags: string[];
  imageUrl: string | null;
  createdAt: string;
}

const TAG_LABEL: Record<string, string> = {
  LATE_DELIVERY: 'Late delivery',
  RIDER_BEHAVIOR: 'Behaviour'
};

export function FeedbackClient({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          No ratings yet. Once customers rate your deliveries, you'll see them here.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.id} className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {labelForDate(r.createdAt)}
                </span>
                <Stars value={r.deliveryRating} />
              </div>
              {r.issueTags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {r.issueTags.map((t) => (
                    <Badge key={t} variant="warning" className="text-[10px]">{TAG_LABEL[t] ?? t}</Badge>
                  ))}
                </div>
              )}
              {r.comment && (
                <div className="rounded-lg bg-muted/40 p-2.5 text-xs flex gap-2">
                  <MessageCircle className="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  <span className="italic">"{r.comment}"</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Stars({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-muted-foreground">No rating</span>;
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`size-4 ${i <= value ? 'fill-warning text-warning' : 'text-muted-foreground/30'}`} />
      ))}
    </span>
  );
}

function labelForDate(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
