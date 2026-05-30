import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { parseOrJsonError } from '@/server/zod-helpers';

const Body = z.object({
  label: z.string().min(1).max(40),
  line1: z.string().min(2).max(200),
  line2: z.string().optional(),
  city: z.string().min(1).max(60),
  state: z.string().optional(),
  postalCode: z.string().min(3).max(12),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  isDefault: z.boolean().optional()
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const parsed = parseOrJsonError(Body, await req.json());
  if (parsed instanceof Response) return parsed;
  const data = parsed;
  if (data.isDefault) {
    await prisma.address.updateMany({ where: { userId: session.user.id, isDefault: true }, data: { isDefault: false } });
  }
  const a = await prisma.address.create({ data: { userId: session.user.id, ...data } });
  return Response.json(a);
}
