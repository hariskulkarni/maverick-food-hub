/**
 * Server-side passthrough to Nominatim. We do this on the server (a) to keep a
 * single rate-limit queue across all clients and (b) so we can attach a real
 * User-Agent header per the OSM tile/Nominatim usage policy.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { searchAddresses } from '@/server/geocoding';

const Body = z.object({ q: z.string().min(1).max(200) });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: 'invalid' }, { status: 400 });
  const results = await searchAddresses(parsed.data.q);
  return Response.json(results);
}
