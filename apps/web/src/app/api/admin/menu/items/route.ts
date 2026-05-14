import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';

const Body = z.object({
  branchId: z.string(),
  categoryId: z.string(),
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional().nullable(),
  price: z.number().nonnegative(),
  isVeg: z.boolean(),
  spicyLevel: z.number().int().min(0).max(3).optional(),
  prepTimeMin: z.number().int().min(1).max(180).optional(),
  imageUrl: z.string().optional().nullable(),
  isAvailable: z.boolean().optional(),
  isPopular: z.boolean().optional(),
  isRecommended: z.boolean().optional()
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (session?.user.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const data = Body.parse(await req.json());
  const item = await prisma.menuItem.create({ data: { ...data, price: data.price as any } });
  return Response.json(item);
}
