import { NextRequest } from 'next/server';
import { requireManagedRestaurant } from '@/server/tenancy';
import { getOAuthUrl } from '@/server/reviews/google-business';
import { signState } from '@/server/reviews/oauth-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const restaurant = await requireManagedRestaurant(req.nextUrl.searchParams.get('restaurantId'));
  return Response.redirect(getOAuthUrl(signState(restaurant.id)), 302);
}
