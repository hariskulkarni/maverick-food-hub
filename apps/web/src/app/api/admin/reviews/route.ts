import { NextRequest } from 'next/server';
import { tenantAdminOrError } from '@/server/tenancy';
import { listReviewsForAdmin, getResponseSettings } from '@/server/reviews/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ReplyState = NonNullable<NonNullable<Parameters<typeof listReviewsForAdmin>[1]>['state']>;
const STATES: ReplyState[] = ['DRAFT', 'PENDING_APPROVAL', 'POSTED', 'FAILED', 'SKIPPED'];

/**
 * GET /api/admin/reviews?rating=&state=&q=&overdue=1&cursor=&id=
 * Cursor-paginated (newest first). `id` fetches one review (deep links).
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const restaurant = await tenantAdminOrError(sp.get('restaurantId'));
    if (restaurant instanceof Response) return restaurant;
    const settings = await getResponseSettings(restaurant.id);
    const rating = Number(sp.get('rating'));
    const state = sp.get('state') as ReplyState | null;
    const { items, nextCursor } = await listReviewsForAdmin(restaurant.id, {
      rating: rating >= 1 && rating <= 5 ? rating : undefined,
      state: state && STATES.includes(state) ? state : undefined,
      q: sp.get('q') ?? undefined,
      overdueSlaHours: sp.get('overdue') === '1' ? settings.slaHours : undefined,
      cursor: sp.get('cursor') ?? undefined,
      id: sp.get('id') ?? undefined,
    });
    const overdueBefore = Date.now() - settings.slaHours * 3_600_000;
    // Display DTO only; never spread raw rows.
    return Response.json({
      slaHours: settings.slaHours,
      nextCursor,
      reviews: items.map((r) => ({
        id: r.id,
        reviewerName: r.reviewerName,
        rating: r.rating,
        comment: r.comment,
        source: r.source,
        reviewCreatedAt: r.reviewCreatedAt,
        reviewUpdatedAt: r.reviewUpdatedAt ?? null,
        media: Array.isArray(r.media) ? r.media : [],
        hasOrderMatch: !!r.matchedOrderId,
        overdue: r.source === 'gbp' && r.reply?.state !== 'POSTED' && new Date(r.reviewCreatedAt).getTime() < overdueBefore,
        reply: r.reply
          ? {
              state: r.reply.state, text: r.reply.text, source: r.reply.source, postedAt: r.reply.postedAt,
              error: r.reply.state === 'FAILED' ? r.reply.error ?? null : null,
              holdReason: r.reply.holdReason ?? null, moderationState: r.reply.moderationState ?? null,
              policyViolation: r.reply.policyViolation ?? null, reviewReplyUrl: r.reply.reviewReplyUrl ?? null,
            }
          : null,
      })),
    });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
