import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (session?.user.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  try {
    await prisma.category.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (e) {
    return new Response('In use', { status: 409 });
  }
}
