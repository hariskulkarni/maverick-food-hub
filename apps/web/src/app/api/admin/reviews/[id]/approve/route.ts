import { NextRequest } from 'next/server';
import { tenantAdminOrError } from '@/server/tenancy';
import { getReviewScoped } from '@/server/reviews/store';
import { postAndRecord } from '@/server/reviews/posting';
import { auditReview } from '@/server/reviews/review-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Post the stored draft as-is (safety-checked; Google errors → FAILED + 502). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const restaurant = await tenantAdminOrError(req.nextUrl.searchParams.get('restaurantId'));
    if (restaurant instanceof Response) return restaurant;
    const { id } = await params;
    const review = await getReviewScoped(restaurant.id, id);
    if (!review?.reply?.text) return Response.json({ error: 'Not found' }, { status: 404 });
    const res = await postAndRecord(restaurant.id, review, review.reply.text, 'ADMIN_EDITED');
    await auditReview('reviews.reply.approve', restaurant.id, { entityId: id, after: { status: res.status } });
    return res;
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
