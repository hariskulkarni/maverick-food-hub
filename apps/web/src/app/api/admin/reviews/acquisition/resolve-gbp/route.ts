/**
 * POST /api/admin/reviews/acquisition/resolve-gbp — read the connected Google
 * Business Profile location's place ID / review link and store it, so review
 * asks link straight to the restaurant's Google "write a review" page.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';
import { prisma } from '@/server/db';
import { log } from '@/server/log';
import { tenantAdminOrError } from '@/server/tenancy';
import { fetchGbpPlace } from '@/server/reviews/review-link';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const restaurant = await tenantAdminOrError(req.nextUrl.searchParams.get('restaurantId'));
    if (restaurant instanceof Response) return restaurant;
    let place: { placeId: string | null; reviewUrl: string | null };
    try {
      place = await fetchGbpPlace(restaurant.id);
    } catch (e) {
      log.warn({ err: (e as Error).message, restaurantId: restaurant.id }, 'gbp place resolve failed');
      return Response.json({ error: `Could not read your Google Business Profile: ${(e as Error).message}` }, { status: 502 });
    }
    if (!place.placeId && !place.reviewUrl) {
      return Response.json({ error: 'Your Google Business Profile location has no place ID yet (it may still be pending verification).' }, { status: 409 });
    }
    const data = { gbpPlaceId: place.placeId, gbpReviewUrl: place.reviewUrl };
    await prisma.reviewRequestConfig.upsert({
      where: { restaurantId: restaurant.id },
      create: { restaurantId: restaurant.id, ...data },
      update: data,
    });
    const session = await auth();
    await audit('reviews.acquisition.gbp_place.resolve', {
      actorId: session?.user?.id ?? null, restaurantId: restaurant.id,
      entityType: 'ReviewRequestConfig', entityId: restaurant.id, after: data,
    });
    return Response.json({ ok: true, ...data });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
