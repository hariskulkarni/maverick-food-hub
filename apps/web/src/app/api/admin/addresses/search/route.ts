/**
 * Admin-only Nominatim search proxy.
 *
 * Forwards a free-text query to `searchAddresses()` in the geocoding helper,
 * which handles the 1-req/sec throttle and the project User-Agent. We project
 * the rich result down to `{ lat, lng, displayName }[]` for the branch picker.
 */
import { NextRequest } from 'next/server';
import { requireRestaurant } from '@/server/tenancy';
import { searchAddresses } from '@/server/geocoding';

export async function GET(req: NextRequest) {
  await requireRestaurant();
  const q = (req.nextUrl.searchParams.get('q') || '').trim();
  if (!q) return Response.json([]);
  const hits = await searchAddresses(q);
  return Response.json(hits.map((h) => ({ lat: h.lat, lng: h.lng, displayName: h.displayName })));
}
