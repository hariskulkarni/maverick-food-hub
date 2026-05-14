/**
 * Admin-only Nominatim reverse-geocode proxy.
 *
 * `GET /api/admin/addresses/reverse?lat=..&lng=..` → parsed address fields.
 * Shares the 1-req/sec throttle in `server/geocoding.ts`.
 */
import { NextRequest } from 'next/server';
import { requireRestaurant } from '@/server/tenancy';
import { reverseGeocode } from '@/server/geocoding';

export async function GET(req: NextRequest) {
  await requireRestaurant();
  const lat = Number(req.nextUrl.searchParams.get('lat'));
  const lng = Number(req.nextUrl.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return new Response('Bad coordinates', { status: 400 });
  }
  const hit = await reverseGeocode(lat, lng);
  return Response.json({ ...hit, lat, lng });
}
