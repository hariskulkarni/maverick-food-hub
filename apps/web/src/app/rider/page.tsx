/**
 * Rider dashboard (`/rider`). Strictly rider-only — no customer concerns
 * (no restaurants to browse, no cart, no customer profile links).
 *
 * Sections, top-to-bottom:
 *   1. Today summary strip — trips delivered today + today's earnings (₹)
 *   2. Active assignments + online toggle (RiderActiveBoard)
 *   3. Recent deliveries summary — last 3 completed, with a link to /rider/history
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { money } from '@/lib/utils';
import { History as HistoryIcon, ChevronRight, CheckCircle2, Star } from 'lucide-react';
import { RiderActiveBoard } from './active-board';
import { loadRiderFeedback } from '@/server/feedback';

export const metadata = { title: 'Rider · Active' };

export default async function RiderActivePage() {
  const session = await auth();
  if (!session?.user) redirect('/login?next=/rider');
  const profile = await prisma.riderProfile.findUnique({ where: { userId: session.user.id } });
  if (!profile) {
    return (
      <div className="text-center py-10">
        <h1 className="display text-xl font-semibold">Welcome</h1>
        <p className="text-sm text-muted-foreground mt-2">Your rider profile is not set up yet. Please contact the admin.</p>
      </div>
    );
  }

  // Day window (local midnight → now) for today's earnings + trip count.
  // We bucket on DELIVERED assignments only — failed deliveries don't pay.
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [assignments, todaysDeliveries, recentDeliveries] = await Promise.all([
    prisma.riderAssignment.findMany({
      where: { riderId: profile.id, status: { in: ['PENDING', 'ACCEPTED', 'PICKED_UP'] } },
      include: { order: { include: { items: true, customer: true, address: true, branch: true } } },
      orderBy: { assignedAt: 'asc' }
    }),
    prisma.riderAssignment.findMany({
      where: {
        riderId: profile.id,
        status: 'DELIVERED',
        deliveredAt: { gte: startOfDay }
      },
      // earningsAmt already includes base + bonus + tip, so we sum that directly.
      select: { id: true, earningsAmt: true }
    }),
    prisma.riderAssignment.findMany({
      where: { riderId: profile.id, status: 'DELIVERED' },
      include: { order: { select: { code: true, total: true } } },
      orderBy: { deliveredAt: 'desc' },
      take: 3
    })
  ]);

  // Today's payout = sum of earningsAmt across delivered assignments.
  // earningsAmt is stored as Decimal in Prisma — coerce via Number() for the sum.
  const todaysEarnings = todaysDeliveries.reduce(
    (acc, a) => acc + (a.earningsAmt ? Number(a.earningsAmt) : 0),
    0
  );
  const todaysTripCount = todaysDeliveries.length;

  // Lightweight ratings summary — pulled through the same helper the
  // /rider/feedback page uses (so the redaction stays consistent). We only
  // surface the delivery average + a short count here.
  const ratings = await loadRiderFeedback(profile.id);
  const ratingsAvg = ratings.summary?.avgDelivery ?? null;
  const ratingsCount = ratings.summary?.count ?? 0;

  return (
    <div className="space-y-4">
      {/* The old chunky "Today" + "Earned" grid card was folded into the
          compact StatusStrip inside RiderActiveBoard so the assignment card
          sits above the fold on 380×844 Capacitor WebViews. */}
      <RiderActiveBoard
        rider={JSON.parse(JSON.stringify(profile))}
        assignments={JSON.parse(JSON.stringify(assignments))}
        todaysTripCount={todaysTripCount}
        todaysEarnings={todaysEarnings}
      />

      {/* Compact "Your delivery ratings" tile — full breakdown lives at /rider/feedback. */}
      {ratingsCount > 0 && (
        <Card>
          <CardContent className="p-4">
            <Link href="/rider/feedback" className="flex items-center gap-3 tap-press">
              <div className="grid size-10 place-items-center rounded-lg bg-warning/10 text-warning shrink-0">
                <Star className="size-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">Your delivery ratings</div>
                <div className="text-[11px] text-muted-foreground">
                  {ratingsCount} {ratingsCount === 1 ? 'rating' : 'ratings'} from customers
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-primary tabular-nums">
                  {ratingsAvg != null ? ratingsAvg.toFixed(1) : '—'}
                </div>
                <div className="inline-flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star
                      key={i}
                      className={`size-3 ${ratingsAvg != null && i <= Math.round(ratingsAvg) ? 'fill-warning text-warning' : 'text-muted-foreground/30'}`}
                    />
                  ))}
                </div>
              </div>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Recent deliveries summary — last 3 completed, with deep link to /rider/history. */}
      {recentDeliveries.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HistoryIcon className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Recent deliveries</h2>
              </div>
              <Link href="/rider/history" className="text-xs text-primary inline-flex items-center gap-0.5 tap-press">
                See all <ChevronRight className="size-3" />
              </Link>
            </div>
            <ul className="divide-y">
              {recentDeliveries.map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-2">
                  <div className="grid size-8 place-items-center rounded-lg bg-success/10 text-success shrink-0">
                    <CheckCircle2 className="size-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-mono truncate">{d.order?.code ?? '—'}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {d.deliveredAt ? new Date(d.deliveredAt).toLocaleString('en-IN', { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' }) : 'Delivered'}
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-primary">{money(Number(d.order?.total ?? 0))}</div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
