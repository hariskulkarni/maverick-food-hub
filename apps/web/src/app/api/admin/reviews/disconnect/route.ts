import { NextRequest } from 'next/server';
import { tenantAdminOrError } from '@/server/tenancy';
import { disconnect } from '@/server/integrations';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Unlink the restaurant's Google Business account. `disconnect` deletes the
 * credential row, so the encrypted refresh token and account/location config
 * are removed (not merely flagged), letting the admin connect a different account.
 */
export async function POST(req: NextRequest) {
  try {
    const restaurant = await tenantAdminOrError(req.nextUrl.searchParams.get('restaurantId'));
    if (restaurant instanceof Response) return restaurant;
    const session = await auth();
    await disconnect(restaurant.id, 'GOOGLE_BUSINESS' as any);
    await audit('reviews.google.disconnect', {
      actorId: session?.user?.id ?? null,
      actorRole: (session?.user as { role?: string } | undefined)?.role ?? null,
      restaurantId: restaurant.id,
      entityType: 'IntegrationCredential',
      after: { provider: 'GOOGLE_BUSINESS', status: 'DISCONNECTED' },
    });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Response) return e;
    return Response.json({ error: 'Disconnect failed' }, { status: 500 });
  }
}
