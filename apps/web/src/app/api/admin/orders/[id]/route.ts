import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { auth } from '@/server/auth';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!['ADMIN', 'KITCHEN'].includes(session?.user.role || '')) return new Response('Forbidden', { status: 403 });
  const o = await prisma.order.findUnique({
    where: { id },
    include: { customer: true, items: true, address: true, assignment: { include: { rider: { include: { user: true } } } } }
  });
  if (!o) return new Response('Not found', { status: 404 });
  return Response.json(o);
}
