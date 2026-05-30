import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireRestaurantAdminApi } from '@/server/api-auth';

const Body = z.object({ branchId: z.string(), name: z.string().min(1), slug: z.string().min(1), sortOrder: z.number().optional() });

export async function POST(req: NextRequest) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const data = Body.parse(await req.json());
  const c = await prisma.category.create({ data });
  return Response.json(c);
}
