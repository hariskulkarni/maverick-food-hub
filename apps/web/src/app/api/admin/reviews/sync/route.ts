import { NextRequest } from 'next/server';
import { requireManagedRestaurant } from '@/server/tenancy';
import { listReviews } from '@/server/reviews/google-business';
import { upsertReview } from '@/server/reviews/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const restaurant = await requireManagedRestaurant(req.nextUrl.searchParams.get('restaurantId'));
  let reviews;
  try {
    reviews = await listReviews(restaurant.id);
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (/not connected/i.test(msg)) return Response.json({ error: 'Google Business not connected' }, { status: 409 });
    return Response.json({ error: 'Google sync failed' }, { status: 502 });
  }
  let created = 0;
  for (const r of reviews) {
    const { isNew } = await upsertReview(restaurant.id, r);
    if (isNew) created++;
  }
  return Response.json({ ok: true, synced: reviews.length, created });
}
