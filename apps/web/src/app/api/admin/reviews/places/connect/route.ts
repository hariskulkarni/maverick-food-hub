import { NextRequest } from 'next/server';
import { tenantAdminOrError } from '@/server/tenancy';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';
import { setPlacesLink } from '@/server/reviews/store';
import { syncPlacesReviews } from '@/server/reviews/places-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Persist the placeId on this restaurant, then run an initial (fail-safe) sync. */
export async function POST(req: NextRequest) {
  try {
    const restaurant = await tenantAdminOrError(req.nextUrl.searchParams.get('restaurantId'));
    if (restaurant instanceof Response) return restaurant;
    const b = await req.json().catch(() => ({}));
    const placeId = typeof b?.placeId === 'string' ? b.placeId.trim() : '';
    const name = typeof b?.name === 'string' ? b.name.trim().slice(0, 200) : '';
    if (!placeId || placeId.length > 300) return Response.json({ error: 'placeId required' }, { status: 400 });
    const session = await auth();
    await setPlacesLink(restaurant.id, { placeId, name });
    const r = await syncPlacesReviews(restaurant.id, placeId);
    await audit('reviews.places.connect', {
      actorId: session?.user?.id ?? null,
      actorRole: (session?.user as { role?: string } | undefined)?.role ?? null,
      restaurantId: restaurant.id,
      entityType: 'ReviewAutoReplyConfig',
      after: { placeId, name, synced: r.synced },
    });
    return Response.json({ ok: true, name, synced: r.synced, created: r.created, failed: r.failed, fetchFailed: r.fetchFailed });
  } catch (e) {
    if (e instanceof Response) return e;
    return Response.json({ error: 'Connect failed' }, { status: 500 });
  }
}
