import { NextRequest } from 'next/server';
import { createHmac } from 'crypto';
import { requireManagedRestaurant } from '@/server/tenancy';
import { getOAuthUrl } from '@/server/reviews/google-business';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function signState(restaurantId: string): string {
  const nonce = Date.now().toString(36);
  const mac = createHmac('sha256', process.env.INTEGRATION_ENCRYPTION_KEY || 'dev')
    .update(`${restaurantId}:${nonce}`).digest('hex').slice(0, 32);
  return Buffer.from(`${restaurantId}:${nonce}:${mac}`).toString('base64url');
}

export async function GET(req: NextRequest) {
  const restaurant = await requireManagedRestaurant(req.nextUrl.searchParams.get('restaurantId'));
  return Response.redirect(getOAuthUrl(signState(restaurant.id)), 302);
}
