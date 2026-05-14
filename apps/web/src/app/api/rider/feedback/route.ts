/**
 * GET /api/rider/feedback
 *
 * Returns the signed-in rider's own delivery feedback. The
 * `loadRiderFeedback` helper already projects through
 * `visibleForRole(_, 'RIDER')` — we do NOT re-redact (and we do NOT bypass
 * it) so the rider can never see food ratings, food tags, food images, or
 * private comments.
 */
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { loadRiderFeedback } from '@/server/feedback';

export async function GET() {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });
  const profile = await prisma.riderProfile.findUnique({ where: { userId: session.user.id } });
  if (!profile) return Response.json({ rows: [], summary: null });

  const { rows, summary } = await loadRiderFeedback(profile.id);
  // summariseRatings returns delivery averages — that's exactly what the
  // rider should see (it's their own delivery score). Strip food/overall
  // aggregates so a curious dev tool watcher doesn't see them.
  const safeSummary = summary
    ? {
        count: summary.count,
        avgDelivery: summary.avgDelivery,
        lowDeliveryCount: summary.lowDeliveryCount,
        tagCounts: Object.fromEntries(
          Object.entries(summary.tagCounts).filter(([t]) => t === 'LATE_DELIVERY' || t === 'RIDER_BEHAVIOR')
        )
      }
    : null;
  return Response.json({ rows, summary: safeSummary });
}
