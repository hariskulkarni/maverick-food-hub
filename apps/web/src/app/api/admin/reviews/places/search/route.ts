import { NextRequest } from 'next/server';
import { requireManagedRestaurant } from '@/server/tenancy';
import { searchBusiness, PlacesNotConfiguredError } from '@/server/reviews/places';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    await requireManagedRestaurant(req.nextUrl.searchParams.get('restaurantId'));
    const b = await req.json().catch(() => ({}));
    const query = typeof b?.query === 'string' ? b.query.trim() : '';
    if (query.length < 2 || query.length > 100) {
      return Response.json({ error: 'Enter your restaurant name (2-100 characters)' }, { status: 400 });
    }
    const candidates = await searchBusiness(query);
    return Response.json({ candidates });
  } catch (e) {
    if (e instanceof Response) return e;
    if (e instanceof PlacesNotConfiguredError) {
      return Response.json({ error: 'Google Places is not configured yet' }, { status: 503 });
    }
    return Response.json({ error: 'Search failed' }, { status: 500 });
  }
}
