import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  if (!code) return new Response('Missing code', { status: 400 });
  const o = await prisma.order.findUnique({ where: { code } });
  if (!o) return new Response('Not found', { status: 404 });
  return Response.json({ id: o.id });
}
