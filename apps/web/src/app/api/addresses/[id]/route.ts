import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const a = await prisma.address.findUnique({ where: { id } });
  if (!a || a.userId !== session.user.id) return new Response('Not found', { status: 404 });
  await prisma.address.delete({ where: { id } });
  return Response.json({ ok: true });
}
