import { NextRequest } from 'next/server';
import { requireManagedRestaurant } from '@/server/tenancy';
import { listReviewsForAdmin } from '@/server/reviews/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ReplyState = NonNullable<Parameters<typeof listReviewsForAdmin>[1]>['state'];

export async function GET(req: NextRequest) {
  const restaurant = await requireManagedRestaurant(req.nextUrl.searchParams.get('restaurantId'));
  const rating = req.nextUrl.searchParams.get('rating');
  const state = req.nextUrl.searchParams.get('state');
  const rows = await listReviewsForAdmin(restaurant.id, {
    rating: rating ? Number(rating) : undefined,
    state: (state as ReplyState) || undefined,
  });
  // Display DTO only; never spread raw rows.
  return Response.json({
    reviews: rows.map((r) => ({
      id: r.id,
      reviewerName: r.reviewerName,
      rating: r.rating,
      comment: r.comment,
      source: r.source,
      reviewCreatedAt: r.reviewCreatedAt,
      reply: r.reply
        ? { state: r.reply.state, text: r.reply.text, source: r.reply.source, postedAt: r.reply.postedAt }
        : null,
    })),
  });
}
