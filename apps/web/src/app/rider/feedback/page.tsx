/**
 * Rider · Feedback ("Your ratings")
 *
 * Server component. Pulls `loadRiderFeedback(profileId)` — that loader has
 * already projected each row through `visibleForRole(_, 'RIDER')` so:
 *   - food rating + overall rating are null
 *   - non-delivery tags are filtered out (only LATE_DELIVERY / RIDER_BEHAVIOR)
 *   - comment is shown only when the customer ticked "share with rider"
 *   - food images are stripped
 *
 * We render an average-delivery-rating hero + a recent-50 list. The food
 * rating / food tags / food image MUST never appear here even by accident,
 * so we don't even pull the raw row.
 */
import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { loadRiderFeedback } from '@/server/feedback';
import { Card, CardContent } from '@/components/ui/card';
import { FeedbackClient } from './feedback-client';
import { Star } from 'lucide-react';

export const metadata = { title: 'Rider · Your ratings' };
export const dynamic = 'force-dynamic';

export default async function RiderFeedbackPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'RIDER') redirect('/login?next=/rider/feedback&mode=rider');
  const profile = await prisma.riderProfile.findUnique({ where: { userId: session.user.id } });
  if (!profile) {
    return (
      <div className="text-center py-10">
        <h1 className="display text-xl font-semibold">No rider profile</h1>
        <p className="text-sm text-muted-foreground mt-2">Your rider profile is not set up yet.</p>
      </div>
    );
  }

  const { rows, summary } = await loadRiderFeedback(profile.id);
  const avgDelivery = summary.avgDelivery;
  const tripCount = summary.count;

  // Trim to last 50 — the loader takes 200 by default.
  const recent = rows.slice(0, 50);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5 text-center">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Average delivery rating</div>
          <div className="display text-5xl font-bold text-primary mt-1">
            {avgDelivery != null ? avgDelivery.toFixed(1) : '—'}
          </div>
          <div className="mt-2 inline-flex items-center gap-0.5" aria-label={`${avgDelivery ?? 0} of 5`}>
            {[1, 2, 3, 4, 5].map((i) => (
              <Star
                key={i}
                className={`size-6 ${avgDelivery != null && i <= Math.round(avgDelivery) ? 'fill-warning text-warning' : 'text-muted-foreground/30'}`}
              />
            ))}
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            From {tripCount} {tripCount === 1 ? 'delivery' : 'deliveries'} rated by customers
          </div>
        </CardContent>
      </Card>

      <FeedbackClient rows={JSON.parse(JSON.stringify(recent))} />
    </div>
  );
}
