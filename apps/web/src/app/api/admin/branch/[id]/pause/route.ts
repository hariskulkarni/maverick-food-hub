import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { pauseBranch, isPaused } from '@/server/branch-pause';

const Body = z.object({
  minutes: z.union([z.literal(15), z.literal(30), z.literal(60), z.null()]),
  reason: z.string().max(200).optional()
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const restaurant = await requireRestaurant();
  const { id } = await params;

  const branch = await prisma.branch.findFirst({ where: { id, restaurantId: restaurant.id } });
  if (!branch) return new Response('Not found', { status: 404 });

  const body = Body.parse(await req.json());
  await pauseBranch(id, body.minutes, body.reason);

  const status = await isPaused(id);
  return Response.json({ ok: true, ...status });
}
