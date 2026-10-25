import { NextRequest } from 'next/server';
import { tenantAdminOrError } from '@/server/tenancy';
import { getReviewScoped } from '@/server/reviews/store';
import { getOrderContext, matchAndStore } from '@/server/reviews/order-match';
import { auditReview } from '@/server/reviews/review-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin-only order context for a review's best fuzzy order match (items,
 * delivery vs promised time, rider). Never shown publicly.
 * GET returns the stored match; POST re-runs matching first.
 */
async function handle(req: NextRequest, params: Promise<{ id: string }>, rematch: boolean) {
  try {
    const restaurant = await tenantAdminOrError(req.nextUrl.searchParams.get('restaurantId'));
    if (restaurant instanceof Response) return restaurant;
    const { id } = await params;
    const review = await getReviewScoped(restaurant.id, id);
    if (!review) return Response.json({ error: 'Not found' }, { status: 404 });
    let orderId = review.matchedOrderId;
    let confidence = review.matchConfidence;
    if (rematch) {
      const m = await matchAndStore(restaurant.id, review);
      orderId = m?.orderId ?? null;
      confidence = m?.confidence ?? null;
      await auditReview('reviews.match.refresh', restaurant.id, { entityId: id, after: { matched: !!m } });
    }
    if (!orderId) return Response.json({ match: null });
    const ctx = await getOrderContext(restaurant.id, orderId, confidence);
    if (!ctx) return Response.json({ match: null });
    const { privateTerms: _omit, ...dto } = ctx;
    return Response.json({ match: dto });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, params, false);
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(req, params, true);
}
