import { NextRequest } from 'next/server';
import { requireManagedRestaurant } from '@/server/tenancy';
import { exchangeCode, discoverAccountAndLocation } from '@/server/reviews/google-business';
import { saveConfig } from '@/server/integrations';
import { verifyState } from '@/server/reviews/oauth-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const restaurant = await requireManagedRestaurant(req.nextUrl.searchParams.get('restaurantId'));
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state') ?? '';
  if (!code || !verifyState(state, restaurant.id)) return new Response('Forbidden', { status: 403 });

  const { refreshToken } = await exchangeCode(code);
  // TODO(follow-up): multi-location picker — when an account has >1 location we
  // currently take the first; a picker UI should let the owner choose.
  const { accountId, locationId } = await discoverAccountAndLocation(refreshToken);
  await saveConfig(
    restaurant.id, 'GOOGLE_BUSINESS' as any,
    { refreshToken, accountId, locationId },
    { status: 'CONNECTED' },
  );
  const flag = accountId && locationId ? 'connected' : 'needs_location';
  return Response.redirect(new URL(`/admin/settings?google=${flag}`, req.url), 302);
}
