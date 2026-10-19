import { NextRequest } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { requireManagedRestaurant } from '@/server/tenancy';
import { exchangeCode, discoverAccountAndLocation } from '@/server/reviews/google-business';
import { saveConfig } from '@/server/integrations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifyState(state: string, restaurantId: string): boolean {
  try {
    const [rid, nonce, mac] = Buffer.from(state, 'base64url').toString().split(':');
    if (!rid || !nonce || !mac || rid !== restaurantId) return false;
    const want = createHmac('sha256', process.env.INTEGRATION_ENCRYPTION_KEY || 'dev')
      .update(`${rid}:${nonce}`).digest('hex').slice(0, 32);
    const a = Buffer.from(mac); const b = Buffer.from(want);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch { return false; }
}

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
