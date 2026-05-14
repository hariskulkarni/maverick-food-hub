import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';

const Body = z.object({ branchId: z.string(), name: z.string().min(1), slug: z.string().min(1), sortOrder: z.number().optional() });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (session?.user.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const data = Body.parse(await req.json());
  const c = await prisma.category.create({ data });
  return Response.json(c);
}
