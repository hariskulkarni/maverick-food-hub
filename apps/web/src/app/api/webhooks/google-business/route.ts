/**
 * POST /api/webhooks/google-business — Cloud Pub/Sub push endpoint for Google
 * Business Profile review notifications (NEW_REVIEW / UPDATED_REVIEW).
 *
 * Optional. Enabled only when GBP_PUBSUB_AUDIENCE and GBP_PUBSUB_SERVICE_ACCOUNT
 * are set; otherwise 404 and the 15-minute polling sweep remains the only sync.
 * Every request must carry a Google-signed OIDC token (see server/reviews/pubsub.ts).
 * A valid push for a known location triggers an immediate sync of that restaurant.
 */
import { NextRequest } from 'next/server';
import { log } from '@/server/log';
import { pubsubConfig, verifyPushToken, parseNotification, restaurantForLocation } from '@/server/reviews/pubsub';
import { runGoogleReviewsSweep } from '@/server/jobs/google-reviews-sweep';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const cfg = pubsubConfig();
  if (!cfg) return Response.json({ error: 'Pub/Sub push not configured' }, { status: 404 });
  if (!(await verifyPushToken(req.headers.get('authorization'), cfg))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const n = parseNotification(await req.json().catch(() => null));
  // Ack (204) anything we cannot act on so Pub/Sub does not retry forever.
  if (!n) return new Response(null, { status: 204 });
  const restaurantId = await restaurantForLocation(n.location);
  if (!restaurantId) return new Response(null, { status: 204 });
  try {
    const r = await runGoogleReviewsSweep({ restaurantIds: [restaurantId] });
    log.info({ restaurantId, type: n.type, newReviews: r.newReviews }, 'reviews.pubsub.synced');
  } catch (e) {
    log.error({ restaurantId, err: String((e as Error)?.message ?? e) }, 'reviews.pubsub.sync_failed');
  }
  return new Response(null, { status: 204 });
}
