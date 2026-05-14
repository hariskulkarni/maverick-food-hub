import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';

const Body = z.object({ reason: z.string().optional() }).optional();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const restaurant = await requireRestaurant();
  const { id } = await params;
  const body = Body.parse(await req.json().catch(() => undefined));
  const app = await prisma.riderApplication.findUnique({ where: { id } });
  if (!app || app.restaurantId !== restaurant.id) return new Response('Not found', { status: 404 });
  await prisma.riderApplication.update({
    where: { id },
    data: { status: 'REJECTED', reviewedAt: new Date(), rejectedReason: body?.reason }
  });
  return Response.json({ ok: true });
}
