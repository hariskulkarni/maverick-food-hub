import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';

const Body = z.object({ reason: z.string().optional() }).optional();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const body = Body.parse(await req.json().catch(() => undefined));
  const r = await prisma.restaurant.update({
    where: { id },
    data: { status: 'REJECTED', rejectedReason: body?.reason ?? null }
  });
  return Response.json(r);
}
