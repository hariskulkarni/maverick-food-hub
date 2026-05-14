/**
 * Reverse-geocode a coordinate to a structured address. Used by the address
 * picker when the user drags the pin or hits "Use my location".
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { reverseGeocode } from '@/server/geocoding';

const Body = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180)
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: 'invalid' }, { status: 400 });
  const result = await reverseGeocode(parsed.data.lat, parsed.data.lng);
  return Response.json(result);
}
