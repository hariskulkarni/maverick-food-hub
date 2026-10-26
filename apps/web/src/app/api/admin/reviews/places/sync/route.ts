import { NextRequest } from 'next/server';
import { tenantAdminOrError } from '@/server/tenancy';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';
import { getPlacesLink } from '@/server/reviews/store';
import { syncPlacesReviews } from '@/server/reviews/places-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const restaurant = await tenantAdminOrError(req.nextUrl.searchParams.get('restaurantId'));
    if (restaurant instanceof Response) return restaurant;
    const link = await getPlacesLink(restaurant.id);
    if (!link) return Response.json({ error: 'Google Places not connected' }, { status: 409 });
    const r = await syncPlacesReviews(restaurant.id, link.placeId);
    if (r.fetchFailed) return Response.json({ error: 'Google Places sync failed' }, { status: 502 });
    const session = await auth();
    await audit('reviews.places.sync', {
      actorId: session?.user?.id ?? null,
      actorRole: (session?.user as { role?: string } | undefined)?.role ?? null,
      restaurantId: restaurant.id,
      entityType: 'GoogleReview',
      after: { placeId: link.placeId, synced: r.synced, created: r.created },
    });
    return Response.json({ ok: true, synced: r.synced, created: r.created, failed: r.failed });
  } catch (e) {
    if (e instanceof Response) return e;
    return Response.json({ error: 'Sync failed' }, { status: 500 });
  }
}
