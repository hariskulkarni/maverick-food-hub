import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { rateLimit } from '@/server/http/rate-limit';

export async function GET(req: NextRequest) {
  // Public lookup by order code — rate limit to prevent code enumeration.
  const rl = await rateLimit(req, { name: 'order-lookup', limit: 30, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const code = req.nextUrl.searchParams.get('code');
  if (!code) return new Response('Missing code', { status: 400 });
  const o = await prisma.order.findUnique({ where: { code } });
  if (!o) return new Response('Not found', { status: 404 });
  return Response.json({ id: o.id });
}
