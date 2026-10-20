/** Server proxy to Photon autocomplete (shares the geocoding throttle). */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { autocomplete } from '@/server/geo/autocomplete';

const Body = z.object({
  q: z.string().min(1).max(200),
  bias: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional()
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid' }, { status: 400 });
  return Response.json(await autocomplete(parsed.data.q, parsed.data.bias));
}
