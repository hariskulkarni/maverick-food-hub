import { NextRequest } from 'next/server';
import { tenantAdminOrError } from '@/server/tenancy';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';
import { clearPlacesLink } from '@/server/reviews/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Clear the placeId link and delete this restaurant's places-sourced reviews (avoids stale data). */
export async function POST(req: NextRequest) {
  try {
    const restaurant = await tenantAdminOrError(req.nextUrl.searchParams.get('restaurantId'));
    if (restaurant instanceof Response) return restaurant;
    const session = await auth();
    await clearPlacesLink(restaurant.id);
    await audit('reviews.places.disconnect', {
      actorId: session?.user?.id ?? null,
      actorRole: (session?.user as { role?: string } | undefined)?.role ?? null,
      restaurantId: restaurant.id,
      entityType: 'ReviewAutoReplyConfig',
      after: { places: 'DISCONNECTED' },
    });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return Response.json({ error: 'Disconnect failed' }, { status: 500 });
  }
}
