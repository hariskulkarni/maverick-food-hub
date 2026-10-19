import { NextRequest } from 'next/server';
import { requireManagedRestaurant } from '@/server/tenancy';
import { getReviewScoped, saveReply } from '@/server/reviews/store';
import { postReply } from '@/server/reviews/google-business';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const restaurant = await requireManagedRestaurant(req.nextUrl.searchParams.get('restaurantId'));
  const { id } = await params;
  const review = await getReviewScoped(restaurant.id, id);
  if (!review?.reply) return new Response('Not found', { status: 404 });
  await postReply(restaurant.id, review.googleReviewId, review.reply.text);
  await saveReply({
    reviewId: id, restaurantId: restaurant.id, text: review.reply.text,
    state: 'POSTED', source: 'ADMIN_EDITED', postedAt: new Date(),
  });
  return Response.json({ ok: true });
}
