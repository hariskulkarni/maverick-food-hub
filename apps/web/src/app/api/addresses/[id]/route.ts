import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { addressHasActiveOrder, ADDRESS_IN_USE_MESSAGE } from '@/server/address-guard';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const a = await prisma.address.findUnique({ where: { id } });
  if (!a || a.userId !== session.user.id) return new Response('Not found', { status: 404 });
  if (await addressHasActiveOrder(id)) {
    return Response.json({ error: 'address_in_use', message: ADDRESS_IN_USE_MESSAGE }, { status: 409 });
  }
  await prisma.address.delete({ where: { id } });
  return Response.json({ ok: true });
}
