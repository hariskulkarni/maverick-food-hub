import { NextRequest } from 'next/server';
import { tenantAdminOrError } from '@/server/tenancy';
import { getOAuthUrl } from '@/server/reviews/google-business';
import { signState } from '@/server/reviews/oauth-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const restaurant = await tenantAdminOrError(req.nextUrl.searchParams.get('restaurantId'));
  if (restaurant instanceof Response) return restaurant;
  return Response.redirect(getOAuthUrl(signState(restaurant.id)), 302);
}
