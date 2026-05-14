import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';

const Body = z.object({ reason: z.string().optional() }).optional();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSuperAdmin();
  const { id } = await params;
  const body = Body.parse(await req.json().catch(() => undefined));
  await prisma.riderApplication.update({
    where: { id },
    data: { status: 'REJECTED', reviewedAt: new Date(), reviewedById: session.user.id, rejectedReason: body?.reason }
  });
  return Response.json({ ok: true });
}
