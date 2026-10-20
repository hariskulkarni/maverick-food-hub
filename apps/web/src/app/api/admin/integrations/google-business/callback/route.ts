import { NextRequest } from 'next/server';
import { requireManagedRestaurant } from '@/server/tenancy';
import { exchangeCode, listAccounts, listAllLocations } from '@/server/reviews/google-business';
import { saveConfig } from '@/server/integrations';
import { verifyState } from '@/server/reviews/oauth-state';
import { externalBaseUrl } from '@/server/http/external-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const restaurant = await requireManagedRestaurant(req.nextUrl.searchParams.get('restaurantId'));
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state') ?? '';
  if (!code || !verifyState(state, restaurant.id)) return new Response('Forbidden', { status: 403 });

  const { refreshToken } = await exchangeCode(code);

  // Discovery is best-effort: a transient failure must not lose the token.
  let accountId = '';
  let locs: Array<{ id: string; title: string }> = [];
  try {
    accountId = await listAccounts(refreshToken);
    if (accountId) locs = await listAllLocations(refreshToken, accountId);
  } catch {
    locs = [];
  }

  const locationId = locs.length === 1 ? locs[0].id : '';
  await saveConfig(
    restaurant.id, 'GOOGLE_BUSINESS' as any,
    { refreshToken, accountId, locationId, locations: JSON.stringify(locs) },
    { status: 'CONNECTED' },
  );
  const dest = locs.length === 0 ? 'google=needs_location' : locs.length === 1 ? 'google=connected' : 'pickLocation=1';
  // Redirect to the PUBLIC host the admin's browser used — NOT req.url, which
  // behind the nginx proxy resolves to the internal http://localhost:3000 and
  // produces an unreachable "localhost refused to connect" redirect.
  const base = externalBaseUrl(req.headers);
  return Response.redirect(new URL(`/admin/settings?tab=reviews&${dest}`, base), 302);
}
